import { Injectable, Logger } from '@nestjs/common';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { AppError, Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { getPath } from '../../common/http-json';
import { ESignRole, ESignSigner, ESignVendorStatus, HttpESign } from './esign.provider';

/* ---------------------------------------------------------------------
 * v10.143 (D139 · docs/217 · 설계 docs/216) — 전자계약 연동 틀
 *
 *   esign.provider  STUB(처음 · 지금과 같음 — 화면 안 「서명」 단추) · MOCK(점검판 가짜 서명 화면 · 운영 서버에서는 STUB 으로 읽음) · HTTP(업체)
 *   MOCK · HTTP 면 「전자서명 요청」만 — 화면 안 서명은 막힘(ESIGN_REQUIRED · 대표 결정 ①)
 *   흐름  합의(AGREED) → 요청(계약서 지문 SHA-256 · 서명자 2명) → 업체 서명 → 웹훅(서명 검사 · 중복 한 번) 또는 10분 조회(esign_poll)
 *         → 양측 서명 · 지문 같음 → 계약 SIGNED(서명 시각은 업체 값). 거절 · 만료 · 취소 → 계약 AGREED 그대로 · 다시 요청
 *   보관  업체 문서 id + 지문만(원본은 업체 · 대표 결정 ③). 웹훅 본문 · 연락처는 저장하지 않음.
 * ------------------------------------------------------------------- */

export type EsignMode = 'STUB' | 'MOCK' | 'HTTP';
const isProd = () => (process.env.NODE_ENV ?? 'development') === 'production';
/** 점검판 가짜 업체의 웹훅 비밀값 — 운영 서버에서는 MOCK 을 못 쓰므로 쓰이지 않음(시험이 같은 값으로 서명) */
export const MOCK_WEBHOOK_SECRET = 'sgb-mock-esign-webhook-secret';
const SIG_SKEW_SEC = 300;

interface DocRow {
  id: string; contract_id: string; deal_id: string; provider: EsignMode; doc_id: string | null; state: string; doc_hash: string;
  buyer_signed_at: Date | null; seller_signed_at: Date | null; buyer_sign_url: string | null; seller_sign_url: string | null;
  error_kind: string | null; error: string | null; expires_at: Date; created_by: string | null; created_at: Date; completed_at: Date | null;
}

@Injectable()
export class EsignService {
  private readonly log = new Logger(EsignService.name);
  constructor(private readonly db: DatabaseService) {}

  private async setting(key: string, dflt: string) {
    const [r] = await this.db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = $1`, [key]);
    return r?.v?.trim() || dflt;
  }
  async mode(): Promise<EsignMode> { return EsignService.readMode(await this.setting('esign.provider', 'STUB')); }
  static readMode(v: string): EsignMode {
    const m = (v ?? '').trim().toUpperCase();
    return m === 'HTTP' ? 'HTTP' : m === 'MOCK' && !isProd() ? 'MOCK' : 'STUB';
  }
  static configuredFor(mode: EsignMode) { return mode === 'MOCK' || (mode === 'HTTP' && !HttpESign.missing().length); }
  private static secret(mode: EsignMode) { return mode === 'MOCK' ? MOCK_WEBHOOK_SECRET : (process.env.ESIGN_WEBHOOK_SECRET ?? '').trim(); }

  /* ── 공통 ─────────────────────────────────────────────────────── */
  private async contractOf(dealId: string) {
    const [c] = await this.db.query<any>(
      `SELECT c.*, d.buyer_account_id, d.seller_account_id
         FROM deal_contracts c JOIN deals d ON d.id = c.deal_id
        WHERE c.deal_id = $1 ORDER BY c.issued_at DESC LIMIT 1`, [dealId]);
    if (!c) throw new NotFound('계약이 없습니다.');
    return c;
  }
  private sideOf(c: any, me: string | null | undefined): ESignRole {
    if (me && c.buyer_account_id === me) return 'BUYER';
    if (me && c.seller_account_id === me) return 'SELLER';
    throw new Forbidden('NOT_PARTY', '이 계약의 당사자가 아닙니다.');
  }
  async pendingOf(contractId: string): Promise<DocRow | null> {
    const [d] = await this.db.query<DocRow>(`SELECT * FROM esign_documents WHERE contract_id = $1 AND state = 'PENDING'`, [contractId]);
    return d ?? null;
  }
  private async latestOf(contractId: string): Promise<DocRow | null> {
    const [d] = await this.db.query<DocRow>(`SELECT * FROM esign_documents WHERE contract_id = $1 ORDER BY created_at DESC LIMIT 1`, [contractId]);
    return d ?? null;
  }

  /** 계약서 지문 — 양식(코드 · 판 · 본문) + 합의 조건 + 계약 · 거래 번호. 키 순서를 정렬해 같은 내용이면 같은 값 */
  static docHash(c: { id: string; deal_id: string; template_code: string; terms: unknown }, tpl: { version?: unknown; body: string }) {
    const sort = (o: any): any => Array.isArray(o) ? o.map(sort)
      : o && typeof o === 'object' ? Object.keys(o).sort().reduce((a: any, k) => (a[k] = sort(o[k]), a), {}) : o;
    const canon = JSON.stringify(sort({ contract: c.id, deal: c.deal_id, template: c.template_code, version: tpl.version ?? null, body: tpl.body, terms: c.terms ?? null }));
    return createHash('sha256').update(canon, 'utf8').digest('hex');
  }

  /** 계약 화면 단추 막기 — 요청 중이면 합의 · 수정 · 임시 저장 · 화면 안 서명이 막힘 */
  async assertNotInProgress(contractId: string) {
    if (await this.pendingOf(contractId))
      throw new StateConflict('ESIGN_IN_PROGRESS', '전자서명 요청이 진행 중입니다 — 조건을 바꾸려면 먼저 요청을 취소하십시오.');
  }
  /** 화면 안 「서명」 단추 — 전자계약이 켜져 있으면 막힘(대표 결정 ① 섞지 않음) */
  async assertInAppSignAllowed() {
    if ((await this.mode()) !== 'STUB')
      throw new StateConflict('ESIGN_REQUIRED', '이 계약은 전자서명으로 체결합니다 — 「전자서명 요청」을 누르십시오.');
  }

  /* ── 회원: 요청 · 상태 · 취소 ────────────────────────────────────── */
  async request(dealId: string) {
    const me = RequestCtx.actorId();
    const c = await this.contractOf(dealId);
    this.sideOf(c, me);
    const mode = await this.mode();
    if (mode === 'STUB') return null;   // 옛 스텁 경로(DealContractService.requestESign)
    if (c.state !== 'AGREED') throw new StateConflict('NOT_AGREED', '양측이 조건에 합의해야 전자서명을 요청할 수 있습니다.');
    if (c.signed_by_buyer_at || c.signed_by_seller_at) throw new StateConflict('ALREADY_SIGNED', '이미 서명이 시작된 계약입니다.');
    if (await this.pendingOf(c.id)) return this.view(dealId);
    if (!EsignService.configuredFor(mode))
      throw new StateConflict('ESIGN_NOT_CONFIGURED', '전자계약 연동이 준비되지 않았습니다 — 운영자에게 문의해 주십시오.');

    const [tpl] = await this.db.query<{ name: string; version: unknown; body: string }>(
      `SELECT name, version, body FROM contract_templates WHERE code = $1`, [c.template_code]);
    if (!tpl) throw new StateConflict('NO_TEMPLATE', '표준 양식이 아닙니다.');
    const people = await this.db.query<{ id: string; name: string | null; phone: string | null; email: string | null }>(
      `SELECT id, name, phone, email FROM accounts WHERE id IN ($1, $2)`, [c.buyer_account_id, c.seller_account_id]);
    const signers: ESignSigner[] = (['BUYER', 'SELLER'] as const).map((role) => {
      const a = people.find((p) => p.id === (role === 'BUYER' ? c.buyer_account_id : c.seller_account_id));
      return { role, name: (a?.name ?? '').trim(), phone: a?.phone?.replace(/\D/g, '') || null, email: a?.email?.trim() || null };
    });
    const lacking = signers.filter((s) => !s.name || (!s.phone && !s.email));
    if (lacking.length)
      throw new PolicyViolation('ESIGN_CONTACT_MISSING', '서명 안내를 받을 휴대폰 또는 메일이 없는 당사자가 있습니다 — 내 정보에서 연락처를 넣은 뒤 다시 요청해 주십시오.',
        { missing: lacking.map((s) => s.role) });

    const docHash = EsignService.docHash(c, tpl);
    const days = Math.min(Math.max(Number(await this.setting('esign.expire_days', '7')) || 7, 1), 30);
    let doc: DocRow;
    try {
      [doc] = await this.db.query<DocRow>(
        `INSERT INTO esign_documents (contract_id, deal_id, provider, doc_hash, expires_at, created_by)
         VALUES ($1, $2, $3, $4, now() + make_interval(days => $5::int), $6) RETURNING *`, [c.id, dealId, mode, docHash, days, me]);
    } catch (e) {
      if (/uq_esign_doc_pending/.test(String((e as Error)?.message))) return this.view(dealId);   // 두 번 눌림 — 먼저 만든 것
      throw e;
    }

    let docId: string, urls: Partial<Record<ESignRole, string>> = {};
    if (mode === 'MOCK') {
      docId = 'MOCK-' + randomBytes(8).toString('hex');
      urls = { BUYER: `/contract/mock-sign?deal=${dealId}&role=BUYER`, SELLER: `/contract/mock-sign?deal=${dealId}&role=SELLER` };
    } else {
      const base = (await this.setting('site.base_url', '')).replace(/\/+$/, '');
      const r = await new HttpESign().create({
        contractId: c.id, title: `${tpl.name} — 소개뱅크`, content: EsignService.content(tpl.body, c.terms), docHash,
        expiresAt: new Date(doc.expires_at).toISOString(), signers, callbackUrl: `${base}/api/v1/webhooks/esign`,
      });
      if (!r.ok || !r.docId) {
        await this.db.query(`UPDATE esign_documents SET state = 'FAILED', error_kind = $2, error = $3, updated_at = now(), completed_at = now() WHERE id = $1`,
          [doc.id, r.errorKind ?? 'REJECTED', (r.error ?? '').slice(0, 200)]);
        this.log.warn(`전자서명 요청 실패 계약 ${c.id} ${r.errorKind}: ${r.error ?? ''}`);
        throw new AppError(502, { code: 'ESIGN_FAILED', message: r.errorKind === 'AUTH' || r.errorKind === 'NOT_CONFIGURED'
          ? '전자계약 업체 연결 설정에 문제가 있습니다 — 운영자에게 문의해 주십시오.'
          : '전자계약 업체에 요청을 보내지 못했습니다 — 잠시 뒤 다시 눌러 주십시오.', details: { kind: r.errorKind } });
      }
      docId = r.docId; urls = r.signUrls ?? {};
    }
    await this.db.query(
      `UPDATE esign_documents SET doc_id = $2, buyer_sign_url = $3, seller_sign_url = $4, updated_at = now() WHERE id = $1`,
      [doc.id, docId, urls.BUYER ?? null, urls.SELLER ?? null]);
    await this.db.query(`UPDATE deal_contracts SET esign_doc_id = $2, esign_stub = false, last_actor_id = $3 WHERE id = $1`, [c.id, docId, me]);
    await this.db.query(
      `INSERT INTO contract_revisions (contract_id, actor_id, from_state, to_state, memo) VALUES ($1, $2, $3, $3, $4)`,
      [c.id, me, c.state, `전자서명 요청(${mode} · 지문 ${docHash.slice(0, 12)}…)`]);
    return this.view(dealId);
  }

  /** 업체에 보내는 계약서 글 — 양식 본문 + 합의 조건(사람이 읽는 줄) */
  static content(body: string, terms: any) {
    const t = terms ?? {};
    const lines = [
      t.kind ? `거래 종류: ${t.kind === 'SERVICE' ? '용역' : '물품'}` : '',
      t.amount != null ? `금액: ${Number(t.amount).toLocaleString('ko-KR')}원` : '',
      t.dueDate ? `이행 기한: ${t.dueDate}` : '', t.place ? `이행 장소: ${t.place}` : '',
      t.court ? `관할 법원: ${t.court}` : '', t.special ? `특약: ${t.special}` : '',
    ].filter(Boolean);
    return `${body}\n\n[합의 조건]\n${lines.join('\n')}`;
  }

  async view(dealId: string) {
    const me = RequestCtx.actorId();
    const c = await this.contractOf(dealId);
    const side = this.sideOf(c, me);
    const mode = await this.mode();
    const d = await this.latestOf(c.id);
    const mine = side === 'BUYER' ? d?.buyer_signed_at : d?.seller_signed_at;
    return {
      mode, contractState: c.state, stub: false,
      state: d ? d.state : 'NOT_REQUESTED',
      docHash: d?.doc_hash ?? null,
      buyerSignedAt: d?.buyer_signed_at ?? null, sellerSignedAt: d?.seller_signed_at ?? null,
      expiresAt: d?.expires_at ?? null, requestedAt: d?.created_at ?? null, completedAt: d?.completed_at ?? null,
      errorKind: d?.error_kind ?? null,
      /* 내 서명 주소는 나에게만 · 대기 중 · 아직 안 했을 때만 */
      mySignUrl: d && d.state === 'PENDING' && !mine ? (side === 'BUYER' ? d.buyer_sign_url : d.seller_sign_url) : null,
      mySide: side,
    };
  }

  async cancel(dealId: string) {
    const me = RequestCtx.actorId();
    const c = await this.contractOf(dealId);
    this.sideOf(c, me);
    const d = await this.pendingOf(c.id);
    if (!d) throw new StateConflict('ESIGN_NOT_PENDING', '진행 중인 전자서명 요청이 없습니다.');
    await this.closeDoc(d, 'CANCELLED', me ?? d.created_by, '전자서명 요청 취소(당사자)');
    return this.view(dealId);
  }

  /** 계약 파기 때 — 대기 중 요청을 업체에서도 취소(실패해도 우리 쪽은 닫음) */
  async cancelForContract(contractId: string, actor: string | null) {
    const d = await this.pendingOf(contractId);
    if (d) await this.closeDoc(d, 'CANCELLED', actor ?? d.created_by, '계약 파기 — 전자서명 요청 취소');
  }

  /** 대기 요청 닫기(취소 · 거절 · 만료) — 계약은 AGREED 그대로 · 서명 기록 비움 · 다시 요청 가능 */
  private async closeDoc(d: DocRow, state: 'CANCELLED' | 'REJECTED' | 'EXPIRED', actor: string | null, memo: string) {
    let note: string | null = null;
    if (state === 'CANCELLED' || state === 'EXPIRED') {
      if (d.provider === 'HTTP' && d.doc_id) {
        const r = await new HttpESign().cancel(d.doc_id);
        if (!r.ok) note = `업체 취소 실패 ${r.errorKind ?? ''}`.trim();
      }
    }
    const [u] = await this.db.query<{ id: string }>(
      `UPDATE esign_documents SET state = $2, error_kind = coalesce($3, error_kind), error = coalesce($4, error), updated_at = now(), completed_at = now()
        WHERE id = $1 AND state = 'PENDING' RETURNING id`, [d.id, state, note ? 'CANCEL_FAILED' : null, note]);
    if (!u) return false;
    const [c] = await this.db.query<{ state: string }>(
      `UPDATE deal_contracts SET esign_doc_id = NULL,
              signed_by_buyer_at = CASE WHEN state = 'AGREED' THEN NULL ELSE signed_by_buyer_at END,
              signed_by_seller_at = CASE WHEN state = 'AGREED' THEN NULL ELSE signed_by_seller_at END
        WHERE id = $1 RETURNING state`, [d.contract_id]);
    if (actor) await this.db.query(
      `INSERT INTO contract_revisions (contract_id, actor_id, from_state, to_state, memo) VALUES ($1, $2, $3, $3, $4)`,
      [d.contract_id, actor, c?.state ?? 'AGREED', memo]);
    return true;
  }

  /**
   * 업체 상태를 반영 — 웹훅 · 조회 · 가짜 서명이 모두 여기로. 대기 중인 것만 바꿈(두 번 와도 한 번).
   * 돌려주는 글은 기록용(esign_events.result · 배치 detail).
   */
  async apply(d: DocRow, st: ESignVendorStatus, via: string): Promise<string> {
    if (d.state !== 'PENDING') return `ALREADY_${d.state}`;
    if (!st.ok || !st.state) return `SKIP_${st.errorKind ?? 'NO_STATE'}`;
    for (const s of st.signers ?? []) {
      const col = s.role === 'BUYER' ? 'buyer_signed_at' : 'seller_signed_at';
      await this.db.query(`UPDATE esign_documents SET ${col} = coalesce(${col}, $2::timestamptz), updated_at = now() WHERE id = $1`, [d.id, s.signedAt]);
      const ccol = s.role === 'BUYER' ? 'signed_by_buyer_at' : 'signed_by_seller_at';
      await this.db.query(`UPDATE deal_contracts SET ${ccol} = coalesce(${ccol}, $2::timestamptz) WHERE id = $1 AND state = 'AGREED'`, [d.contract_id, s.signedAt]);
    }
    if (st.state === 'PENDING') return 'PENDING';
    if (st.state === 'REJECTED' || st.state === 'EXPIRED' || st.state === 'CANCELLED') {
      await this.closeDoc(d, st.state, d.created_by, `전자서명 ${st.state === 'REJECTED' ? '거절' : st.state === 'EXPIRED' ? '만료' : '취소'}(업체 · ${via})`);
      return st.state;
    }
    /* SIGNED — 지문이 다르면 올리지 않음 */
    if (st.docHash && st.docHash !== d.doc_hash) {
      await this.db.query(
        `UPDATE esign_documents SET state = 'FAILED', error_kind = 'HASH_MISMATCH', error = $2, updated_at = now(), completed_at = now() WHERE id = $1 AND state = 'PENDING'`,
        [d.id, `업체 지문 ${st.docHash.slice(0, 16)}… ≠ 우리 ${d.doc_hash.slice(0, 16)}…`]);
      await this.db.query(
        `UPDATE deal_contracts SET esign_doc_id = NULL, signed_by_buyer_at = NULL, signed_by_seller_at = NULL WHERE id = $1 AND state = 'AGREED'`, [d.contract_id]);
      this.log.error(`전자계약 지문 다름 — 계약 ${d.contract_id} 문서 ${d.doc_id}`);
      return 'HASH_MISMATCH';
    }
    const [x] = await this.db.query<{ b: Date | null; s: Date | null }>(`SELECT buyer_signed_at AS b, seller_signed_at AS s FROM esign_documents WHERE id = $1`, [d.id]);
    const now = new Date().toISOString();
    await this.db.query(
      `UPDATE esign_documents SET state = 'SIGNED', buyer_signed_at = coalesce(buyer_signed_at, $2::timestamptz), seller_signed_at = coalesce(seller_signed_at, $2::timestamptz),
              updated_at = now(), completed_at = now() WHERE id = $1 AND state = 'PENDING'`, [d.id, now]);
    const [c] = await this.db.query<{ id: string }>(
      `UPDATE deal_contracts SET signed_by_buyer_at = coalesce(signed_by_buyer_at, $2::timestamptz), signed_by_seller_at = coalesce(signed_by_seller_at, $3::timestamptz),
              state = 'SIGNED', esign_stub = false, last_actor_id = $4
        WHERE id = $1 AND state = 'AGREED' RETURNING id`, [d.contract_id, x?.b ?? now, x?.s ?? now, d.created_by]);
    if (c && d.created_by) await this.db.query(
      `INSERT INTO contract_revisions (contract_id, actor_id, from_state, to_state, memo) VALUES ($1, $2, 'AGREED', 'SIGNED', $3)`,
      [d.contract_id, d.created_by, `양측 전자서명 완료(업체 증명 · ${via} · 지문 ${d.doc_hash.slice(0, 12)}…)`]);
    return c ? 'SIGNED' : 'SIGNED_CONTRACT_NOT_AGREED';
  }

  /* ── 업체 → 우리 웹훅 ─────────────────────────────────────────── */
  /** 서명 = HMAC-SHA256(비밀값, "시각.본문") — 머리글 ESIGN_SIG_HEADER(x-esign-signature · hex 또는 base64) · ESIGN_TS_HEADER(x-esign-timestamp · 초) */
  static verify(secret: string, raw: string, ts: string | undefined, sig: string | undefined, nowSec = Math.floor(Date.now() / 1000)) {
    if (!secret || !ts || !sig || !/^\d{9,12}$/.test(ts)) return false;
    if (Math.abs(nowSec - Number(ts)) > SIG_SKEW_SEC) return false;
    const mac = createHmac('sha256', secret).update(`${ts}.${raw}`, 'utf8').digest();
    const got = sig.trim().replace(/^sha256=/i, '');
    const cand = /^[0-9a-f]{64}$/i.test(got) ? Buffer.from(got, 'hex') : Buffer.from(got, 'base64');
    return cand.length === mac.length && timingSafeEqual(cand, mac);
  }

  async webhook(raw: string, headers: Record<string, string | string[] | undefined>, body: any) {
    const mode = await this.mode();
    const h = (n: string) => { const v = headers[n.toLowerCase()]; return Array.isArray(v) ? v[0] : v; };
    if (mode === 'STUB') return { ok: true, ignored: 'ESIGN_OFF' };
    const eventId = String(getPath(body, process.env.ESIGN_EVT_ID_PATH?.trim() || 'eventId') ?? '').slice(0, 200) || null;
    const docId = String(getPath(body, process.env.ESIGN_EVT_DOC_PATH?.trim() || 'documentId') ?? '').slice(0, 200) || null;
    const kind = String(getPath(body, process.env.ESIGN_EVT_TYPE_PATH?.trim() || 'type') ?? '').slice(0, 60) || null;
    const ok = EsignService.verify(EsignService.secret(mode), raw,
      h(process.env.ESIGN_TS_HEADER?.trim() || 'x-esign-timestamp'), h(process.env.ESIGN_SIG_HEADER?.trim() || 'x-esign-signature'));
    if (!ok) {
      await this.db.query(`INSERT INTO esign_events (provider, event_id, doc_id, kind, sig_ok, result) VALUES ($1, $2, $3, $4, false, 'BAD_SIGNATURE')`,
        [mode, eventId, docId, kind]);
      this.log.warn(`전자계약 웹훅 서명 틀림(문서 ${docId ?? '-'})`);
      throw new AppError(401, { code: 'ESIGN_BAD_SIGNATURE', message: '서명 검사에 실패했습니다.' });
    }
    const [evt] = await this.db.query<{ id: string }>(
      `INSERT INTO esign_events (provider, event_id, doc_id, kind, sig_ok) VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (provider, event_id) WHERE sig_ok AND NOT duplicate AND event_id IS NOT NULL DO NOTHING RETURNING id`, [mode, eventId, docId, kind]);
    if (!evt) {
      await this.db.query(`INSERT INTO esign_events (provider, event_id, doc_id, kind, sig_ok, duplicate, result) VALUES ($1, $2, $3, $4, true, true, 'DUPLICATE')`,
        [mode, eventId, docId, kind]);
      return { ok: true, duplicate: true };
    }
    const [d] = docId ? await this.db.query<DocRow>(`SELECT * FROM esign_documents WHERE provider = $1 AND doc_id = $2`, [mode, docId]) : [];
    let result: string;
    if (!d) result = 'UNKNOWN_DOC';
    else {
      /* HTTP 는 본문을 믿지 않고 업체에 다시 물어봄(토스 웹훅과 같은 원칙) · MOCK 은 업체가 없어 서명 검사를 마친 본문을 그대로 */
      const st = mode === 'HTTP' ? await new HttpESign().status(d.doc_id!) : HttpESign.readStatus(body);
      if (mode === 'HTTP' && !st.ok) {
        await this.db.query(`UPDATE esign_events SET result = $2 WHERE id = $1`, [evt.id, `LOOKUP_${st.errorKind}`]);
        await this.db.query(`UPDATE esign_events SET duplicate = true WHERE id = $1`, [evt.id]);   // 업체가 다시 보내면 처리되도록 자리를 비움
        throw new AppError(502, { code: 'ESIGN_LOOKUP_FAILED', message: '업체 상태를 확인하지 못했습니다 — 다시 보내 주십시오.' });
      }
      result = await this.apply(d, st, 'webhook');
    }
    await this.db.query(`UPDATE esign_events SET result = $2 WHERE id = $1`, [evt.id, result]);
    return { ok: true, result };
  }

  /* ── 점검판 가짜 서명 화면(MOCK) ─────────────────────────────────── */
  async mockSign(dealId: string, action: 'SIGN' | 'REJECT') {
    if ((await this.mode()) !== 'MOCK') throw new Forbidden('MOCK_ONLY', '가짜 서명은 시험 방식(MOCK)에서만 씁니다.');
    const me = RequestCtx.actorId();
    const c = await this.contractOf(dealId);
    const side = this.sideOf(c, me);
    const d = await this.pendingOf(c.id);
    if (!d) throw new StateConflict('ESIGN_NOT_PENDING', '진행 중인 전자서명 요청이 없습니다.');
    const now = new Date().toISOString();
    const signers = [
      ...(d.buyer_signed_at ? [{ role: 'BUYER' as const, signedAt: new Date(d.buyer_signed_at).toISOString() }] : []),
      ...(d.seller_signed_at ? [{ role: 'SELLER' as const, signedAt: new Date(d.seller_signed_at).toISOString() }] : []),
    ].filter((s) => s.role !== side);
    if (action === 'SIGN') signers.push({ role: side, signedAt: now });
    const both = signers.length === 2;
    const st: ESignVendorStatus = { ok: true, state: action === 'REJECT' ? 'REJECTED' : both ? 'SIGNED' : 'PENDING', signers, docHash: d.doc_hash };
    const result = await this.apply(d, st, 'mock');
    return { result, ...(await this.view(dealId)) };
  }

  /* ── 배치 esign_poll — 만료 · 업체 조회(웹훅이 빠져도) ─────────────── */
  async poll(limit = 50) {
    const out = { expired: 0, checked: 0, changed: 0, failed: 0 };
    const expired = await this.db.query<DocRow>(`SELECT * FROM esign_documents WHERE state = 'PENDING' AND expires_at < now() ORDER BY expires_at LIMIT $1`, [limit]);
    for (const d of expired) if (await this.closeDoc(d, 'EXPIRED', d.created_by, '전자서명 만료(기한 지남)')) out.expired++;
    const due = await this.db.query<DocRow>(
      `SELECT * FROM esign_documents WHERE state = 'PENDING' AND provider = 'HTTP' AND doc_id IS NOT NULL
          AND coalesce(last_polled_at, created_at) < now() - interval '10 minutes' ORDER BY coalesce(last_polled_at, created_at) LIMIT $1`, [limit]);
    for (const d of due) {
      out.checked++;
      await this.db.query(`UPDATE esign_documents SET last_polled_at = now() WHERE id = $1`, [d.id]);
      const st = await new HttpESign().status(d.doc_id!);
      if (!st.ok) { out.failed++; continue; }
      const r = await this.apply(d, st, 'poll');
      if (r !== 'PENDING') out.changed++;
    }
    return out;
  }

  /* ── 운영 화면 ─────────────────────────────────────────────────── */
  async status() {
    const mode = await this.mode();
    const setting = await this.setting('esign.provider', 'STUB');
    const admin = await this.db.query<{ name: string }>(`SELECT name FROM integration_secrets WHERE integration_code = 'ESIGN'`);
    const keys = ['ESIGN_API_KEY', 'ESIGN_WEBHOOK_SECRET'].map((n) => ({ name: n, set: !!process.env[n]?.trim(),
      source: admin.some((r) => r.name === n) ? 'ADMIN' : process.env[n]?.trim() ? 'ENV' : 'NONE' }));
    const [s] = await this.db.query<any>(
      `SELECT count(*)::int AS requested,
              count(*) FILTER (WHERE state = 'SIGNED')::int AS signed,
              count(*) FILTER (WHERE state = 'PENDING')::int AS pending,
              count(*) FILTER (WHERE state IN ('REJECTED', 'EXPIRED', 'CANCELLED'))::int AS closed,
              count(*) FILTER (WHERE state = 'FAILED')::int AS failed
         FROM esign_documents WHERE created_at > now() - interval '30 days'`);
    const reasons = await this.db.query<{ reason: string; n: number }>(
      `SELECT coalesce(error_kind, state) AS reason, count(*)::int AS n FROM esign_documents
        WHERE created_at > now() - interval '30 days' AND state IN ('FAILED', 'REJECTED', 'EXPIRED', 'CANCELLED')
        GROUP BY 1 ORDER BY 2 DESC LIMIT 10`);
    const [w] = await this.db.query<any>(
      `SELECT count(*)::int AS received, count(*) FILTER (WHERE NOT sig_ok)::int AS bad_signature,
              count(*) FILTER (WHERE duplicate)::int AS duplicate, max(received_at) AS last_at
         FROM esign_events WHERE received_at > now() - interval '30 days'`);
    const base = (await this.setting('site.base_url', '')).replace(/\/+$/, '');
    return {
      provider: mode, setting, mockAllowed: !isProd(), url: { set: !!process.env.ESIGN_URL?.trim() }, keys,
      missing: mode === 'HTTP' ? HttpESign.missing() : [], configured: EsignService.configuredFor(mode),
      webhookUrl: base ? `${base}/api/v1/webhooks/esign` : '/api/v1/webhooks/esign',
      last30: { requested: s.requested, signed: s.signed, pending: s.pending, closed: s.closed, failed: s.failed, reasons },
      webhook: { received: w.received, badSignature: w.bad_signature, duplicate: w.duplicate, lastAt: w.last_at },
    };
  }

  async documents(days = 30) {
    const d = [1, 7, 30, 90].includes(days) ? days : 30;
    const rows = await this.db.query<any>(
      `SELECT e.id, e.deal_id AS "dealId", e.provider, e.doc_id AS "docId", e.state, left(e.doc_hash, 12) AS "hash",
              (e.buyer_signed_at IS NOT NULL) AS "buyerSigned", (e.seller_signed_at IS NOT NULL) AS "sellerSigned",
              e.error_kind AS "errorKind", e.created_at AS "createdAt", e.completed_at AS "completedAt", e.expires_at AS "expiresAt"
         FROM esign_documents e WHERE e.created_at > now() - make_interval(days => $1::int)
        ORDER BY e.created_at DESC LIMIT 100`, [d]);
    return { days: d, rows };
  }
}

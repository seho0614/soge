import { createHash } from 'crypto';
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { HttpESign } from '../deal/esign.provider';
import { EsignService } from '../deal/esign.service';
import { alertOnceByKey, clean, DAY_RE, ID_RE, isOn, kstToday, resolveByKey, setting, UUID_RE } from './common';

/* ---------------------------------------------------------------------
 * v10.609 (docs/751) ㉕ 파트너 계약 갱신 알림 · 재서명
 *   안심소개 파트너(partners)와 맺은 계약을 한 줄씩(bzx_partner_contracts) — 종이로 맺은 계약은 「종이 계약 적기」(PAPER · 이미 서명)
 *   만기 notice_days 일 전부터 운영 알림 BZX_PARTNER_RENEW(계약 · 만기일마다 한 번 · 정기 작업 bzx_daily 09:35)
 *     bzx.partner_notice on(처음 off) 이면 파트너 대표 계정에도 회원 알림 BZX_PARTNER_CONTRACT(파트너센터 › 계약)
 *   갱신 = 새 줄(prev_id)로 다시 서명 받기 — 본문은 파트너 표준계약서(contract_templates PARTNER_STD 지금 쓰는 판) + 계약 머리(상호 · 기간)
 *     서명 길: bzx.partner_esign off(처음) = 간주(ASSUME · 파트너 대표가 파트너센터에서 이름 적어 서명 · 법적 전자서명 아님 표시)
 *              on = 기존 전자계약 방식 esign.provider 그대로 — STUB · MOCK 은 화면 안 서명 · HTTP 는 기존 ESIGN 어댑터(HttpESign · 서명자 SELLER 자리 1명)
 *              HTTP 인데 키가 없으면 NOT_READY(422) — 근로계약서(v10.459 hr-contract.ts)와 같은 규칙
 *   만기가 지난 계약은 EXPIRED(갱신 계약이 서명돼 있으면 ENDED) · 갱신 없이 지나면 운영 알림 BZX_PARTNER_EXPIRED
 *   보낸 지 14일 넘게 서명이 없으면 운영 알림 BZX_PARTNER_UNSIGNED(한 번)
 *   ★ HttpESign 은 거래 계약용(서명자 BUYER · SELLER) — 파트너는 SELLER 자리로 보냄(업체 정해지면 칸 확인 · NOTES).
 * ------------------------------------------------------------------- */

export const PC_STATES = ['SENT', 'SIGNED', 'EXPIRED', 'ENDED', 'CANCELED'] as const;
const UNSIGNED_DAYS = 14;

export function pcHash(partnerId: string, prevId: string | null, body: string) {
  return createHash('sha256').update(JSON.stringify({ partner: partnerId, prev: prevId, body }), 'utf8').digest('hex');
}

export async function pcSignMode(db: DatabaseService): Promise<'ASSUME' | 'STUB' | 'MOCK' | 'HTTP'> {
  if (!(await isOn(db, 'bzx.partner_esign'))) return 'ASSUME';
  return EsignService.readMode((await setting(db, 'esign.provider')) || 'STUB');
}

interface Row {
  id: string; partner_id: string; prev_id: string | null; title: string; start_on: string; end_on: string; notice_days: number; auto_renew: boolean;
  body: string | null; doc_hash: string | null; state: string; sign_mode: string; vendor_doc_id: string | null; sign_url: string | null;
  sent_at: string | null; signed_at: string | null; signer_name: string | null; cancel_reason: string | null; created_at: string;
  company: string; ceo_name: string | null; owner_id: string; owner_email: string | null;
}
const SELECT = `SELECT c.id::text AS id, c.partner_id::text AS partner_id, c.prev_id::text AS prev_id, c.title, c.start_on::text AS start_on, c.end_on::text AS end_on,
                       c.notice_days, c.auto_renew, c.body, c.doc_hash, c.state, c.sign_mode, c.vendor_doc_id, c.sign_url, c.sent_at, c.signed_at, c.signer_name,
                       c.cancel_reason, c.created_at, b.company_name AS company, b.ceo_name, b.account_id::text AS owner_id, a.email::text AS owner_email
                  FROM bzx_partner_contracts c JOIN partners p ON p.id = c.partner_id JOIN businesses b ON b.id = p.business_id
                  LEFT JOIN accounts a ON a.id = b.account_id`;

async function row(db: DatabaseService, id: string, lock = false): Promise<Row> {
  if (!ID_RE.test(String(id ?? ''))) throw new NotFound('없는 파트너 계약입니다.');
  const [r] = await db.query<Row>(`${SELECT} WHERE c.id = $1::bigint` + (lock ? ' FOR UPDATE OF c' : ''), [id]);
  if (!r) throw new NotFound('없는 파트너 계약입니다.');
  return r;
}
const daysLeft = (end: string, today: string) => Math.round((Date.parse(end) - Date.parse(today)) / 86400e3);

/** GET /admin/bzx/partner-contracts?state=&due=1 */
export async function pcList(db: DatabaseService, q: { state?: string; due?: boolean }) {
  const st = (PC_STATES as readonly string[]).includes(q.state ?? '') ? q.state! : '';
  const today = kstToday();
  const rows = await db.query<Row & { next_state: string | null; next_id: string | null }>(
    `${SELECT.replace('SELECT c.id::text AS id', 'SELECT n.state AS next_state, n.id::text AS next_id, c.id::text AS id')}
       LEFT JOIN LATERAL (SELECT x.id, x.state FROM bzx_partner_contracts x WHERE x.prev_id = c.id AND x.state IN ('SENT', 'SIGNED') ORDER BY x.id DESC LIMIT 1) n ON true
      WHERE ($1::text = '' OR c.state = $1)
        AND (NOT $2::boolean OR (c.state = 'SIGNED' AND c.end_on - $3::date <= c.notice_days AND n.id IS NULL))
      ORDER BY (c.state = 'SENT') DESC, c.end_on, c.id DESC LIMIT 300`, [st, !!q.due, today]);
  const partners = await db.query<{ id: string; company: string; status: string }>(
    `SELECT p.id::text AS id, b.company_name AS company, p.status FROM partners p JOIN businesses b ON b.id = p.business_id
      WHERE p.status IN ('ACTIVE', 'SUSPENDED') ORDER BY b.company_name LIMIT 500`);
  const mode = await pcSignMode(db);
  const ready = mode !== 'HTTP' || !HttpESign.missing().length;
  const [tpl] = await db.query<{ version: string }>(`SELECT version FROM contract_templates WHERE code = 'PARTNER_STD' AND scope = 'PARTNER' AND is_active ORDER BY effective_from DESC LIMIT 1`);
  return {
    items: rows.map((r) => ({
      id: r.id, partnerId: r.partner_id, company: r.company, prevId: r.prev_id, title: r.title, startOn: r.start_on, endOn: r.end_on,
      noticeDays: r.notice_days, autoRenew: r.auto_renew, state: r.state, signMode: r.sign_mode, sentAt: r.sent_at, signedAt: r.signed_at,
      signerName: r.signer_name, cancelReason: r.cancel_reason, daysLeft: daysLeft(r.end_on, today),
      due: r.state === 'SIGNED' && daysLeft(r.end_on, today) <= r.notice_days && !r.next_id, next: r.next_id ? { id: r.next_id, state: r.next_state } : null,
    })),
    partners, signMode: mode, ready, template: tpl?.version ?? null, partnerNotice: await isOn(db, 'bzx.partner_notice'),
    note: mode === 'ASSUME' ? '지금은 간주 서명입니다(bzx.partner_esign off) — 파트너 대표가 파트너센터 › 계약에서 이름을 적어 서명하며 법적 전자서명이 아닙니다.'
      : mode === 'HTTP' ? (ready ? '전자계약 업체로 서명 요청을 보냅니다(서명은 업체 화면).' : '전자계약 키가 없어 보낼 수 없습니다(NOT_READY) — 통합 현황 › 외부 연동 키에서 ESIGN 키를 넣으십시오.')
      : `전자계약 방식 ${mode} — 연동 전 시험 서명(법적 효력 없음 표시).`,
  };
}

export async function pcOne(db: DatabaseService, id: string) {
  const r = await row(db, id);
  return { id: r.id, partnerId: r.partner_id, company: r.company, prevId: r.prev_id, title: r.title, startOn: r.start_on, endOn: r.end_on, noticeDays: r.notice_days,
           autoRenew: r.auto_renew, body: r.body, docHash: r.doc_hash, state: r.state, signMode: r.sign_mode, sentAt: r.sent_at, signedAt: r.signed_at,
           signerName: r.signer_name, cancelReason: r.cancel_reason,
           legal: r.sign_mode === 'HTTP' ? '전자계약 업체 서명' : r.sign_mode === 'PAPER' ? '종이 계약(서명본은 계약 대장 · 사내 문서함)' : '간주 · 시험 서명 — 법적 전자서명 아님(연동 뒤 업체 서명으로 다시 받으십시오)' };
}

export interface PcInput { partnerId?: string; prevId?: string; title?: string; startOn?: string; endOn: string; noticeDays?: number; autoRenew?: boolean; paper?: boolean }

function checkDates(startOn: string, endOn: string) {
  if (!DAY_RE.test(startOn) || !DAY_RE.test(endOn)) throw new PolicyViolation('BZX_PC_DATE', '날짜는 YYYY-MM-DD 입니다.');
  if (endOn <= startOn) throw new PolicyViolation('BZX_PC_DATE', '만기일은 시작일보다 뒤여야 합니다.');
}

/** 본문 = 계약 머리 + 파트너 표준계약서(지금 판) — 서명 뒤 바꾸지 않음(지문 고정) */
async function makeBody(db: DatabaseService, company: string, title: string, startOn: string, endOn: string, autoRenew: boolean) {
  const [t] = await db.query<{ version: string; body: string }>(
    `SELECT version, body FROM contract_templates WHERE code = 'PARTNER_STD' AND scope = 'PARTNER' AND is_active ORDER BY effective_from DESC LIMIT 1`);
  if (!t) throw new PolicyViolation('BZX_PC_TEMPLATE', '쓰는 파트너 표준계약서(PARTNER_STD)가 없습니다 — 약관 · 계약서 양식을 먼저 확인하십시오.');
  const head = [`# ${title}`, '', `- 회사: (주)한국바이오헬스케어 소개뱅크 사업부`, `- 파트너: ${company}`, `- 계약 기간: ${startOn} ~ ${endOn}`,
    `- 자동 갱신: ${autoRenew ? '있음(만기 전 해지 통보가 없으면 같은 조건으로 갱신)' : '없음'}`, `- 적용 양식: 파트너 표준계약서 ${t.version}판`, '', '---', ''].join('\n');
  return { body: `${head}${t.body}`.slice(0, 30000), version: t.version };
}

/** POST /admin/bzx/partner-contracts — 새 계약 · 갱신(prevId) 보내기 또는 종이 계약 적기(paper) */
export async function pcCreate(db: DatabaseService, b: PcInput, actor: string | null) {
  const paper = b.paper === true;
  const mode = paper ? 'PAPER' : await pcSignMode(db);
  if (mode === 'HTTP' && HttpESign.missing().length) throw new PolicyViolation('NOT_READY', `전자계약 연동 키가 없습니다(${HttpESign.missing().join(', ')}) — 통합 현황 › 외부 연동 키에서 넣거나 bzx.partner_esign 을 끄십시오.`);
  const notice = b.noticeDays == null ? 30 : Number(b.noticeDays);
  if (!Number.isInteger(notice) || notice < 1 || notice > 180) throw new PolicyViolation('BZX_PC_NOTICE', '알림 일수는 1 ~ 180일입니다.');
  let toNotify: { owner: string; title: string; body: string } | null = null;
  const out = await db.transaction(async () => {
    let partnerId = String(b.partnerId ?? '');
    let prev: Row | null = null;
    if (b.prevId) {
      prev = await row(db, b.prevId, true);
      if (prev.state !== 'SIGNED') throw new StateConflict('BZX_PC_STATE', '서명이 끝난(효력 있는) 계약만 갱신합니다.');
      if (paper) throw new PolicyViolation('BZX_PC_INPUT', '갱신은 서명을 다시 받습니다 — 종이 계약 적기는 새 계약으로 하십시오.');
      const [busy] = await db.query(`SELECT 1 FROM bzx_partner_contracts WHERE prev_id = $1::bigint AND state IN ('SENT', 'SIGNED')`, [prev.id]);
      if (busy) throw new StateConflict('BZX_PC_RENEWING', '이미 보낸(또는 서명된) 갱신 계약이 있습니다.');
      partnerId = prev.partner_id;
    }
    if (!UUID_RE.test(partnerId)) throw new PolicyViolation('BZX_PC_INPUT', '파트너를 고르십시오.');
    const [p] = await db.query<{ company: string; status: string; owner: string; email: string | null; ceo: string | null }>(
      `SELECT b.company_name AS company, p.status, b.account_id::text AS owner, a.email::text AS email, b.ceo_name AS ceo
         FROM partners p JOIN businesses b ON b.id = p.business_id LEFT JOIN accounts a ON a.id = b.account_id WHERE p.id = $1::uuid`, [partnerId]);
    if (!p) throw new NotFound('없는 파트너입니다.');
    if (!['ACTIVE', 'SUSPENDED'].includes(p.status)) throw new StateConflict('BZX_PC_PARTNER', '승인된(또는 정지 중인) 파트너만 계약을 맺습니다.');
    const startOn = b.startOn ?? (prev ? new Date(Date.parse(prev.end_on) + 86400e3).toISOString().slice(0, 10) : kstToday());
    checkDates(startOn, b.endOn);
    if (prev && startOn <= prev.start_on) throw new PolicyViolation('BZX_PC_DATE', '갱신 계약은 지금 계약 시작일보다 뒤에 시작합니다.');
    const autoRenew = b.autoRenew ?? prev?.auto_renew ?? false;
    const title = clean(b.title, 100) || (prev ? `${prev.title.replace(/ \(갱신 \d+\)$/, '')} (갱신 ${startOn.slice(0, 4)})` : `안심소개 파트너 계약 — ${p.company}`);
    if (title.length < 2) throw new PolicyViolation('BZX_PC_INPUT', '계약 이름은 2 ~ 100자입니다.');
    if (paper) {
      const [r] = await db.query<{ id: string }>(
        `INSERT INTO bzx_partner_contracts (partner_id, title, start_on, end_on, notice_days, auto_renew, state, sign_mode, signed_at, signer_name, created_by)
         VALUES ($1::uuid, $2, $3::date, $4::date, $5::int, $6::boolean, 'SIGNED', 'PAPER', now(), $7, $8::uuid) RETURNING id::text AS id`,
        [partnerId, title, startOn, b.endOn, notice, autoRenew, (p.ceo || p.company).slice(0, 60), actor]);
      return { ok: true, id: r!.id, state: 'SIGNED', signMode: 'PAPER', note: `${p.company} 종이 계약을 적었습니다(만기 ${b.endOn} · ${notice}일 전부터 알림).` };
    }
    const { body, version } = await makeBody(db, p.company, title, startOn, b.endOn, autoRenew);
    const hash = pcHash(partnerId, prev?.id ?? null, body);
    const [r] = await db.query<{ id: string }>(
      `INSERT INTO bzx_partner_contracts (partner_id, prev_id, title, start_on, end_on, notice_days, auto_renew, body, doc_hash, template_version, state, sign_mode, sent_at, sent_by, created_by)
       VALUES ($1::uuid, $2::bigint, $3, $4::date, $5::date, $6::int, $7::boolean, $8, $9, $10, 'SENT', $11, now(), $12::uuid, $12::uuid) RETURNING id::text AS id`,
      [partnerId, prev?.id ?? null, title, startOn, b.endOn, notice, autoRenew, body, hash, version, mode, actor]);
    let docId: string | null = null, url: string | null = null;
    if (mode === 'HTTP') {
      const base = (await setting(db, 'site.base_url')).replace(/\/+$/, '');
      const x = await new HttpESign().create({
        contractId: `PC-${r!.id}`, title: `${title} — 소개뱅크`, content: body, docHash: hash,
        expiresAt: new Date(Date.now() + UNSIGNED_DAYS * 86400e3).toISOString(), callbackUrl: `${base}/api/v1/webhooks/esign`,
        signers: [{ role: 'SELLER', name: p.ceo || p.company, email: p.email ?? null }],
      });
      if (!x.ok || !x.docId) throw new StateConflict('ESIGN_FAILED', `전자계약 요청이 실패했습니다(${x.errorKind ?? ''} ${String(x.error ?? '').slice(0, 80)}).`);
      docId = x.docId; url = x.signUrls?.SELLER ?? null;
    } else if (mode === 'MOCK') docId = `MOCK-PC-${r!.id}-${Date.now()}`;
    if (docId || url) await db.query(`UPDATE bzx_partner_contracts SET vendor_doc_id = $2, sign_url = $3 WHERE id = $1::bigint`, [r!.id, docId, url]);
    toNotify = { owner: p.owner, title: `${title} — 서명을 부탁드립니다`, body: `계약 기간 ${startOn} ~ ${b.endOn}. 파트너센터 › 계약에서 내용을 확인하고 서명해 주십시오.` };
    return { ok: true, id: r!.id, state: 'SENT', signMode: mode, stub: mode !== 'HTTP',
             note: mode === 'HTTP' ? `${p.company} 에 전자서명 요청을 보냈습니다(업체 화면에서 서명).`
               : mode === 'ASSUME' ? `${p.company} 파트너센터 › 계약에 서명할 계약서를 올렸습니다(간주 서명 · 법적 전자서명 아님).`
               : `${p.company} 파트너센터 › 계약에 서명할 계약서를 올렸습니다(시험 서명 · 법적 전자서명 아님).` };
  });
  /* 회원 알림은 거래 밖에서(실패해도 계약은 그대로) */
  const n = toNotify as { owner: string; title: string; body: string } | null;
  if (n && (await isOn(db, 'bzx.partner_notice'))) await notifyPartner(db, n.owner, n.title, n.body);
  return out;
}

async function notifyPartner(db: DatabaseService, owner: string, title: string, body: string) {
  await db.query(`INSERT INTO notifications (account_id, event_code, title, body, link_url) VALUES ($1::uuid, 'BZX_PARTNER_CONTRACT', $2, $3, '/partner/contracts')`,
    [owner, title.slice(0, 120), body.slice(0, 500)]).catch(() => undefined);
}

async function afterSigned(db: DatabaseService, c: Row) {
  if (c.prev_id) await resolveByKey(db, 'BZX_PARTNER_RENEW', `pc|${c.prev_id}|`, '갱신 계약 서명됨');
  await resolveByKey(db, 'BZX_PARTNER_UNSIGNED', `pc|${c.id}|`, '서명됨');
}

/** POST /admin/bzx/partner-contracts/{id}/check — 업체 상태 맞추기(HTTP 만) */
export async function pcCheck(db: DatabaseService, id: string) {
  const c = await row(db, id);
  if (c.state !== 'SENT') throw new StateConflict('BZX_PC_STATE', '보낸 계약만 상태를 봅니다.');
  if (c.sign_mode !== 'HTTP' || !c.vendor_doc_id) return { ok: true, id: c.id, state: c.state, note: '화면 안 서명이라 업체 상태가 없습니다 — 파트너가 파트너센터에서 서명합니다.' };
  if (HttpESign.missing().length) throw new PolicyViolation('NOT_READY', '전자계약 연동 키가 없습니다.');
  const s = await new HttpESign().status(c.vendor_doc_id);
  if (!s.ok) throw new StateConflict('ESIGN_FAILED', `업체 상태를 읽지 못했습니다(${s.errorKind ?? ''}).`);
  if (s.docHash && s.docHash !== c.doc_hash) throw new StateConflict('BZX_PC_HASH', '업체 문서 지문이 우리 계약서와 다릅니다 — 서명으로 보지 않습니다.');
  const signed = (s.signers ?? []).find((x) => x.role === 'SELLER');
  if (s.state === 'SIGNED' && signed) {
    await db.query(`UPDATE bzx_partner_contracts SET state = 'SIGNED', signed_at = $2::timestamptz, signer_name = $3, sign_evidence = $4::jsonb WHERE id = $1::bigint AND state = 'SENT'`,
      [c.id, signed.signedAt, (c.ceo_name || c.company).slice(0, 60), JSON.stringify({ mode: 'HTTP', stub: false, vendorState: s.state, vendorDoc: c.vendor_doc_id })]);
    await afterSigned(db, c);
    return { ok: true, id: c.id, state: 'SIGNED', note: '업체 서명을 받았습니다(서명본 보관).' };
  }
  if (s.state === 'REJECTED' || s.state === 'EXPIRED' || s.state === 'CANCELLED') {
    await db.query(`UPDATE bzx_partner_contracts SET state = 'CANCELED', cancel_reason = $2 WHERE id = $1::bigint AND state = 'SENT'`, [c.id, `업체 상태 ${s.state}`]);
    return { ok: true, id: c.id, state: 'CANCELED', note: `업체에서 ${s.state} — 계약을 취소로 두었습니다(다시 보내십시오).` };
  }
  return { ok: true, id: c.id, state: 'SENT', note: '아직 서명 전입니다.' };
}

/** POST /admin/bzx/partner-contracts/{id}/cancel — 보낸 것만 취소(사유) */
export async function pcCancel(db: DatabaseService, id: string, reasonIn: string) {
  const reason = clean(reasonIn, 200);
  if (reason.length < 2) throw new PolicyViolation('BZX_REASON', '사유는 2 ~ 200자입니다.');
  return db.transaction(async () => {
    const c = await row(db, id, true);
    if (c.state !== 'SENT') throw new StateConflict('BZX_PC_STATE', '서명 전(보낸) 계약만 취소합니다.');
    if (c.sign_mode === 'HTTP' && c.vendor_doc_id && !HttpESign.missing().length) await new HttpESign().cancel(c.vendor_doc_id).catch(() => undefined);
    await db.query(`UPDATE bzx_partner_contracts SET state = 'CANCELED', cancel_reason = $2 WHERE id = $1::bigint`, [c.id, reason]);
    await resolveByKey(db, 'BZX_PARTNER_UNSIGNED', `pc|${c.id}|`, '취소함');
    return { ok: true, id: c.id, state: 'CANCELED', note: '계약을 취소했습니다(기록은 남음).' };
  });
}

/* ── 파트너센터(대표 계정만) ── */
async function ownedPartner(db: DatabaseService, actor: string | null) {
  if (!actor) throw new NotFound('파트너가 아닙니다.');
  const [p] = await db.query<{ id: string; company: string; ceo: string | null }>(
    `SELECT p.id::text AS id, b.company_name AS company, b.ceo_name AS ceo FROM partners p JOIN businesses b ON b.id = p.business_id
      WHERE b.account_id = $1::uuid AND p.status IN ('ACTIVE', 'SUSPENDED') ORDER BY p.approved_at DESC NULLS LAST LIMIT 1`, [actor]);
  if (!p) throw new NotFound('파트너 대표 계정만 계약을 봅니다.');
  return p;
}

/** GET /partner/bzx/contracts — 내 파트너 계약(서명 기다림은 본문까지) */
export async function pcMine(db: DatabaseService, actor: string | null) {
  const p = await ownedPartner(db, actor);
  const today = kstToday();
  const rows = await db.query<Row>(`${SELECT} WHERE c.partner_id = $1::uuid AND c.state <> 'CANCELED' ORDER BY c.id DESC LIMIT 30`, [p.id]);
  return {
    company: p.company,
    items: rows.map((r) => ({ id: r.id, title: r.title, startOn: r.start_on, endOn: r.end_on, state: r.state, signMode: r.sign_mode, signedAt: r.signed_at,
      signerName: r.signer_name, daysLeft: daysLeft(r.end_on, today), autoRenew: r.auto_renew,
      body: r.state === 'SENT' || r.state === 'SIGNED' ? r.body : null, docHash: r.state === 'SENT' ? r.doc_hash : null,
      signUrl: r.state === 'SENT' && r.sign_mode === 'HTTP' ? r.sign_url : null })),
  };
}

/** POST /partner/bzx/contracts/{id}/sign — 대표 서명(간주 · STUB · MOCK) · 이름은 대표자 이름 또는 상호 */
export async function pcSign(db: DatabaseService, actor: string | null, id: string, b: { signerName: string; agree: boolean; docHash?: string }, ua?: string | null) {
  const p = await ownedPartner(db, actor);
  if (b.agree !== true) throw new PolicyViolation('BZX_PC_AGREE', '계약 내용을 읽고 동의해야 서명합니다.');
  return db.transaction(async () => {
    const c = await row(db, id, true);
    if (c.partner_id !== p.id) throw new NotFound('없는 파트너 계약입니다.');
    if (c.state !== 'SENT') throw new StateConflict('BZX_PC_STATE', c.state === 'SIGNED' ? '이미 서명한 계약입니다.' : '서명할 수 있는 계약이 아닙니다.');
    if (c.sign_mode === 'HTTP') throw new StateConflict('ESIGN_EXTERNAL', '이 계약은 전자계약 업체 화면에서 서명합니다(받은 메일 · 문자의 주소).');
    if (b.docHash && b.docHash !== c.doc_hash) throw new StateConflict('BZX_PC_HASH', '보신 본문과 지금 계약서가 다릅니다 — 화면을 새로 고치십시오.');
    if (!c.body || pcHash(c.partner_id, c.prev_id, c.body) !== c.doc_hash) throw new StateConflict('BZX_PC_HASH', '계약서 지문이 맞지 않습니다 — 운영에 알리십시오.');
    const name = clean(b.signerName, 60);
    const norm = (s: string | null) => String(s ?? '').replace(/\s/g, '');
    if (!name || (norm(name) !== norm(p.ceo) && norm(name) !== norm(p.company))) throw new PolicyViolation('BZX_PC_SIGNER', '서명 이름이 대표자 이름(또는 상호)과 다릅니다.');
    await db.query(`UPDATE bzx_partner_contracts SET state = 'SIGNED', signed_at = now(), signer_name = $2, sign_evidence = $3::jsonb WHERE id = $1::bigint`,
      [c.id, name, JSON.stringify({ mode: c.sign_mode, stub: true, account: actor, ua: String(ua ?? '').slice(0, 200) || null, docHash: c.doc_hash })]);
    await afterSigned(db, c);
    return { ok: true, id: c.id, state: 'SIGNED', stub: true, note: c.sign_mode === 'ASSUME' ? '서명했습니다(간주 서명 · 법적 전자서명 아님).' : '서명했습니다(시험 서명 · 법적 전자서명 아님).' };
  });
}

/** 정기 작업(bzx_daily · 09:35) — 만기 알림 · 만기 지남 정리 · 서명 없는 계약 알림 */
export async function pcDailyJob(db: DatabaseService, today = kstToday()) {
  const notice = await isOn(db, 'bzx.partner_notice');
  let due = 0, expired = 0, unsigned = 0, notified = 0;
  const near = await db.query<Row & { days_left: number }>(
    `${SELECT.replace('SELECT c.id::text AS id', 'SELECT (c.end_on - $1::date)::int AS days_left, c.id::text AS id')}
      WHERE c.state = 'SIGNED' AND c.end_on >= $1::date AND c.end_on - $1::date <= c.notice_days
        AND NOT EXISTS (SELECT 1 FROM bzx_partner_contracts x WHERE x.prev_id = c.id AND x.state IN ('SENT', 'SIGNED'))`, [today]);
  for (const c of near) {
    const made = await alertOnceByKey(db, 'BZX_PARTNER_RENEW', 'WARN',
      `파트너 계약 만기 ${c.days_left}일 전 — ${c.company} · ${c.title} · 만기 ${c.end_on}${c.auto_renew ? ' · 자동 갱신(해지 통보 기한 확인)' : ''} — 파트너사 › 파트너 계약 갱신`,
      `pc|${c.id}|${c.end_on}`, { contractId: c.id, partnerId: c.partner_id, endOn: c.end_on, autoRenew: c.auto_renew });
    if (made) {
      due++;
      if (notice) { await notifyPartner(db, c.owner_id, `파트너 계약 만기 ${c.days_left}일 전`, `${c.title} — 만기 ${c.end_on}. 갱신 계약은 운영에서 보내 드리며 파트너센터 › 계약에서 서명합니다.`); notified++; }
    }
  }
  const gone = await db.query<{ id: string; title: string; company: string; end_on: string; next: boolean }>(
    `UPDATE bzx_partner_contracts c SET state = CASE WHEN EXISTS (SELECT 1 FROM bzx_partner_contracts x WHERE x.prev_id = c.id AND x.state = 'SIGNED') THEN 'ENDED' ELSE 'EXPIRED' END
      FROM partners p JOIN businesses b ON b.id = p.business_id
     WHERE p.id = c.partner_id AND c.state = 'SIGNED' AND c.end_on < $1::date
     RETURNING c.id::text AS id, c.title, b.company_name AS company, c.end_on::text AS end_on, (c.state = 'ENDED') AS next`, [today]);
  for (const g of gone) {
    await resolveByKey(db, 'BZX_PARTNER_RENEW', `pc|${g.id}|`, g.next ? '갱신 계약으로 넘어감' : '만기 지남');
    if (!g.next) {
      await alertOnceByKey(db, 'BZX_PARTNER_EXPIRED', 'WARN', `파트너 계약이 갱신 없이 끝났습니다 — ${g.company} · ${g.title} · 만기 ${g.end_on} — 파트너사 › 파트너 계약 갱신`,
        `pc|${g.id}|${g.end_on}`, { contractId: g.id, endOn: g.end_on });
      expired++;
    }
  }
  const late = await db.query<Row>(`${SELECT} WHERE c.state = 'SENT' AND c.sent_at < now() - make_interval(days => $1::int)`, [UNSIGNED_DAYS]);
  for (const c of late) {
    if (await alertOnceByKey(db, 'BZX_PARTNER_UNSIGNED', 'INFO', `파트너 계약 서명이 ${UNSIGNED_DAYS}일 넘게 없습니다 — ${c.company} · ${c.title} — 파트너사 › 파트너 계약 갱신`,
      `pc|${c.id}|`, { contractId: c.id })) unsigned++;
  }
  return { due, expired, unsigned, notified };
}

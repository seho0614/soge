import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { EtaxAdapter, EtaxDoc, EtaxResult, fmtApproval } from './etax.adapter';
import { AssumeEtaxAdapter } from './etax.assume';
import { HttpEtaxAdapter } from './etax.http';

/**
 * v10.34 (D093) 국세청 전자세금계산서 전송 — 운영의 「발행」 · 「다시 보내기」 · 「상태 조회」 · 「취소(수정 발행)」
 *
 * 대상은 소개뱅크(운영 법인)가 발행하는 세금계산서 두 가지뿐입니다.
 *   directory  법률 · 세무 정액 노출료(consult_directory_invoices · v10.33 D092)
 *   lead-cash  리드 이용료(lead_cash_invoices · D076)
 * 소개자가 발행하는 정산 세금계산서(settlements.tax_invoice_*)는 발행 주체가 소개자라 여기 없습니다.
 *
 * 흐름
 *   발행        assume.etax on  → 「간주 발행」(state ISSUED · etax_status ASSUMED · 승인번호 없음 · 발행 번호 칸엔 「간주-문서번호」)
 *               off + ETAX_URL  → 업체로 전송 → SENT(승인번호) · SENDING(접수 · 승인 대기) · FAILED(사유)
 *   다시 보내기  FAILED 줄 · 또는 간주 발행 줄(연동 뒤 실제 전송). 업체에 보낸 적이 있는 줄은 **먼저 상태 조회** —
 *               시간 초과로 결과를 못 받았어도 업체 쪽에선 발행됐을 수 있습니다(같은 문서 번호로 두 번 발행하지 않음).
 *   손으로 번호  연동 전 임시 방식(기존 …/issue) — etax_mode MANUAL · 전송하지 않음(보내면 중복 발행).
 *
 * 중복 발행 막기 — ① 「보내는 중(SENDING)」 선점은 조건부 UPDATE 한 번(동시에 두 번 눌러도 하나만)
 *                  ② 문서 번호(etax_doc_key)는 줄마다 하나 · 바뀌지 않음(DB 가드 · 유일 색인)
 *                  ③ 손으로 넣은 줄 · 보낸 줄은 다시 보내지 않음(DB 가드 fn_etax_guard)
 * 키(ETAX_KEY)는 응답 · 기록 · 화면에 싣지 않습니다 — 「등록됨」만.
 */
type KindSlug = 'directory' | 'lead-cash';
const KINDS: Record<KindSlug, { table: string; kind: 'DIRECTORY' | 'LEAD_CASH'; letter: string; label: string; issuedAt: boolean }> = {
  directory: { table: 'consult_directory_invoices', kind: 'DIRECTORY', letter: 'D', label: '법률 · 세무 정액 노출료', issuedAt: true },
  'lead-cash': { table: 'lead_cash_invoices', kind: 'LEAD_CASH', letter: 'L', label: '리드 이용료', issuedAt: false },
};

interface Row {
  id: string; state: string; supply: string; vat: string; total: string; invoice_no: string | null; issued_on: string | null;
  supplier_name: string | null; supplier_biz_no: string | null; buyer_name: string; buyer_biz_no: string | null;
  etax_mode: string | null; etax_status: string | null; etax_doc_key: string | null; etax_approval_no: string | null;
  etax_amend_approval_no: string | null; etax_error: string | null; etax_attempts: number; etax_adapter: string | null;
  etax_sent_at: string | null; etax_result_at: string | null; item: string;
}

@Injectable()
export class EtaxService {
  constructor(private readonly db: DatabaseService) {}
  private get me() { return RequestCtx.actorId(); }

  /* ── 어댑터 고르기 ───────────────────────────────────────────── */
  private async assumeOn() {
    const [r] = await this.db.query<{ on: boolean }>(`SELECT value = 'on' AS on FROM site_settings WHERE key = 'assume.etax'`);
    /* 설정 줄이 없으면 간주로 둡니다 — 키 없이 실제 전송을 시도하지 않습니다 */
    return r ? r.on : true;
  }
  private httpAdapter(): EtaxAdapter {
    const url = (process.env.ETAX_URL ?? '').trim();
    const key = (process.env.ETAX_KEY ?? '').trim();
    if (!url || !key) {
      throw new PolicyViolation('ETAX_NOT_CONFIGURED',
        `전자세금계산서 업체 연동이 아직 없습니다(${!url ? 'ETAX_URL' : 'ETAX_KEY'} 미설정). 업체를 정해 키를 넣기 전에는 간주 모드(assume.etax on)로 두십시오.`);
    }
    return new HttpEtaxAdapter(url, key);
  }
  private readonly assume = new AssumeEtaxAdapter();

  private kind(slug: string) {
    const k = KINDS[slug as KindSlug];
    if (!k) throw new NotFound('세금계산서 종류가 없습니다(directory · lead-cash).');
    return k;
  }
  private uuid(id: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id ?? '')) throw new NotFound('세금계산서가 없습니다.');
  }

  private async load(slug: string, id: string): Promise<{ k: (typeof KINDS)[KindSlug]; r: Row }> {
    const k = this.kind(slug);
    this.uuid(id);
    const cols = `i.id, i.state, i.supply, i.vat, i.total, i.invoice_no, i.issued_on::text AS issued_on,
                  i.etax_mode, i.etax_status, i.etax_doc_key, i.etax_approval_no, i.etax_amend_approval_no, i.etax_error,
                  i.etax_attempts, i.etax_adapter, i.etax_sent_at, i.etax_result_at`;
    const [r] = k.kind === 'DIRECTORY'
      ? await this.db.query<Row>(
        `SELECT ${cols}, i.supplier_name, i.supplier_biz_no, i.buyer_name, i.buyer_biz_no,
                '법률 · 세무 정액 노출료 ' || p.seq || '회차(' || p.period_from || ' ~ ' || p.period_to || ')' AS item
           FROM consult_directory_invoices i JOIN consult_directory_periods p ON p.id = i.period_id WHERE i.id = $1`, [id])
      : await this.db.query<Row>(
        `SELECT ${cols}, NULL::text AS supplier_name, NULL::text AS supplier_biz_no, b.company_name AS buyer_name, b.biz_reg_no AS buyer_biz_no,
                '리드 이용료 ' || i.ym AS item
           FROM lead_cash_invoices i JOIN partners p ON p.id = i.partner_id JOIN businesses b ON b.id = p.business_id WHERE i.id = $1`, [id]);
    if (!r) throw new NotFound('세금계산서가 없습니다.');
    return { k, r };
  }

  /** 공급자 = 운영 법인(설정 footer.*) — 노출료 줄은 발행 요청 때 기록한 값을 씁니다 */
  private async supplier(r: Row) {
    const s = await this.db.query<{ key: string; value: string | null }>(
      `SELECT key, nullif(btrim(value), '') AS value FROM site_settings WHERE key IN ('footer.company_name','footer.biz_reg_no','footer.ceo_name')`);
    const v = (key: string) => s.find((x) => x.key === key)?.value ?? null;
    const name = r.supplier_name ?? v('footer.company_name');
    const bizNo = r.supplier_biz_no ?? v('footer.biz_reg_no');
    if (!name || !bizNo) throw new PolicyViolation('ETAX_SUPPLIER', '공급자(운영 법인) 정보가 없습니다 — 설정 footer.company_name · footer.biz_reg_no 를 먼저 채워 주십시오.');
    return { name, bizNo, ceoName: v('footer.ceo_name') };
  }

  private docKey(k: (typeof KINDS)[KindSlug], id: string, today: string) {
    /* 업체 관리 번호는 보통 24자 이하 · 영문 숫자 - 만 — SGB-D-261011-0123456789 (23자) */
    return `SGB-${k.letter}-${today.replace(/-/g, '').slice(2)}-${id.replace(/-/g, '').slice(0, 10)}`;
  }
  private async today() {
    const [d] = await this.db.query<{ d: string }>(`SELECT (now() AT TIME ZONE 'Asia/Seoul')::date::text AS d`);
    return d.d;
  }

  private async log(k: (typeof KINDS)[KindSlug], id: string, action: 'ISSUE' | 'STATUS' | 'CANCEL', adapter: string, docKey: string, res: EtaxResult, ms: number) {
    await this.db.query(
      `INSERT INTO etax_send_log (invoice_kind, invoice_id, action, adapter, doc_key, result, approval_no, error_kind, error, http_status, duration_ms, actor_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [k.kind, id, action, adapter, docKey, res.status, res.approvalNo ?? null, res.errorKind ?? null, res.error ?? null,
       res.httpStatus ?? null, ms, this.me ?? null]);
  }
  private async call(k: (typeof KINDS)[KindSlug], id: string, action: 'ISSUE' | 'STATUS' | 'CANCEL', a: EtaxAdapter, docKey: string, fn: () => Promise<EtaxResult>) {
    const t0 = Date.now();
    let res: EtaxResult;
    try { res = await fn(); } catch (e: any) {
      res = { status: 'FAILED', approvalNo: null, errorKind: 'NETWORK', error: `어댑터 오류 — ${String(e?.message ?? e).slice(0, 120)}` };
    }
    await this.log(k, id, action, a.name, docKey, res, Date.now() - t0);
    return res;
  }

  /* ── 결과를 줄에 기록 ───────────────────────────────────────── */
  private async record(k: (typeof KINDS)[KindSlug], id: string, res: EtaxResult, today: string) {
    if (res.status === 'SENT') {
      /* 발행 요청이던 줄은 「발행됨」 + 발행 번호 = 승인번호(8-8-8). 간주로 이미 발행된 줄은 발행 칸 그대로 · 승인번호만 */
      await this.db.query(
        `UPDATE ${k.table}
            SET etax_status = 'SENT', etax_mode = 'ASP', etax_approval_no = $2, etax_error = NULL, etax_result_at = now(),
                invoice_no = CASE WHEN state = 'REQUESTED' THEN $3 ELSE invoice_no END,
                issued_on  = CASE WHEN state = 'REQUESTED' THEN $4::date ELSE issued_on END,
                issued_by  = CASE WHEN state = 'REQUESTED' THEN $5::uuid ELSE issued_by END,
                ${k.issuedAt ? `issued_at = CASE WHEN state = 'REQUESTED' THEN now() ELSE issued_at END,` : ''}
                state = 'ISSUED'
          WHERE id = $1`, [id, res.approvalNo, fmtApproval(res.approvalNo), today, this.me ?? null]);
    } else if (res.status === 'SENDING') {
      await this.db.query(`UPDATE ${k.table} SET etax_status = 'SENDING', etax_mode = 'ASP', etax_error = NULL, etax_result_at = now() WHERE id = $1`, [id]);
    } else if (res.status === 'CANCELED') {
      await this.db.query(`UPDATE ${k.table} SET etax_status = 'CANCELED', etax_amend_approval_no = coalesce($2, etax_amend_approval_no), etax_error = NULL, etax_result_at = now() WHERE id = $1`,
        [id, res.amendApprovalNo ?? null]);
    } else {
      await this.db.query(`UPDATE ${k.table} SET etax_status = 'FAILED', etax_error = $2, etax_result_at = now() WHERE id = $1`,
        [id, res.error ?? '전송 실패']);
    }
  }

  /** 운영 화면 · 응답 — 키 없음 · 승인번호는 8-8-8 */
  private async view(slug: string, id: string) {
    const { k, r } = await this.load(slug, id);
    return {
      id: r.id, kind: k.kind, state: r.state, invoiceNo: r.invoice_no, issuedOn: r.issued_on,
      etaxMode: r.etax_mode, etaxStatus: r.etax_status, assumed: r.etax_status === 'ASSUMED',
      approvalNo: fmtApproval(r.etax_approval_no), amendApprovalNo: fmtApproval(r.etax_amend_approval_no),
      docKey: r.etax_doc_key, etaxError: r.etax_error, attempts: r.etax_attempts, adapter: r.etax_adapter,
      sentAt: r.etax_sent_at, resultAt: r.etax_result_at,
    };
  }

  /* ── 연동 상태(화면 띠) ───────────────────────────────────────── */
  async status() {
    const assume = await this.assumeOn();
    const url = (process.env.ETAX_URL ?? '').trim();
    const keySet = !!(process.env.ETAX_KEY ?? '').trim();
    const [itg] = await this.db.query<any>(
      `SELECT i.status, coalesce(cl.label, i.status) AS "statusLabel", i.provider, i.blocks_open AS "blocksOpen",
              i.secret_key_name AS "secretKeyName", i.secret_registered AS "secretRegistered"
         FROM integrations i LEFT JOIN code_labels cl ON cl.domain = 'integration.status' AND cl.code = i.status
        WHERE i.code = 'ETAX'`);
    const counts = await this.db.query<{ kind: string; status: string; n: string }>(
      `SELECT 'DIRECTORY' AS kind, coalesce(etax_status, CASE WHEN etax_mode = 'MANUAL' THEN 'MANUAL' WHEN state = 'REQUESTED' THEN 'REQUESTED' ELSE 'OTHER' END) AS status, count(*) AS n
         FROM consult_directory_invoices GROUP BY 1, 2
       UNION ALL
       SELECT 'LEAD_CASH', coalesce(etax_status, CASE WHEN etax_mode = 'MANUAL' THEN 'MANUAL' WHEN state = 'REQUESTED' THEN 'REQUESTED' ELSE state END), count(*)
         FROM lead_cash_invoices GROUP BY 1, 2`);
    let host: string | null = null;
    try { host = url ? new URL(url).host : null; } catch { host = '(주소 형식 오류)'; }
    const adapter = assume ? 'assume' : url && keySet ? 'http' : null;
    return {
      assume, adapter, configured: !!url && keySet, urlHost: host,
      keyName: 'ETAX_KEY', keySet, /* 값은 싣지 않습니다 — 등록 여부만 */
      integration: itg ?? null,
      counts: counts.map((c) => ({ ...c, n: Number(c.n) })),
      note: assume
        ? '간주 모드(assume.etax on) — 국세청에 전송하지 않습니다. 「발행」은 「간주 발행」으로만 기록되고 승인번호가 없습니다. 업체 연동 · 시험 전송 뒤 off 로 바꾸십시오.'
        : adapter === 'http' ? `업체 연동 사용 중 — ${host} 로 전송합니다.`
        : '간주 모드가 꺼졌는데 업체 연동(ETAX_URL · ETAX_KEY)이 없습니다 — 「발행」이 거부됩니다(ETAX_NOT_CONFIGURED).',
    };
  }

  /* ── 발행 · 다시 보내기 ──────────────────────────────────────── */
  async send(slug: string, id: string, mode: 'send' | 'resend') {
    const { k, r } = await this.load(slug, id);
    if (r.etax_mode === 'MANUAL') throw new StateConflict('ETAX_MANUAL', '발행 번호를 손으로 넣은 줄입니다(연동 전 임시 방식) — 전송하면 중복 발행이 됩니다.');
    if (r.state === 'CANCELED') throw new StateConflict('ETAX_CANCELED_INVOICE', '취소된 발행 요청입니다.');
    if (r.etax_status === 'SENT' || r.etax_status === 'CANCELED') throw new StateConflict('ETAX_ALREADY_SENT', `이미 국세청에 보낸 세금계산서입니다(${r.etax_status === 'SENT' ? '승인번호 ' + fmtApproval(r.etax_approval_no) : '취소됨'}).`);
    if (r.etax_status === 'SENDING') throw new StateConflict('ETAX_IN_FLIGHT', '보내는 중 · 국세청 승인 대기입니다 — 「상태 조회」로 결과를 읽으십시오.');
    const assume = await this.assumeOn();
    if (mode === 'send') {
      if (r.etax_status === 'ASSUMED') throw new StateConflict('ETAX_ALREADY_ASSUMED', '이미 간주 발행된 줄입니다 — 연동 뒤(assume.etax off) 「다시 보내기」로 실제 전송합니다.');
      if (r.etax_status === 'FAILED') throw new StateConflict('ETAX_USE_RESEND', '전송에 실패한 줄입니다 — 「다시 보내기」를 쓰십시오.');
      if (r.state !== 'REQUESTED') throw new StateConflict('NOT_REQUESTED', '발행 요청 상태가 아닙니다.');
    } else {
      if (!r.etax_status) throw new StateConflict('ETAX_NOT_SENT', '아직 보낸 적이 없습니다 — 「발행」을 쓰십시오.');
      if (r.etax_status === 'ASSUMED' && assume) throw new StateConflict('ETAX_STILL_ASSUMED', '간주 모드(assume.etax on)라 실제 전송을 할 수 없습니다 — 업체 연동 뒤 off 로 바꾸고 다시 보내십시오.');
      if (r.etax_status === 'FAILED' && r.etax_adapter === 'http' && assume) {
        throw new StateConflict('ETAX_STILL_ASSUMED', '업체에 보낸 적이 있는 줄은 간주로 바꾸지 않습니다 — 간주 모드를 끄고 다시 보내십시오(업체 쪽 발행 여부를 먼저 조회합니다).');
      }
    }
    /* v10.38 (D096 · P2P) — 개인 파트너(개인 활동 정보 · 사업자등록번호 없음)는 세금계산서 대상이 아닙니다 */
    if (!r.buyer_biz_no) {
      throw new PolicyViolation('ETAX_PERSON_BUYER',
        '공급받는 분이 개인(사업자등록번호 없음)입니다 — 세금계산서 대신 카드 · 현금영수증으로 갈음합니다. 발행 번호(영수증 번호)를 직접 넣어 닫으십시오.');
    }
    const a: EtaxAdapter = assume ? this.assume : this.httpAdapter();
    const supplier = await this.supplier(r);
    const today = await this.today();
    const docKey = r.etax_doc_key ?? this.docKey(k, r.id, today);

    if (a.name === 'assume') {
      /* 간주 발행 — 한 번의 조건부 UPDATE(두 번 눌러도 하나만) · 승인번호 없음 · 발행 번호 칸엔 「간주-문서번호」 */
      const rows = await this.db.query(
        `UPDATE ${k.table}
            SET state = 'ISSUED', invoice_no = '간주-' || $2, issued_on = $3::date, issued_by = $4,
                ${k.issuedAt ? 'issued_at = now(),' : ''}
                etax_mode = 'ASSUMED', etax_status = 'ASSUMED', etax_doc_key = $2, etax_adapter = 'assume',
                etax_attempts = etax_attempts + 1, etax_sent_at = now(), etax_result_at = now(), etax_error = NULL
          WHERE id = $1 AND state = 'REQUESTED' AND etax_status IS NULL AND etax_mode IS NULL RETURNING id`,
        [r.id, docKey, today, this.me ?? null]);
      if (!rows.length) throw new StateConflict('ETAX_CONFLICT', '다른 요청이 먼저 처리했습니다 — 화면을 새로 고치십시오.');
      await this.call(k, r.id, 'ISSUE', a, docKey, () => a.issue(this.doc(k, r, docKey, today, supplier)));
      return { ...(await this.view(slug, r.id)), note: '간주 발행 — 국세청에 전송하지 않았습니다(assume.etax on). 승인번호가 없습니다.' };
    }

    /* 업체 전송 — 「보내는 중」 선점(조건부 UPDATE 한 번 · 동시에 눌러도 하나만) */
    const claimed = await this.db.query(
      `UPDATE ${k.table}
          SET etax_status = 'SENDING', etax_doc_key = coalesce(etax_doc_key, $2), etax_adapter = 'http',
              etax_attempts = etax_attempts + 1, etax_sent_at = now(), etax_error = NULL
        WHERE id = $1 AND etax_status IS NOT DISTINCT FROM $3 AND etax_mode IS NOT DISTINCT FROM $4 AND state = $5 RETURNING id`,
      [r.id, docKey, r.etax_status, r.etax_mode, r.state]);
    if (!claimed.length) throw new StateConflict('ETAX_CONFLICT', '다른 요청이 먼저 보내고 있습니다 — 화면을 새로 고치십시오.');

    let res: EtaxResult;
    /* 업체에 보낸 적이 있으면(시간 초과 · 실패 뒤) 먼저 조회 — 이미 발행됐으면 그 결과를 쓰고 다시 발행하지 않습니다 */
    if (r.etax_adapter === 'http' && r.etax_doc_key) {
      const st = await this.call(k, r.id, 'STATUS', a, docKey, () => a.status(docKey));
      res = st.status === 'NOT_FOUND'
        ? await this.call(k, r.id, 'ISSUE', a, docKey, () => a.issue(this.doc(k, r, docKey, today, supplier)))
        : st;
    } else {
      res = await this.call(k, r.id, 'ISSUE', a, docKey, () => a.issue(this.doc(k, r, docKey, today, supplier)));
    }
    if (res.status === 'NOT_FOUND' || res.status === 'ASSUMED') res = { status: 'FAILED', approvalNo: null, error: '업체 응답을 해석하지 못했습니다' };
    await this.record(k, r.id, res, today);
    return { ...(await this.view(slug, r.id)),
      note: res.status === 'SENT' ? '국세청 전송 — 승인번호를 받았습니다.'
        : res.status === 'SENDING' ? '업체가 접수했습니다 — 국세청 승인 대기. 「상태 조회」로 승인번호를 읽으십시오.'
        : `전송 실패 — ${res.error ?? ''} 「다시 보내기」를 쓸 수 있습니다.` };
  }

  private doc(k: (typeof KINDS)[KindSlug], r: Row, docKey: string, today: string, supplier: { name: string; bizNo: string; ceoName: string | null }): EtaxDoc {
    return { docKey, kind: k.kind, writeDate: today, supplier, buyer: { name: r.buyer_name, bizNo: r.buyer_biz_no ?? '' },
      supply: Number(r.supply), vat: Number(r.vat), total: Number(r.total), itemName: r.item };
  }

  /* ── 상태 조회 — 보내는 중(승인 대기) · 업체에 보낸 뒤 실패로 남은 줄 ─────────── */
  async refresh(slug: string, id: string) {
    const { k, r } = await this.load(slug, id);
    if (!(r.etax_status === 'SENDING' || (r.etax_status === 'FAILED' && r.etax_adapter === 'http')) || !r.etax_doc_key) {
      throw new StateConflict('ETAX_NOTHING_TO_CHECK', '업체에 보낸(보내는 중 · 실패) 줄만 조회합니다.');
    }
    const a = this.httpAdapter();
    const today = await this.today();
    const st = await this.call(k, r.id, 'STATUS', a, r.etax_doc_key, () => a.status(r.etax_doc_key!));
    if (st.status === 'SENT' || st.status === 'SENDING' || st.status === 'CANCELED') await this.record(k, r.id, st, today);
    else if (st.status === 'NOT_FOUND') await this.record(k, r.id, { status: 'FAILED', approvalNo: null, error: '업체에 이 문서가 없습니다 — 「다시 보내기」로 발행하십시오.' }, today);
    else await this.db.query(`UPDATE ${k.table} SET etax_error = $2, etax_result_at = now() WHERE id = $1`, [r.id, `상태 조회 실패 — ${st.error ?? ''}`]);
    return { ...(await this.view(slug, r.id)), note: st.status === 'SENT' ? '승인번호를 받았습니다.' : st.status === 'SENDING' ? '아직 승인 대기입니다.' : st.status === 'NOT_FOUND' ? '업체에 문서가 없습니다.' : `조회 결과: ${st.status}` };
  }

  /* ── 취소 · 수정 발행 — 보낸(SENT) 줄만 ───────────────────────── */
  async cancel(slug: string, id: string, reason: string) {
    const { k, r } = await this.load(slug, id);
    if ((reason ?? '').trim().length < 5) throw new PolicyViolation('ETAX_REASON', '취소 · 수정 발행 사유를 5자 이상 적어 주십시오.');
    if (r.etax_status !== 'SENT' || !r.etax_doc_key) throw new StateConflict('ETAX_NOT_SENT', '국세청에 보낸(SENT) 세금계산서만 취소 · 수정 발행합니다.');
    const a = this.httpAdapter();
    const today = await this.today();
    const res = await this.call(k, r.id, 'CANCEL', a, r.etax_doc_key, () => a.cancel(r.etax_doc_key!, r.etax_approval_no, reason.trim()));
    if (res.status !== 'CANCELED') {
      await this.db.query(`UPDATE ${k.table} SET etax_error = $2, etax_result_at = now() WHERE id = $1`, [r.id, `취소 실패 — ${res.error ?? ''}`]);
      throw new PolicyViolation('ETAX_CANCEL_FAILED', `취소 · 수정 발행에 실패했습니다 — ${res.error ?? ''}`);
    }
    await this.record(k, r.id, res, today);
    return { ...(await this.view(slug, r.id)), note: '취소 · 수정 발행을 기록했습니다.' };
  }
}

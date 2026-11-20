import { createHash } from 'crypto';
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { HttpESign } from '../deal/esign.provider';
import { EsignService } from '../deal/esign.service';
import { kstToday, myEmployee } from './hr';

/* ---------------------------------------------------------------------
 * ㉛ 인사 3 (D262 · docs/597) — v10.459 근로계약서 전자서명 · 대표 11/20 「다음개발 ㉛」
 *   양식(hr_contract_templates · 판 쌓기 · 자리표 {{name}} 등) + 조건(terms) → 계약서 본문을 만들 때 고정 · SHA-256 지문
 *   보내기 → 서명 길
 *     스위치 hr.contract_esign off(처음) — 간주(ASSUME): 직원이 운영 화면 › 사무 › 내 인사에서 이름을 적고 「서명」(법적 전자서명 아님 표시)
 *     on — 기존 전자계약 방식 esign.provider 그대로: STUB · MOCK(점검판) = 화면 안 서명 · HTTP = 기존 ESIGN 어댑터(HttpESign.create · 서명자 1명)
 *          HTTP 인데 키(ESIGN_API_KEY · ESIGN_WEBHOOK_SECRET · ESIGN_URL)가 없으면 NOT_READY(422) · 업체 상태는 「상태 확인」(HttpESign.status)
 *   서명본 = 고정 본문 + 지문 + 서명 시각 · 서명자(서명 뒤 못 고침) · 직원은 자기 계약서만 봄.
 *   ★ HttpESign 은 거래 계약용(서명자 externalId BUYER · SELLER) — 근로계약서는 직원 1명을 BUYER 자리로 보냄(업체 정해지면 칸 확인 · NOTES).
 * ------------------------------------------------------------------- */

export const TEMPLATE_KINDS = ['REGULAR', 'FIXED_TERM', 'PART_TIME'] as const;
export const TEMPLATE_CODE_RE = /^[A-Z][A-Z0-9_]{1,30}$/;
/** 조건 칸 — 양식 자리표 이름과 같음(그 밖 자리표는 그대로 남음) */
export const TERM_KEYS = ['company', 'startOn', 'endOn', 'place', 'duties', 'workTime', 'breakTime', 'workDays', 'holiday', 'wageType', 'wage', 'payDay', 'payMethod'] as const;
const clean = (s: unknown, max: number) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, max);

export function contractHash(employeeId: string, templateId: string, body: string) {
  return createHash('sha256').update(JSON.stringify({ employee: employeeId, template: templateId, body }), 'utf8').digest('hex');
}
/** 자리표 채우기 — {{name}} · {{signedOn}} 은 서버가 넣고 나머지는 조건에서 · 빈 값은 「—」 */
export function fillBody(tpl: string, vals: Record<string, string>) {
  return tpl.replace(/\{\{([A-Za-z]+)\}\}/g, (all, k: string) => (k in vals ? (vals[k] || '—') : all));
}

async function setting(db: DatabaseService, key: string) {
  const [r] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = $1`, [key]);
  return (r?.v ?? '').trim();
}
/** 지금 서명 길 — 스위치 off 면 ASSUME · on 이면 전자계약 방식(STUB · MOCK · HTTP) */
export async function signModeNow(db: DatabaseService): Promise<'ASSUME' | 'STUB' | 'MOCK' | 'HTTP'> {
  if ((await setting(db, 'hr.contract_esign')) !== 'on') return 'ASSUME';
  return EsignService.readMode((await setting(db, 'esign.provider')) || 'STUB');
}

/* ── 양식 ── */
export async function templates(db: DatabaseService) {
  const items = await db.query(
    `SELECT id::text AS id, code, version, name, kind, body, active, created_at AS "createdAt",
            (version = max(version) OVER (PARTITION BY code)) AS latest
       FROM hr_contract_templates ORDER BY code, version DESC`);
  return { items, termKeys: TERM_KEYS, note: '양식을 고치면 새 판이 생깁니다(옛 판으로 만든 계약서는 그대로). 자리표는 두 겹 중괄호 안에 name · signedOn · 조건 칸 이름을 씁니다.' };
}

/** POST /admin/hr/contracts/templates — 새 양식 · 새 판 */
export async function addTemplate(db: DatabaseService, b: { code: string; name: string; kind?: string; body: string }, actor: string | null) {
  if (!TEMPLATE_CODE_RE.test(b.code ?? '')) throw new PolicyViolation('CONTRACT_TEMPLATE', '양식 코드는 영문 대문자 · 숫자 · _ 2 ~ 31자입니다.');
  const name = clean(b.name, 60);
  if (name.length < 2) throw new PolicyViolation('CONTRACT_TEMPLATE', '양식 이름은 2 ~ 60자입니다.');
  const body = String(b.body ?? '').replace(/\r\n/g, '\n').trim();
  if (body.length < 20 || body.length > 20000) throw new PolicyViolation('CONTRACT_TEMPLATE', '양식 본문은 20 ~ 20,000자입니다.');
  const kind = b.kind && (TEMPLATE_KINDS as readonly string[]).includes(b.kind) ? b.kind : 'REGULAR';
  return db.transaction(async () => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext('hr_contract_tpl:' || $1::text))`, [b.code]);
    const [v] = await db.query<{ n: number }>(`SELECT coalesce(max(version), 0)::int + 1 AS n FROM hr_contract_templates WHERE code = $1`, [b.code]);
    const [r] = await db.query<{ id: string }>(
      `INSERT INTO hr_contract_templates (code, version, name, kind, body, created_by) VALUES ($1, $2::int, $3, $4, $5, $6::uuid) RETURNING id::text AS id`,
      [b.code, v!.n, name, kind, body, actor]);
    await db.query(`UPDATE hr_contract_templates SET active = false WHERE code = $1 AND version < $2::int AND active`, [b.code, v!.n]);
    return { ok: true, id: r!.id, code: b.code, version: v!.n, note: `양식 ${b.code} ${v!.n}판을 만들었습니다(옛 판은 쓰지 않음).` };
  });
}

/* ── 계약서 ── */
export async function contracts(db: DatabaseService, state?: string) {
  const st = state && ['DRAFT', 'SENT', 'SIGNED', 'CANCELED'].includes(state) ? state : '';
  const items = await db.query(
    `SELECT c.id::text AS id, c.employee_id::text AS "employeeId", e.name, c.title, c.state, c.sign_mode AS "signMode", c.sent_at AS "sentAt",
            c.signed_at AS "signedAt", c.signer_name AS "signerName", c.cancel_reason AS "cancelReason", c.created_at AS "createdAt", t.code AS "templateCode", t.version AS "templateVersion"
       FROM hr_contracts c JOIN acct_employees e ON e.id = c.employee_id JOIN hr_contract_templates t ON t.id = c.template_id
      WHERE ($1::text = '' OR c.state = $1) ORDER BY c.id DESC LIMIT 300`, [st]);
  const mode = await signModeNow(db);
  const ready = mode !== 'HTTP' || !HttpESign.missing().length;
  const employees = await db.query(
    `SELECT id::text AS id, name, (account_id IS NOT NULL) AS linked FROM acct_employees
      WHERE left_on IS NULL OR left_on >= $1::date ORDER BY joined_on, id`, [kstToday()]);
  return { state: st || null, items, signMode: mode, ready, employees,
           note: mode === 'ASSUME' ? '지금은 간주 서명입니다(hr.contract_esign off) — 직원이 운영 화면 안에서 이름을 적어 서명하며 법적 전자서명이 아닙니다.'
             : mode === 'HTTP' ? (ready ? '전자계약 업체로 서명 요청을 보냅니다(서명은 업체 화면).' : '전자계약 키가 없어 보낼 수 없습니다(NOT_READY) — 통합 현황 › 외부 연동 키에서 ESIGN 키를 넣으십시오.')
             : `전자계약 방식 ${mode} — 연동 전 시험 서명(법적 효력 없음 표시).` };
}

async function contractRow(db: DatabaseService, id: string, lock = false) {
  if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound('없는 계약서입니다.');
  const [c] = await db.query<{ id: string; employee_id: string; name: string; account_id: string | null; email: string | null; title: string; body: string; doc_hash: string;
    state: string; sign_mode: string | null; vendor_doc_id: string | null; sent_at: string | null; signed_at: string | null; signer_name: string | null;
    sign_evidence: unknown; template_id: string; terms: Record<string, string>; cancel_reason: string | null }>(
    `SELECT c.id::text AS id, c.employee_id::text AS employee_id, e.name, e.account_id::text AS account_id, a.email, c.title, c.body, c.doc_hash, c.state, c.sign_mode,
            c.vendor_doc_id, c.sent_at, c.signed_at, c.signer_name, c.sign_evidence, c.template_id::text AS template_id, c.terms, c.cancel_reason
       FROM hr_contracts c JOIN acct_employees e ON e.id = c.employee_id LEFT JOIN accounts a ON a.id = e.account_id
      WHERE c.id = $1::bigint` + (lock ? ' FOR UPDATE OF c' : ''), [id]);
  if (!c) throw new NotFound('없는 계약서입니다.');
  return c;
}
const view = (c: Awaited<ReturnType<typeof contractRow>>) => ({
  id: c.id, employeeId: c.employee_id, name: c.name, title: c.title, body: c.body, docHash: c.doc_hash, state: c.state, signMode: c.sign_mode,
  sentAt: c.sent_at, signedAt: c.signed_at, signerName: c.signer_name, signEvidence: c.sign_evidence, terms: c.terms, cancelReason: c.cancel_reason,
  legal: c.sign_mode === 'HTTP' ? '전자계약 업체 서명' : '간주 · 시험 서명 — 법적 전자서명 아님(연동 뒤 업체 서명으로 다시 받으십시오)',
});

/** POST /admin/hr/contracts — 양식 + 조건으로 초안(본문 · 지문 고정) */
export async function createContract(db: DatabaseService, b: { employeeId: string; templateId: string; title?: string; terms?: Record<string, unknown> }, actor: string | null) {
  if (!/^\d{1,18}$/.test(String(b.employeeId ?? '')) || !/^\d{1,18}$/.test(String(b.templateId ?? ''))) throw new PolicyViolation('CONTRACT_INPUT', '직원 · 양식을 고르십시오.');
  const [e] = await db.query<{ id: string; name: string }>(
    `SELECT id::text AS id, name FROM acct_employees WHERE id = $1::bigint AND (left_on IS NULL OR left_on >= $2::date)`, [b.employeeId, kstToday()]);
  if (!e) throw new NotFound('없는 직원이거나 퇴사한 직원입니다.');
  const [t] = await db.query<{ id: string; name: string; body: string; active: boolean }>(
    `SELECT id::text AS id, name, body, active FROM hr_contract_templates WHERE id = $1::bigint`, [b.templateId]);
  if (!t) throw new NotFound('없는 양식입니다.');
  if (!t.active) throw new PolicyViolation('CONTRACT_TEMPLATE_OFF', '쓰지 않는 양식 판입니다 — 가장 최근 판을 고르십시오.');
  const terms: Record<string, string> = {};
  for (const k of TERM_KEYS) {
    const v = b.terms?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') terms[k] = clean(v, 200);
  }
  if (terms.wage !== undefined && !/^[0-9,]{1,15}$/.test(terms.wage)) throw new PolicyViolation('CONTRACT_INPUT', '임금은 숫자(쉼표 가능)로 적습니다.');
  if (terms.payDay !== undefined && !/^([1-9]|[12][0-9]|3[01])$/.test(terms.payDay)) throw new PolicyViolation('CONTRACT_INPUT', '지급일은 1 ~ 31 입니다.');
  for (const k of ['startOn', 'endOn'] as const) if (terms[k] !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(terms[k]!)) throw new PolicyViolation('CONTRACT_INPUT', '날짜는 YYYY-MM-DD 입니다.');
  if (!terms.startOn) throw new PolicyViolation('CONTRACT_INPUT', '근로 시작일을 적으십시오.');
  const body = fillBody(t.body, { ...terms, name: e.name, endOn: terms.endOn ?? '정함 없음', signedOn: '서명일: 전자서명 시각에 따름' });
  if (body.length > 30000) throw new PolicyViolation('CONTRACT_INPUT', '본문이 너무 깁니다.');
  const title = clean(b.title, 100) || `${t.name} — ${e.name}`;
  const hash = contractHash(e.id, t.id, body);
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO hr_contracts (employee_id, template_id, title, terms, body, doc_hash, created_by) VALUES ($1::bigint, $2::bigint, $3, $4::jsonb, $5, $6, $7::uuid) RETURNING id::text AS id`,
    [e.id, t.id, title.length >= 2 ? title : `근로계약서 — ${e.name}`, JSON.stringify(terms), body, hash, actor]);
  return { ok: true, id: r!.id, docHash: hash, note: `${e.name} 님 근로계약서 초안을 만들었습니다 — 본문을 확인하고 「보내기」를 누르십시오.` };
}

export async function contractOne(db: DatabaseService, id: string) {
  return view(await contractRow(db, id));
}

/** POST /admin/hr/contracts/{id}/send — 보내기(서명 길은 지금 설정) */
export async function sendContract(db: DatabaseService, id: string, actor: string | null) {
  const mode = await signModeNow(db);
  if (mode === 'HTTP' && HttpESign.missing().length) throw new PolicyViolation('NOT_READY', `전자계약 연동 키가 없습니다(${HttpESign.missing().join(', ')}) — 통합 현황 › 외부 연동 키에서 넣거나 hr.contract_esign 을 끄십시오.`);
  return db.transaction(async () => {
    const c = await contractRow(db, id, true);
    if (c.state !== 'DRAFT') throw new StateConflict('CONTRACT_STATE', '초안만 보냅니다.');
    if (!c.account_id) throw new PolicyViolation('HR_NOT_LINKED', `${c.name} 님은 운영 계정과 연결돼 있지 않습니다 — 회계 › 인사 › 근태에서 먼저 연결하십시오(직원이 내 인사에서 서명).`);
    if (contractHash(c.employee_id, c.template_id, c.body) !== c.doc_hash) throw new StateConflict('CONTRACT_HASH', '계약서 지문이 맞지 않습니다 — 취소하고 새로 만드십시오.');
    let docId: string | null = null, url: string | null = null;
    if (mode === 'HTTP') {
      const base = (await setting(db, 'site.base_url')).replace(/\/+$/, '');
      const r = await new HttpESign().create({
        contractId: `HR-${c.id}`, title: `${c.title} — 소개뱅크`, content: c.body, docHash: c.doc_hash,
        expiresAt: new Date(Date.now() + 14 * 86400e3).toISOString(), callbackUrl: `${base}/api/v1/webhooks/esign`,
        signers: [{ role: 'BUYER', name: c.name, email: c.email ?? null }],
      });
      if (!r.ok || !r.docId) throw new StateConflict('ESIGN_FAILED', `전자계약 요청이 실패했습니다(${r.errorKind ?? ''} ${String(r.error ?? '').slice(0, 80)}).`);
      docId = r.docId; url = r.signUrls?.BUYER ?? null;
    } else if (mode === 'MOCK') {
      docId = `MOCK-HR-${c.id}-${Date.now()}`;
    }
    await db.query(
      `UPDATE hr_contracts SET state = 'SENT', sign_mode = $2, vendor_doc_id = $3, sign_url = $4, sent_by = $5::uuid, sent_at = now() WHERE id = $1::bigint`,
      [c.id, mode, docId, url, actor]);
    return { ok: true, id: c.id, signMode: mode, stub: mode !== 'HTTP',
             note: mode === 'HTTP' ? `${c.name} 님에게 전자서명 요청을 보냈습니다(업체 화면에서 서명).` : `${c.name} 님 내 인사에 서명할 계약서를 올렸습니다(${mode === 'ASSUME' ? '간주' : '시험'} 서명 · 법적 전자서명 아님).` };
  });
}

/** POST /admin/hr/contracts/{id}/check — 업체 상태 맞추기(HTTP 만) */
export async function checkContract(db: DatabaseService, id: string) {
  const c = await contractRow(db, id);
  if (c.state !== 'SENT') throw new StateConflict('CONTRACT_STATE', '보낸 계약서만 상태를 봅니다.');
  if (c.sign_mode !== 'HTTP' || !c.vendor_doc_id) return { ok: true, id: c.id, state: c.state, note: '화면 안 서명이라 업체 상태가 없습니다 — 직원이 내 인사에서 서명합니다.' };
  if (HttpESign.missing().length) throw new PolicyViolation('NOT_READY', '전자계약 연동 키가 없습니다.');
  const s = await new HttpESign().status(c.vendor_doc_id);
  if (!s.ok) throw new StateConflict('ESIGN_FAILED', `업체 상태를 읽지 못했습니다(${s.errorKind ?? ''}).`);
  if (s.docHash && s.docHash !== c.doc_hash) throw new StateConflict('CONTRACT_HASH', '업체 문서 지문이 우리 계약서와 다릅니다 — 서명으로 보지 않습니다.');
  const signed = (s.signers ?? []).find((x) => x.role === 'BUYER');
  if (s.state === 'SIGNED' && signed) {
    await db.query(
      `UPDATE hr_contracts SET state = 'SIGNED', signed_at = $2::timestamptz, signer_name = $3, sign_evidence = $4::jsonb WHERE id = $1::bigint AND state = 'SENT'`,
      [c.id, signed.signedAt, c.name, JSON.stringify({ mode: 'HTTP', stub: false, vendorState: s.state, vendorDoc: c.vendor_doc_id })]);
    return { ok: true, id: c.id, state: 'SIGNED', note: '업체 서명을 받았습니다(서명본 보관).' };
  }
  if (s.state === 'REJECTED' || s.state === 'EXPIRED' || s.state === 'CANCELLED') {
    await db.query(`UPDATE hr_contracts SET state = 'CANCELED', canceled_at = now(), cancel_reason = $2 WHERE id = $1::bigint AND state = 'SENT'`, [c.id, `업체 상태 ${s.state}`]);
    return { ok: true, id: c.id, state: 'CANCELED', note: `업체에서 ${s.state} — 계약서를 취소로 두었습니다(새로 만들어 다시 보냄).` };
  }
  return { ok: true, id: c.id, state: 'SENT', note: '아직 서명 전입니다.' };
}

/** POST /admin/hr/contracts/{id}/cancel — 초안 · 보낸 것 취소(사유) */
export async function cancelContract(db: DatabaseService, id: string, reasonIn: string) {
  const reason = clean(reasonIn, 200);
  if (reason.length < 2) throw new PolicyViolation('CONTRACT_REASON', '사유는 2 ~ 200자입니다.');
  return db.transaction(async () => {
    const c = await contractRow(db, id, true);
    if (!['DRAFT', 'SENT'].includes(c.state)) throw new StateConflict('CONTRACT_STATE', '서명 · 취소한 계약서는 취소하지 않습니다.');
    if (c.sign_mode === 'HTTP' && c.vendor_doc_id && !HttpESign.missing().length) await new HttpESign().cancel(c.vendor_doc_id).catch(() => undefined);
    await db.query(`UPDATE hr_contracts SET state = 'CANCELED', canceled_at = now(), cancel_reason = $2 WHERE id = $1::bigint`, [c.id, reason]);
    return { ok: true, id: c.id, state: 'CANCELED', note: '계약서를 취소했습니다(기록은 남음).' };
  });
}

/* ── 본인 ── */
async function needMe(db: DatabaseService, actor: string | null) {
  const me = await myEmployee(db, actor);
  if (!me) throw new PolicyViolation('HR_NOT_LINKED', '이 계정에 연결된 직원이 없습니다 — SUPER 가 회계 › 인사 › 근태에서 직원과 계정을 연결해야 합니다.');
  return me;
}
export async function myContracts(db: DatabaseService, employeeId: string) {
  return db.query(
    `SELECT id::text AS id, title, state, sign_mode AS "signMode", sent_at AS "sentAt", signed_at AS "signedAt", sign_url AS "signUrl"
       FROM hr_contracts WHERE employee_id = $1::bigint AND state IN ('SENT', 'SIGNED') ORDER BY id DESC LIMIT 20`, [employeeId]);
}
/** GET /admin/me/hr/contracts/{id} — 내 계약서(보낸 것 · 서명한 것만) */
export async function myContract(db: DatabaseService, actor: string | null, id: string) {
  const me = await needMe(db, actor);
  const c = await contractRow(db, id);
  if (c.employee_id !== me.id || !['SENT', 'SIGNED'].includes(c.state)) throw new NotFound('없는 계약서입니다.');
  return view(c);
}
/** POST /admin/me/hr/contracts/{id}/sign — 본인 서명(간주 · STUB · MOCK) · 이름이 직원 이름과 같아야 함 */
export async function signMyContract(db: DatabaseService, actor: string | null, id: string, b: { signerName: string; agree: boolean; docHash?: string }, ua?: string | null) {
  const me = await needMe(db, actor);
  if (b.agree !== true) throw new PolicyViolation('CONTRACT_AGREE', '계약 내용을 읽고 동의해야 서명합니다.');
  return db.transaction(async () => {
    const c = await contractRow(db, id, true);
    if (c.employee_id !== me.id) throw new NotFound('없는 계약서입니다.');
    if (c.state !== 'SENT') throw new StateConflict('CONTRACT_STATE', c.state === 'SIGNED' ? '이미 서명한 계약서입니다.' : '서명할 수 있는 계약서가 아닙니다.');
    if (c.sign_mode === 'HTTP') throw new StateConflict('ESIGN_EXTERNAL', '이 계약서는 전자계약 업체 화면에서 서명합니다(받은 메일 · 문자의 주소).');
    if (b.docHash && b.docHash !== c.doc_hash) throw new StateConflict('CONTRACT_HASH', '보신 본문과 지금 계약서가 다릅니다 — 화면을 새로 고치십시오.');
    if (contractHash(c.employee_id, c.template_id, c.body) !== c.doc_hash) throw new StateConflict('CONTRACT_HASH', '계약서 지문이 맞지 않습니다 — 관리자에게 알리십시오.');
    const name = clean(b.signerName, 40);
    if (name.replace(/\s/g, '') !== me.name.replace(/\s/g, '')) throw new PolicyViolation('CONTRACT_SIGNER', '서명 이름이 직원 이름과 다릅니다.');
    await db.query(
      `UPDATE hr_contracts SET state = 'SIGNED', signed_at = now(), signer_name = $2, sign_evidence = $3::jsonb WHERE id = $1::bigint`,
      [c.id, name, JSON.stringify({ mode: c.sign_mode, stub: true, account: actor, ua: String(ua ?? '').slice(0, 200) || null, docHash: c.doc_hash })]);
    return { ok: true, id: c.id, state: 'SIGNED', stub: true, note: `서명했습니다(${c.sign_mode === 'ASSUME' ? '간주' : '시험'} 서명 · 법적 전자서명 아님 · 서명본은 내 인사에서 다시 봄).` };
  });
}

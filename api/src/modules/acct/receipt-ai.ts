/* e3 (docs/010) 소개뱅크 src/modules/acct/receipt-ai.ts 를 tools/port-from-core.py 로 옮김 — 규칙 R1 · R2 만 적용 · 바꾼 줄은 docs/e3-port-*.tsv */
import { createHash } from 'crypto';
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { openImage } from '../file/attach-images';
import type { AgentService } from '../agent/agent.service';

/* ---------------------------------------------------------------------
 * v10.438 (D257 · docs/575) 영수증 사진 자동 입력 — 대표 11/19 「다음개발」
 *   매입 · 경비 증빙 그림(ACCT_EVIDENCE · JPG · PNG)에서 날짜 · 공급자 · 사업자번호 · 공급가 · 부가세 · 합계 · 종류를 읽어 「칸 채움 제안」.
 *   저장하지 않음 — 사람이 화면에서 확인 · 고친 뒤 기존 매입 넣기(POST /admin/acct/purchases) · 경비 청구로.
 *   스위치 acct.receipt_ai(처음 off) · 방식 acct.receipt_ai_mode = ASSUME(간주 · 밖으로 안 나감) | AI(운영 화면 AI 키 · AgentService 엔진).
 *   AI 는 AI 전체 스위치 · 월 상한 안에서만(fn_agent_allowed 통로 RECEIPT) · 쓴 토큰은 fn_agent_record_usage. 결과는 쌓기만(acct_receipt_reads).
 * ------------------------------------------------------------------- */

export interface ReceiptGuess { issuedOn: string | null; supplierName: string | null; supplierBizNo: string | null; supply: number | null; vat: number | null; total: number | null;
  kind: 'TAX_INVOICE' | 'CARD' | 'CASH' | 'SIMPLE' | null; item: string | null; confidence: number }

const MAX_BYTES = 5 * 1024 * 1024;
const KINDS = ['TAX_INVOICE', 'CARD', 'CASH', 'SIMPLE'] as const;

const SYSTEM = [
  '너는 한국 영수증 · 세금계산서 · 카드 전표 사진에서 회계 칸을 읽는 도우미다. 사진에 보이는 것만 적고 모르면 null.',
  'JSON 하나만 답한다(설명 없이): {"issuedOn":"YYYY-MM-DD","supplierName":"","supplierBizNo":"숫자 10자리","supply":0,"vat":0,"total":0,"kind":"TAX_INVOICE|CARD|CASH|SIMPLE","item":"","confidence":0.0}',
  'kind: 세금계산서 TAX_INVOICE · 신용카드 매출전표 CARD · 현금영수증 CASH · 그 밖의 간이영수증 SIMPLE. 금액은 원 단위 정수. 공급가 + 부가세 = 합계가 되게.',
].join('\n');

async function setting(db: DatabaseService, key: string) {
  const [r] = await db.query<{ value: string | null }>(`SELECT value FROM erp_site_settings WHERE key = $1`, [key]);
  return r?.value ?? null;
}

const toInt = (v: unknown) => { const x = Math.round(Number(String(v ?? '').replace(/[^0-9.-]/g, ''))); return Number.isFinite(x) && x >= 0 ? x : null; };
/** 모델 답(JSON 글자) → 칸 · 맞지 않는 값은 null · 공급가 + 부가세 ≠ 합계면 믿음 낮춤 */
export function parseGuess(text: string): ReceiptGuess {
  const m = /\{[\s\S]*\}/.exec(text ?? '');
  let o: Record<string, unknown> = {};
  try { o = m ? JSON.parse(m[0]) : {}; } catch { o = {}; }
  const d = String(o.issuedOn ?? '');
  const biz = String(o.supplierBizNo ?? '').replace(/\D/g, '');
  const kind = (KINDS as readonly string[]).includes(String(o.kind)) ? (o.kind as ReceiptGuess['kind']) : null;
  const g: ReceiptGuess = {
    issuedOn: /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null,
    supplierName: o.supplierName ? String(o.supplierName).slice(0, 120) : null,
    supplierBizNo: /^\d{10}$/.test(biz) ? biz : null,
    supply: toInt(o.supply), vat: toInt(o.vat), total: toInt(o.total), kind,
    item: o.item ? String(o.item).slice(0, 120) : null,
    confidence: Math.max(0, Math.min(1, Number(o.confidence ?? 0) || 0)),
  };
  if (g.supply != null && g.vat != null && g.total != null && g.supply + g.vat !== g.total) g.confidence = Math.min(g.confidence, 0.4);
  if (g.total != null && g.supply == null && g.vat == null) { g.supply = Math.round(g.total / 1.1); g.vat = g.total - g.supply; }
  return g;
}

/** 간주 — 파일 지문으로 늘 같은 값(시험 · 점검판) */
function assumeGuess(fileId: string, name: string): ReceiptGuess {
  const h = parseInt(createHash('sha256').update(fileId).digest('hex').slice(0, 6), 16);
  const supply = 10000 + (h % 90) * 1000, vat = Math.round(supply / 10);
  return { issuedOn: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10), supplierName: `(간주) ${name.slice(0, 40)}`, supplierBizNo: null,
           supply, vat, total: supply + vat, kind: 'CARD', item: '(간주) 영수증 읽기 시험', confidence: 0.5 };
}

async function readAll(stream: NodeJS.ReadableStream) {
  const parts: Buffer[] = []; let size = 0;
  for await (const c of stream as AsyncIterable<Buffer>) { size += c.length; if (size > MAX_BYTES) throw new PolicyViolation('RECEIPT_TOO_BIG', '사진이 5MB 를 넘습니다.'); parts.push(Buffer.from(c)); }
  return Buffer.concat(parts);
}

/** POST /admin/acct/receipt-ai/read — 파일 하나 읽어 제안(SUPER · PAYOUT · 경비는 올린 사람도) */
export async function readReceipt(db: DatabaseService, agent: AgentService, fileId: string, actor: string | null) {
  if ((await setting(db, 'acct.receipt_ai')) !== 'on') throw new PolicyViolation('RECEIPT_AI_OFF', '영수증 읽기가 꺼져 있습니다(정책 › 전체 설정 acct.receipt_ai).');
  const [f] = await db.query<{ name: string; ct: string; owner: string | null }>(
    `SELECT original_name AS name, content_type AS ct, owner_account_id::text AS owner FROM svc.files WHERE id = $1::uuid AND purpose = 'ACCT_EVIDENCE' AND status = 'READY'`, [fileId]);
  if (!f) throw new NotFound('없는 증빙 파일입니다.');
  if (!['image/jpeg', 'image/png'].includes(f.ct)) throw new PolicyViolation('RECEIPT_IMAGE_ONLY', '사진(JPG · PNG)만 읽습니다 — PDF 는 직접 넣으십시오.');
  const mode = (await setting(db, 'acct.receipt_ai_mode')) === 'AI' ? 'AI' : 'ASSUME';
  const save = async (ok: boolean, g: ReceiptGuess | null, model: string | null, err: string | null, it = 0, ot = 0) => {
    const [r] = await db.query<{ id: string }>(
      `INSERT INTO acct_receipt_reads (file_id, mode, model, ok, result, error, in_tokens, out_tokens, actor_id) VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6, $7, $8, $9) RETURNING id::text AS id`,
      [fileId, mode, model, ok, JSON.stringify(g ?? {}), err ? err.slice(0, 300) : null, it, ot, actor]);
    return r!.id;
  };
  if (mode === 'ASSUME') {
    const g = assumeGuess(fileId, f.name);
    const id = await save(true, g, null, null);
    return { ok: true, id, mode, assumed: true, guess: g, note: '간주 결과입니다(밖으로 보내지 않음) — 실제로 읽으려면 acct.receipt_ai_mode 를 AI 로.' };
  }
  const allow = await agent.allowed('RECEIPT');
  if (!allow.ok) throw new StateConflict('RECEIPT_AI_BLOCKED', `AI 를 부를 수 없습니다(${allow.reason ?? '알 수 없음'}) — AI 전체 스위치 · 월 상한을 보십시오.`);
  const prov = await agent.provider();
  if (!prov) throw new StateConflict('RECEIPT_AI_NO_KEY', 'AI 키가 없습니다(운영 화면 › AI 에이전트 › AI 키).');
  const img = await openImage(db, fileId, 'ACCT_EVIDENCE');
  const data = (await readAll(img.stream)).toString('base64');
  const [ms] = await db.query<{ value: string | null }>(`SELECT value FROM erp_site_settings WHERE key = 'agent.review_model'`);
  const model = ms?.value ?? 'claude-sonnet-5-5';
  try {
    const reply = await prov.complete({ model, system: SYSTEM, maxTokens: 600, effort: 'low',
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: f.ct as 'image/jpeg' | 'image/png', data } },
        { type: 'text', text: '이 증빙의 칸을 JSON 으로 읽어 주십시오.' }] }] });
    await agent.record('RECEIPT', model, reply.inputTokens, reply.outputTokens, reply.cacheReadTokens);   // 실패를 숨기지 않음(월 상한 · 비용 기록이 빠지지 않게)
    const g = parseGuess(reply.text);
    const id = await save(true, g, reply.model, null, reply.inputTokens, reply.outputTokens);
    return { ok: true, id, mode, assumed: false, guess: g, engine: prov.name, note: '읽은 값은 제안입니다 — 확인하고 고친 뒤 넣으십시오.' };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    await save(false, null, model, msg);
    throw new StateConflict('RECEIPT_AI_FAILED', '영수증을 읽지 못했습니다 — 직접 넣으십시오.');
  }
}

/** GET /admin/acct/receipt-ai/reads?fileId= — 최근 읽은 기록 */
export async function receiptReads(db: DatabaseService, fileId?: string) {
  const on = (await setting(db, 'acct.receipt_ai')) === 'on';
  const mode = (await setting(db, 'acct.receipt_ai_mode')) === 'AI' ? 'AI' : 'ASSUME';
  const items = await db.query(
    `SELECT r.id::text AS id, r.file_id::text AS "fileId", f.original_name AS name, r.mode, r.model, r.ok, r.result, r.error, r.in_tokens AS "inTokens", r.out_tokens AS "outTokens", r.created_at AS "createdAt"
       FROM acct_receipt_reads r JOIN svc.files f ON f.id = r.file_id
      WHERE ($1::uuid IS NULL OR r.file_id = $1::uuid) ORDER BY r.id DESC LIMIT 30`, [fileId && /^[0-9a-f-]{36}$/i.test(fileId) ? fileId : null]);
  return { on, mode, items };
}

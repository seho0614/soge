import type { Readable } from 'node:stream';
import { DatabaseService } from '../../db/database.service';
import { AppError, NotFound, PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { AgentService } from '../agent/agent.service';
import type { AgentBlock, AgentMessage } from '../agent/agent.provider';
import { MailService } from '../../common/mail/mail.service';
import { EtaxService } from '../etax/etax.service';
import { resolveBizStatusProvider } from '../identity/verification.provider';
import { storageFromEnv } from '../file/storage';
import { bankFeedAdapter, FeedAccount, FeedResult } from '../acct/bankfeed';
import { KftcTransfer } from '../acct/transfer';
import { adapterFor, InboxResult } from '../acct/taxinbox';

/* ---------------------------------------------------------------------
 * v10.801 (docs/917) ERP 연결 ③ — 묶음 8 · ERP 가 옮겨 간 회계 코드가 부르는 소개뱅크 내부 길(모두 ERP 서비스 토큰 · ErpLinkGuard)
 *
 *   대표 11/26 「연동 키는 소개뱅크가 대신 호출」 — AI 키 · 국세청 키 · SMTP · 전자세금계산서 업체 키 · 금융결제원 키는 소개뱅크에만 둠.
 *   ERP 쪽 연결부(같은 이름 · 같은 모양): erp32 api/src/modules/{admin/export-approval · agent/agent.service · file/attach-images ·
 *     identity/verification.provider · etax/etax.service} · common/mail/mail.service (ERP docs/011 2절)
 *
 *   ① export/consume   내려받기 승인 「썼음」(ExportApprovalService.use 와 같은 규칙 + 요청자 · 대상 · 승인 · 24시간을 한 UPDATE 에서 다시 봄)
 *   ② agent/*           AI — allowed · provider · complete · record (AgentService 그대로 · 키는 내보내지 않음 · 통로는 RECEIPT 만)
 *                        complete 가 사용량을 직접 쌓음(fn_agent_record_usage) — ERP 가 record 를 빠뜨려도 월 상한이 새지 않게 · record 는 받기만(두 번 세지 않음)
 *   ③ files/{id}/content 올린 파일 몸통 — READY · 용도 허용 목록(ACCT_EVIDENCE)만 · 없으면 404
 *   ④ biz-status        사업자 휴폐업(resolveBizStatusProvider · 10자리)
 *   ⑤ mail · mail/ready 메일 한 통(MailService · 받는 주소 하나 · 하루 200통 · 메모리 셈)
 *   ⑥ etax/send         세금계산서 전송(EtaxService.send · acct_tax_invoices 4종만) — TODO(E7) 표가 ERP 로 가면 「문서 받아 보내기」로 바꿈
 *   ⑦ products/tax-type 직판 상품 과세 · 면세(acct.controller setTaxType 와 같은 SQL) · 감사
 *   ⑧ bank/fetch · taxinbox/fetch — 바깥 호출만(어댑터 그대로) · 표 쓰기는 ERP · transfer/send 는 501(이체 안전장치가 묶음 표와 붙어 있음 · docs/917 4절)
 *
 *   하루 셈(dailyCap)은 이 프로세스 메모리 — API 를 다시 띄우면 0 부터(운영 API 는 한 프로세스 · 막는 뜻은 「잘못 돈 반복」 멈춤).
 *   감사: 쓰는 길(①⑤⑥⑦)은 audit.audit_logs 에 actor_role 'ERP_SERVICE' · ERP 가 알려 준 행위자(accountId · actorId)를 남김.
 * ------------------------------------------------------------------- */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const kstDay = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400e3);

/** ERP 가 「썼음」을 알릴 수 있는 내려받기 대상 — ERP 로 옮겨 간 업무만(소개뱅크 화면 대상 POINT_REPORT · AUDIT_EXPORT 등은 안 됨) */
export const ERP_EXPORT_TARGETS = ['ACCT_JOURNAL', 'ACCT_TAX', 'ACCT_LEDGER', 'ACCT_ARCHIVE', 'HRA_PAY_FILE', 'ITS_SURVEY'];
/** AI 통로 허용 목록 — 지금은 영수증 읽기만 */
export const ERP_AGENT_KINDS = ['RECEIPT'] as const;
/** 파일 몸통 용도 허용 목록 — 회계 증빙만 */
export const ERP_FILE_PURPOSES = ['ACCT_EVIDENCE'];
/** 세금계산서 종류 — acct_tax_invoices 4종만(정액 노출료 directory · 리드 이용료 lead-cash 는 소개뱅크 업무라 안 됨) */
export const ERP_ETAX_SLUGS = ['ad', 'commission', 'sales-doc', 'exempt'];
export const ERP_MAIL_DAILY_MAX = 200;
export const ERP_DAILY_MAX: Record<string, number> = { mail: ERP_MAIL_DAILY_MAX, agent: 500, biz: 2000, bank: 200, taxinbox: 100 };
/** 영수증 사진 한 장 base64 상한 — ERP receipt-ai 의 5MB(원본) × 4/3 ≈ 6.7M 자 + 여유 */
export const ERP_IMAGE_B64_MAX = 7_000_000;

const caps = new Map<string, { day: string; n: number }>();
/** 하루(한국) 호출 수 — 넘으면 422 ERP_DAILY_LIMIT · 메모리만(다시 띄우면 0) */
export function dailyCap(name: string, max = ERP_DAILY_MAX[name] ?? 100) {
  const day = kstDay();
  const c = caps.get(name);
  const cur = c && c.day === day ? c : { day, n: 0 };
  if (cur.n >= max) throw new PolicyViolation('ERP_DAILY_LIMIT', '오늘 이 내부 길의 호출 한도를 넘었습니다 — 내일 다시 하거나 운영자에게 알리십시오.', { name, max });
  cur.n++;
  caps.set(name, cur);
  return cur.n;
}
export const dailyCapReset = () => caps.clear();

/** 감사 — 서비스 토큰 호출이라 RequestCtx 행위자가 없음 · ERP 가 알려 준 행위자(uuid 꼴일 때만) · 역할 ERP_SERVICE · 실패해도 본 일은 계속 */
async function erpAudit(db: DatabaseService, action: string, targetType: string, actor: string | null | undefined, after: Record<string, unknown>) {
  const c = RequestCtx.get();
  await db.query(
    `INSERT INTO audit.audit_logs (actor_account_id, actor_role, action, target_type, target_id, after_data, ip, user_agent)
     VALUES ($1, 'ERP_SERVICE', $2, $3, NULL, $4::jsonb, $5, $6)`,
    [actor && UUID.test(actor) ? actor : null, action, targetType, JSON.stringify(after), c?.ip ?? null, c?.userAgent ?? null])
    .catch((e) => console.error('[AUDIT_WRITE_FAILED]', action, (e as Error).message));
}

/* ── ① 내려받기 승인 「썼음」 ─────────────────────────────────────── */
export async function exportConsume(db: DatabaseService, dto: { id: string; target: string; accountId: string }) {
  const id = String(dto.id ?? '');
  const need = () => new PolicyViolation('EXPORT_NEED_APPROVAL', '내려받기 승인이 필요합니다(사유를 적어 요청 → 승인 뒤 24시간 안 한 번).');
  if (!/^\d{1,18}$/.test(id) || !UUID.test(String(dto.accountId ?? ''))) throw need();
  if (!ERP_EXPORT_TARGETS.includes(String(dto.target))) throw new PolicyViolation('EXPORT_TARGET', '내려받기 대상이 아닙니다.');
  /* ExportApprovalService.check + use 를 한 번에 — 대상 · 요청자 · 승인 · 24시간 · 안 씀(동시에 두 번이면 뒤엣것은 0줄) */
  const r = await db.query<{ id: string }>(
    `UPDATE export_requests SET used_at = now()
      WHERE id = $1::bigint AND target = $2 AND requested_by = $3::uuid AND state = 'APPROVED' AND used_at IS NULL AND decided_at > now() - interval '24 hours'
      RETURNING id::text AS id`, [id, dto.target, dto.accountId]);
  if (!r.length) {
    const [u] = await db.query(`SELECT 1 FROM export_requests WHERE id = $1::bigint AND target = $2 AND requested_by = $3::uuid AND used_at IS NOT NULL`, [id, dto.target, dto.accountId]);
    if (u) throw new AppError(409, { code: 'EXPORT_TICKET_USED', message: '이미 쓴 내려받기 승인입니다.' });
    throw need();
  }
  await erpAudit(db, 'ERP_EXPORT_CONSUME', 'EXPORT', dto.accountId, { id, target: dto.target });
  return { ok: true, ticket: id };
}

/* ── ② AI ─────────────────────────────────────────────────────── */
function agentKind(kind: unknown): 'RECEIPT' {
  if (!(ERP_AGENT_KINDS as readonly string[]).includes(String(kind))) throw new PolicyViolation('ERP_AGENT_KIND', 'ERP 가 쓸 수 없는 AI 통로입니다(지금은 RECEIPT 만).');
  return 'RECEIPT';
}

export async function agentAllowed(agent: AgentService, kind: string) {
  const k = agentKind(kind);
  const r = await agent.allowed(k);
  return { ok: !!r.ok, reason: r.reason ?? null };
}

export async function agentProvider(agent: AgentService) {
  const p = await agent.provider();
  return { name: p?.name ?? null };
}

/** 받은 메시지를 그대로 넘기지 않고 다시 만듦 — 글 · 사진(JPG · PNG base64) 조각만 · 사진 한 장 · 도구 조각은 안 됨 */
function cleanMessages(input: unknown): AgentMessage[] {
  const bad = () => new PolicyViolation('ERP_AGENT_INPUT', 'AI 요청 모양이 맞지 않습니다(글 · 사진 조각만 · 사진 한 장 · 메시지 4개까지).');
  if (!Array.isArray(input) || input.length < 1 || input.length > 4) throw bad();
  let images = 0;
  return input.map((m: any): AgentMessage => {
    const role = m?.role;
    if (role !== 'user' && role !== 'assistant') throw bad();
    if (typeof m.content === 'string') {
      if (m.content.length > 20_000) throw bad();
      return { role, content: m.content };
    }
    if (!Array.isArray(m.content) || m.content.length < 1 || m.content.length > 4) throw bad();
    const content = m.content.map((b: any): AgentBlock => {
      if (b?.type === 'text' && typeof b.text === 'string' && b.text.length <= 20_000) return { type: 'text', text: b.text };
      if (b?.type === 'image' && role === 'user' && b.source?.type === 'base64' && ['image/jpeg', 'image/png'].includes(b.source?.media_type)
          && typeof b.source?.data === 'string' && b.source.data.length > 0 && b.source.data.length <= ERP_IMAGE_B64_MAX && /^[A-Za-z0-9+/=]+$/.test(b.source.data)) {
        if (++images > 1) throw bad();
        return { type: 'image', source: { type: 'base64', media_type: b.source.media_type, data: b.source.data } };
      }
      throw bad();
    });
    return { role, content };
  });
}

export async function agentComplete(agent: AgentService, dto: { model: string; system: string; maxTokens: number; effort?: string; messages: unknown[] }) {
  dailyCap('agent');
  const allow = await agent.allowed('RECEIPT');   // ERP 가 allowed 를 건너뛰어도 스위치 · 월 상한을 여기서 다시 봄
  if (!allow.ok) throw new AppError(409, { code: 'ERP_AGENT_BLOCKED', message: 'AI 를 부를 수 없습니다 — AI 전체 스위치 · 월 상한을 보십시오.' });
  const prov = await agent.provider();
  if (!prov) throw new AppError(409, { code: 'ERP_AGENT_NO_KEY', message: 'AI 키가 없습니다(운영 화면 › AI 에이전트 › AI 키).' });
  const messages = cleanMessages(dto.messages);
  const effort = (['low', 'medium', 'high'] as const).find((x) => x === dto.effort);
  let reply;
  try {
    reply = await prov.complete({ model: dto.model, system: dto.system, maxTokens: dto.maxTokens, effort, messages });
  } catch {
    /* 엔진 오류 글에는 키 · 요청 일부가 들어갈 수 있어 그대로 넘기지 않음 */
    throw new AppError(502, { code: 'ERP_AGENT_FAILED', message: 'AI 호출에 실패했습니다 — 잠시 뒤 다시 해 주십시오.' });
  }
  /* 사용량은 여기서 쌓음(실패를 숨기지 않음 — 월 상한 · 비용 기록이 빠지지 않게) · ERP 의 record 는 받기만 */
  await agent.record('RECEIPT', dto.model, reply.inputTokens, reply.outputTokens, reply.cacheReadTokens ?? 0);
  return { text: reply.text, model: reply.model, inputTokens: reply.inputTokens, outputTokens: reply.outputTokens, cacheReadTokens: reply.cacheReadTokens ?? 0 };
}

/** ERP receipt-ai 가 complete 뒤 부름 — complete 가 이미 쌓았으므로 두 번 세지 않음(통로 확인만) */
export async function agentRecord(dto: { kind: string; model: string; inTok: number; outTok: number; cacheRead?: number }) {
  agentKind(dto.kind);
  return { ok: true, recorded: false, note: 'complete 때 이미 사용량을 쌓았습니다 — 두 번 세지 않습니다.' };
}

/* ── ③ 파일 몸통 ──────────────────────────────────────────────── */
export async function fileContent(db: DatabaseService, id: string, purpose: string | undefined): Promise<{ stream: Readable; contentType: string; size: number }> {
  const none = () => new NotFound('파일이 없습니다.');
  if (!UUID.test(String(id ?? '')) || !ERP_FILE_PURPOSES.includes(String(purpose ?? ''))) throw none();
  const [f] = await db.query<{ storage_key: string; content_type: string; size_bytes: string }>(
    `SELECT storage_key, content_type, size_bytes FROM files WHERE id = $1::uuid AND purpose = $2 AND status = 'READY'`, [id, purpose]);
  if (!f) throw none();
  const stream = await storageFromEnv().open(f.storage_key);
  if (!stream) throw none();
  return { stream, contentType: f.content_type, size: Number(f.size_bytes) };
}

/* ── ④ 사업자 휴폐업 ─────────────────────────────────────────── */
export async function bizStatus(bizRegNo: string) {
  const no = String(bizRegNo ?? '').replace(/-/g, '');
  if (!/^\d{10}$/.test(no)) throw new PolicyViolation('ERP_BIZ_NO', '사업자등록번호는 숫자 10자리입니다.');
  dailyCap('biz');
  return resolveBizStatusProvider().check(no);
}

/* ── ⑤ 메일 ──────────────────────────────────────────────────── */
const EMAIL_RE = /^[^@\s<>"',;]+@[^@\s<>"',;]+\.[^@\s<>"',;]+$/;
export async function mailReady(mail: MailService) {
  return { ready: await mail.ready() };
}
export async function mailSend(db: DatabaseService, mail: MailService, dto: { to: string; subject: string; text: string; html?: string }) {
  const to = String(dto.to ?? '').trim();
  if (to.length > 254 || !EMAIL_RE.test(to)) throw new PolicyViolation('ERP_MAIL_TO', '받는 주소는 메일 주소 하나만 됩니다.');
  if (/[\r\n]/.test(String(dto.subject ?? ''))) throw new PolicyViolation('ERP_MAIL_SUBJECT', '메일 제목에 줄바꿈을 쓸 수 없습니다.');
  /* 준비 안 됨(설정 · notify.email_verified)이면 보내지 않음 — MailService.send 는 인증 스위치를 보지 않으므로 여기서 먼저 */
  if (!(await mail.ready())) return { ok: false, errorKind: 'NOT_READY', error: 'mail not ready' };
  dailyCap('mail');
  /* html 은 받지만 쓰지 않음 — 소개뱅크 SMTP 는 글(text)만 보냄(ERP 독촉 메일도 글만) */
  const r = await mail.send({ to, subject: dto.subject, text: dto.text });
  const masked = to.slice(0, 2) + '***@' + (to.split('@')[1] ?? '');
  await erpAudit(db, 'ERP_MAIL_SEND', 'MAIL', null, { to: masked, ok: r.ok, errorKind: r.errorKind ?? null });
  return { ok: r.ok, messageId: r.messageId, errorKind: r.errorKind, error: r.ok ? undefined : r.errorKind ?? 'FAILED' };
}

/* ── ⑥ 세금계산서 전송 ───────────────────────────────────────── */
/* TODO(E7 · docs/917 5절) — acct_tax_invoices 는 ERP 로 옮겨 감. 지금(E7 전)은 소개뱅크에 표가 그대로 있어 EtaxService.send 를 그대로 부름.
 *   표가 ERP 로 가면 「ERP 가 문서(EtaxDoc)를 보내고 소개뱅크는 업체 전송 · etax_send_log 만」(POST /internal/erp/etax/call · plan 3절)으로 바꿀 것 */
export async function etaxSend(db: DatabaseService, etax: EtaxService, dto: { slug: string; id: string; mode: 'send' | 'resend'; actorId?: string }) {
  if (!ERP_ETAX_SLUGS.includes(String(dto.slug))) throw new NotFound('세금계산서 종류가 없습니다(ad · commission · sales-doc · exempt).');
  const out = await etax.send(dto.slug, dto.id, dto.mode);
  await erpAudit(db, 'ERP_ETAX_SEND', 'INVOICE', dto.actorId, { slug: dto.slug, id: dto.id, mode: dto.mode });
  return out;
}

/* ── ⑦ 직판 상품 과세 · 면세 ─────────────────────────────────── */
export async function productTaxType(db: DatabaseService, dto: { code: string; taxType: string; reason: string; actorId?: string }) {
  const reason = String(dto.reason ?? '').replace(/\s+/g, ' ').trim();
  if (reason.length < 2 || reason.length > 200) throw new PolicyViolation('ACCT_REASON', '사유는 2 ~ 200자입니다.');
  /* acct.controller setTaxType 와 같은 SQL — 직판(DIRECT) 판매자 상품만 · 다음 주문부터 */
  const r = await db.query(
    `UPDATE hlt_products p SET tax_type = $2, updated_at = now() FROM hlt_sellers s WHERE p.code = $1 AND s.id = p.seller_id AND s.type = 'DIRECT' RETURNING p.code`,
    [dto.code, dto.taxType]);
  if (!r.length) throw new NotFound('없거나 직판 상품이 아닙니다.');
  await erpAudit(db, 'PRODUCT_TAX_TYPE', 'SETTING', dto.actorId, { code: dto.code, taxType: dto.taxType, reason, by: 'ERP' });
  return { ok: true, code: dto.code, taxType: dto.taxType };
}

/* ── ⑧ 바깥 호출 대신 하기 ────────────────────────────────────── */
function range(from: string, to: string) {
  const today = kstDay();
  if (!YMD.test(from) || !YMD.test(to) || to > today || from > to || days(from, to) > 30) {
    throw new PolicyViolation('ERP_RANGE', '기간은 오늘까지 · 31일 안입니다.');
  }
}

/** 은행 거래내역 — bankfeed 어댑터의 바깥 호출(list)만 · 들여오기(acct_bank_txns) · 기록은 ERP
 *  거래고유번호는 소개뱅크 시퀀스(fn_acct_transfer_tran_id) — 이체와 같은 이용기관코드 · 하루 안 겹치지 않게 한 곳에서만 만듦 */
export async function bankFetch(db: DatabaseService, dto: { mode: 'ASSUME' | 'LIVE'; account: Record<string, unknown>; from: string; to: string }): Promise<FeedResult> {
  range(dto.from, dto.to);
  const a = dto.account ?? {};
  const acc: FeedAccount = { id: String(a.id ?? ''), label: String(a.label ?? '').trim(), bankStd: String(a.bankStd ?? ''), last4: String(a.last4 ?? ''), fintech: String(a.fintech ?? '').replace(/[\s-]/g, '') };
  if (!/^\d{1,18}$/.test(acc.id) || acc.label.length < 1 || acc.label.length > 40 || !/^[0-9]{3}$/.test(acc.bankStd) || !/^[0-9]{4}$/.test(acc.last4) || !/^[0-9]{20,30}$/.test(acc.fintech)) {
    throw new PolicyViolation('ERP_BANK_ACCOUNT', '계좌 모양이 맞지 않습니다(번호 · 이름 · 은행 표준코드 3자리 · 끝 4자리 · 핀테크이용번호 20 ~ 30자리).');
  }
  dailyCap('bank');
  const ad = bankFeedAdapter(dto.mode);   // LIVE 인데 키가 없으면 422 BANK_FEED_NOT_READY(조용히 간주로 돌아가지 않음)
  const org = dto.mode === 'LIVE' ? KftcTransfer.orgCode() : 'SGBASSUME0';
  const nextTranId = async () => { const [r] = await db.query<{ id: string }>(`SELECT fn_acct_transfer_tran_id($1) AS id`, [org]); return r!.id; };
  try { return await ad.list(acc, dto.from, dto.to, nextTranId); }
  catch (e) { return { ok: false, rows: [], bad: 0, errorKind: 'ERROR', error: String((e as Error)?.message ?? e).slice(0, 200) }; }
}

/** 매입 세금계산서 받은함 — taxinbox 어댑터의 바깥 호출(list)만 · acct_tax_inbox 쌓기는 ERP */
export async function taxInboxFetch(dto: { mode: 'ASSUME' | 'LIVE'; provider?: string; from: string; to: string }): Promise<InboxResult> {
  range(dto.from, dto.to);
  dailyCap('taxinbox');
  const ad = adapterFor({ mode: dto.mode, provider: dto.provider ?? 'GENERIC' });   // LIVE 인데 키가 없으면 422 TAXINBOX_NOT_READY
  try { return await ad.list(dto.from, dto.to); }
  catch (e) { return { ok: false, items: [], errorKind: 'ERROR', error: String((e as Error)?.message ?? e).slice(0, 200) }; }
}

/** 대량 이체 — 대신 보내지 않음(501). 두 사람 승인 · 상태 · 거래고유번호 먼저 저장 · PENDING 다시 안 보냄이 모두 acct_transfer_* 표와 한 흐름이라
 *  표만 ERP 로 가고 「보내기」만 소개뱅크에 두면 소개뱅크가 승인을 확인할 수 없음(서비스 토큰 하나로 돈이 나가는 길이 됨) — docs/917 4절 설계 */
export function transferSend(): never {
  throw new AppError(501, { code: 'ERP_TRANSFER_NOT_PROXIED', message: '대량 이체는 아직 ERP 에서 보낼 수 없습니다 — 소개뱅크 회계 › 대량 이체를 쓰십시오(설계 docs/917).' });
}

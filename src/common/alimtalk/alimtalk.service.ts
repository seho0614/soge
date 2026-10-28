import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { NotFound, PolicyViolation } from '../../core/errors';
import { ALIMTALK_TEMPLATES, AlimtalkTemplateCode, renderAlimtalk } from './alimtalk.templates';

/* ---------------------------------------------------------------------
 * v10.142 (D138 · docs/215 · 설계 docs/213) — 알림톡 발송 틀
 *
 *   alimtalk.provider  NONE(처음 · 보내지 않음) · MOCK(점검판 — 보내지 않고 기록만 · 운영 서버에서는 NONE 으로 읽음) · HTTP(대행사)
 *   HTTP 는 대행사 공통 모양 — 주소 ALIMTALK_URL · 인증 머리글 ALIMTALK_AUTH_HEADER(Authorization) + ALIMTALK_AUTH_PREFIX(Bearer ) + 키
 *     본문 { senderKey, templateCode, recipientNo, content, variables, fallbackSms } — 대행사가 정해지면 칸 이름을 맞추거나 전용 파일 하나
 *   켜기  notify.alimtalk_ready = on — 켜려면 「준비됨」(방식 · 키 · 승인된 템플릿)이어야 함(AdminService 가 검사)
 *   보내는 곳  ① 상담 신청 인증번호(CONSULT_OTP) ② 알림 발송 SMS 채널 QUEUED(NOTICE_GENERAL · 3번 재시도) ③ 운영 화면 시험 발송
 *
 * 오류 처리 — 받는 번호 형식 · 템플릿 미승인 · 키 없음은 보내기 전에 막고(FAILED · 까닭) · 연결 · 시간 초과 · 대행사 5xx 는 「잠시 실패」(알림은 재시도)
 *   · 인증 401/403 · 그 밖 4xx 는 「다시 해도 안 됨」. 받는 번호는 기록 · 로그에 끝 4자리만. 대행사 응답 글은 120자까지만 기록.
 * ------------------------------------------------------------------- */

export type AlimtalkMode = 'NONE' | 'MOCK' | 'HTTP';
export type AlimtalkErrorKind = 'NOT_READY' | 'BAD_PHONE' | 'TEMPLATE' | 'NETWORK' | 'TIMEOUT' | 'AUTH' | 'REJECTED' | 'SERVER';
export interface AlimtalkResult { ok: boolean; msgId?: string | null; errorKind?: AlimtalkErrorKind; error?: string }
export const ALIMTALK_TEMP_ERRORS = new Set<string>(['NETWORK', 'TIMEOUT', 'SERVER']);
export const ALIMTALK_KEY_NAMES = ['ALIMTALK_KEY', 'ALIMTALK_SENDER_KEY'] as const;
const PHONE_RE = /^01[016789]\d{7,8}$/;
const isProd = () => (process.env.NODE_ENV ?? 'development') === 'production';
export const last4 = (p: string | null | undefined) => (p ? String(p).replace(/\D/g, '').slice(-4) : null);

interface Tpl { code: AlimtalkTemplateCode; vendor_code: string | null; review_state: string }

@Injectable()
export class AlimtalkService {
  private readonly log = new Logger(AlimtalkService.name);
  constructor(private readonly db: DatabaseService) {}

  private async setting(key: string, dflt: string) {
    const [r] = await this.db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = $1`, [key]);
    return r?.v?.trim() || dflt;
  }

  async mode(): Promise<AlimtalkMode> { return AlimtalkService.readMode(await this.setting('alimtalk.provider', 'NONE')); }
  static readMode(v: string): AlimtalkMode {
    const m = (v ?? '').trim().toUpperCase();
    return m === 'HTTP' ? 'HTTP' : m === 'MOCK' && !isProd() ? 'MOCK' : 'NONE';
  }
  /** HTTP 에 빠진 것 — 키 2개 · 주소 */
  static httpMissing(): string[] {
    return [...ALIMTALK_KEY_NAMES.filter((k) => !process.env[k]?.trim()), ...(process.env.ALIMTALK_URL?.trim() ? [] : ['ALIMTALK_URL'])];
  }
  /** 방식 · 키가 갖춰짐(템플릿은 따로) */
  static configuredFor(mode: AlimtalkMode) { return mode === 'MOCK' || (mode === 'HTTP' && !AlimtalkService.httpMissing().length); }

  private async tpl(code: AlimtalkTemplateCode): Promise<Tpl | null> {
    const [t] = await this.db.query<Tpl>(`SELECT code, vendor_code, review_state FROM alimtalk_templates WHERE code = $1`, [code]);
    return t ?? null;
  }

  /** 회원에게 실제로 보낼 수 있음 — 방식 · 키 · 이 템플릿 승인 · 켜기(notify.alimtalk_ready) */
  async ready(code: AlimtalkTemplateCode): Promise<boolean> {
    if ((await this.setting('notify.alimtalk_ready', 'off')).toLowerCase() !== 'on') return false;
    if (!AlimtalkService.configuredFor(await this.mode())) return false;
    const t = await this.tpl(code);
    return !!t && t.review_state === 'APPROVED' && !!t.vendor_code;
  }

  /**
   * 한 통 보내기 — 오류를 던지지 않고 결과로 돌려줌(부르는 쪽이 재시도 · 다른 길을 고름). 기록은 늘 남김.
   * opts.allowUnapproved — 시험 발송만(대행사 코드는 있어야 함 · 심의 중 시험을 대행사가 허락하는 경우)
   */
  async send(m: { to: string; template: AlimtalkTemplateCode; vars: Record<string, string | number>; purpose: 'CONSULT_OTP' | 'NOTIFY' | 'TEST' },
    opts: { allowUnapproved?: boolean } = {}): Promise<AlimtalkResult> {
    const mode = await this.mode();
    const to = String(m.to ?? '').replace(/\D/g, '');
    let r: AlimtalkResult;
    const t = await this.tpl(m.template);
    if (mode === 'NONE' || !AlimtalkService.configuredFor(mode)) {
      r = { ok: false, errorKind: 'NOT_READY', error: mode === 'NONE' ? '알림톡 방식이 NONE' : `빠진 설정 ${AlimtalkService.httpMissing().join(',')}` };
    } else if (!PHONE_RE.test(to)) {
      r = { ok: false, errorKind: 'BAD_PHONE', error: '휴대폰 번호 형식 아님' };
    } else if (!t?.vendor_code || (t.review_state !== 'APPROVED' && !opts.allowUnapproved)) {
      r = { ok: false, errorKind: 'TEMPLATE', error: !t?.vendor_code ? '대행사 템플릿 코드 없음' : `심의 상태 ${t.review_state}` };
    } else if (mode === 'MOCK') {
      r = { ok: true, msgId: 'MOCK-' + randomBytes(6).toString('hex') };
    } else {
      r = await this.http(to, t.vendor_code, m.template, m.vars);
    }
    try {
      await this.db.query(
        `INSERT INTO alimtalk_sends (purpose, template_code, to_last4, status, provider, provider_msg_id, error_kind, error)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [m.purpose, m.template, last4(to), r.ok ? 'SENT' : 'FAILED', mode, r.msgId ?? null, r.errorKind ?? null, r.error?.slice(0, 120) ?? null]);
    } catch (e) { this.log.error(`알림톡 기록 못 함(…${last4(to)}): ${(e as Error)?.message}`); }
    if (!r.ok) this.log.warn(`알림톡 실패 ${m.template} …${last4(to)} ${r.errorKind}: ${r.error ?? ''}`);
    return r;
  }

  private async http(to: string, vendorCode: string, code: AlimtalkTemplateCode, vars: Record<string, string | number>): Promise<AlimtalkResult> {
    const env = process.env;
    const timeout = Math.min(Math.max(Number(env.ALIMTALK_TIMEOUT_MS) || 8000, 1000), 30000);
    const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), timeout);
    try {
      const res = await fetch(env.ALIMTALK_URL!.trim(), {
        method: 'POST', signal: ac.signal,
        headers: { 'Content-Type': 'application/json', [env.ALIMTALK_AUTH_HEADER?.trim() || 'Authorization']: (env.ALIMTALK_AUTH_PREFIX ?? 'Bearer ') + env.ALIMTALK_KEY!.trim() },
        body: JSON.stringify({ senderKey: env.ALIMTALK_SENDER_KEY!.trim(), templateCode: vendorCode, recipientNo: to, content: renderAlimtalk(code, vars),
          variables: Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, String(v)])), fallbackSms: env.ALIMTALK_FALLBACK_SMS !== 'off' }),
      });
      const text = (await res.text()).slice(0, 2000);
      if (res.status === 401 || res.status === 403) return { ok: false, errorKind: 'AUTH', error: `${res.status} ${text.slice(0, 100)}` };
      if (res.status >= 500) return { ok: false, errorKind: 'SERVER', error: `${res.status} ${text.slice(0, 100)}` };
      if (!res.ok) return { ok: false, errorKind: 'REJECTED', error: `${res.status} ${text.slice(0, 100)}` };
      let id: string | null = null;
      try { const j = JSON.parse(text); id = String(pick(j, env.ALIMTALK_RESULT_ID_PATH?.trim() || 'messageId') ?? '') || null; } catch { id = null; }
      return { ok: true, msgId: id };
    } catch (e) {
      const aborted = (e as Error)?.name === 'AbortError';
      return { ok: false, errorKind: aborted ? 'TIMEOUT' : 'NETWORK', error: aborted ? `${timeout}ms 안에 응답 없음` : String((e as Error)?.message ?? e).slice(0, 100) };
    } finally { clearTimeout(timer); }
  }

  /* ── 알림 발송 SMS 채널 — QUEUED 를 알림톡(일반 템플릿)으로 ──────────── */
  async runNotify(limit = 50) {
    const out = { ready: false, sent: 0, failed: 0, retry: 0, closed: 0 };
    if (!(await this.ready('NOTICE_GENERAL'))) return out;
    out.ready = true;
    const rows = await this.db.query<{ id: string; title: string | null; body: string; phone: string | null; failed_reason: string | null; active: boolean; old: boolean; opted_out: boolean }>(
      `SELECT d.id::text AS id, n.title, n.body, a.phone, d.failed_reason, (a.status = 'ACTIVE') AS active, (n.created_at < now() - interval '3 days') AS old,
              (EXISTS (SELECT 1 FROM notification_preferences p
                        WHERE p.account_id = n.account_id AND p.event_code = n.event_code AND p.channel = 'SMS' AND NOT p.enabled)
               AND coalesce(pol.optout_allowed, true)) AS opted_out
         FROM notification_deliveries d JOIN notifications n ON n.id = d.notification_id JOIN accounts a ON a.id = n.account_id
         LEFT JOIN notification_event_policies pol ON pol.event_code = n.event_code
        WHERE d.channel = 'SMS' AND d.status = 'QUEUED' ORDER BY d.id LIMIT $1`, [limit]);
    for (const r of rows) {
      const close = !r.phone ? 'NO_PHONE: 받는 번호 없음' : !r.active ? 'ACCOUNT_INACTIVE: 쓰지 않는 계정'
        : r.opted_out ? 'OPTED_OUT: 회원이 이 알림 문자를 끔' : r.old ? 'EXPIRED: 3일 넘은 알림은 보내지 않음' : null;
      if (close) {
        await this.db.query(`UPDATE notification_deliveries SET status = 'FAILED', failed_reason = $2 WHERE id = $1::bigint AND status = 'QUEUED'`, [r.id, close]);
        out.closed++; continue;
      }
      const res = await this.send({ to: r.phone!, template: 'NOTICE_GENERAL', purpose: 'NOTIFY',
        vars: { 제목: (r.title ?? '').replace(/[\r\n]+/g, ' ').trim() || '소개뱅크 알림', 내용: r.body } });
      if (res.ok) {
        await this.db.query(
          `UPDATE notification_deliveries SET status = 'SENT', sent_at = now(), provider = 'ALIMTALK', provider_msg_id = $2, failed_reason = NULL
            WHERE id = $1::bigint AND status = 'QUEUED'`, [r.id, res.msgId ?? null]);
        out.sent++; continue;
      }
      const tries = Number(/^RETRY (\d+)/.exec(r.failed_reason ?? '')?.[1] ?? 0) + 1;
      const why = `${res.errorKind ?? 'ERROR'}: ${(res.error ?? '').slice(0, 120)}`;
      if (ALIMTALK_TEMP_ERRORS.has(res.errorKind ?? '') && tries < 3) {
        await this.db.query(`UPDATE notification_deliveries SET failed_reason = $2 WHERE id = $1::bigint AND status = 'QUEUED'`, [r.id, `RETRY ${tries} ${why}`]);
        out.retry++;
      } else {
        await this.db.query(`UPDATE notification_deliveries SET status = 'FAILED', failed_reason = $2 WHERE id = $1::bigint AND status = 'QUEUED'`, [r.id, why]);
        out.failed++;
      }
    }
    return out;
  }

  /* ── 운영 화면 ─────────────────────────────────────────────────── */
  async status() {
    const mode = await this.mode();
    const setting = await this.setting('alimtalk.provider', 'NONE');
    const admin = await this.db.query<{ name: string }>(`SELECT name FROM integration_secrets WHERE integration_code = 'ALIMTALK'`);
    const keys = ALIMTALK_KEY_NAMES.map((n) => ({ name: n, set: !!process.env[n]?.trim(), source: admin.some((r) => r.name === n) ? 'ADMIN' : process.env[n]?.trim() ? 'ENV' : 'NONE' }));
    const tpls = await this.db.query<{ code: AlimtalkTemplateCode; vendorCode: string | null; reviewState: string; updatedAt: Date }>(
      `SELECT code, vendor_code AS "vendorCode", review_state AS "reviewState", updated_at AS "updatedAt" FROM alimtalk_templates ORDER BY code`);
    const limit = Number(await this.setting('alimtalk.test_daily', '20')) || 0;
    const used = await this.testUsedToday();
    const switchOn = (await this.setting('notify.alimtalk_ready', 'off')).toLowerCase() === 'on';
    return {
      provider: mode, setting, mockAllowed: !isProd(), url: { set: !!process.env.ALIMTALK_URL?.trim() }, keys,
      missing: mode === 'HTTP' ? AlimtalkService.httpMissing() : [], configured: AlimtalkService.configuredFor(mode), switchOn,
      templates: tpls.map((t) => ({ ...t, name: ALIMTALK_TEMPLATES[t.code]?.name ?? t.code, body: ALIMTALK_TEMPLATES[t.code]?.body ?? '', vars: ALIMTALK_TEMPLATES[t.code]?.vars ?? [] })),
      test: { limit, used, left: Math.max(limit - used, 0) },
    };
  }

  private async testUsedToday() {
    const [c] = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM alimtalk_sends WHERE purpose = 'TEST' AND (created_at AT TIME ZONE 'Asia/Seoul')::date = (now() AT TIME ZONE 'Asia/Seoul')::date`);
    return c.n;
  }

  async setTemplate(code: string, dto: { vendorCode?: string | null; reviewState?: string }) {
    if (!(code in ALIMTALK_TEMPLATES)) throw new NotFound('없는 템플릿입니다.');
    const vc = dto.vendorCode == null ? null : String(dto.vendorCode).trim() || null;
    if (vc && !/^[A-Za-z0-9_-]{1,60}$/.test(vc)) throw new PolicyViolation('TEMPLATE_CODE_FORMAT', '대행사 템플릿 코드는 영문 · 숫자 · _ · - 60자 안입니다.');
    const st = dto.reviewState ?? undefined;
    if (st && !['NONE', 'REVIEW', 'APPROVED', 'REJECTED'].includes(st)) throw new PolicyViolation('TEMPLATE_STATE', '심의 상태는 NONE · REVIEW · APPROVED · REJECTED 중 하나입니다.');
    if (st === 'APPROVED' && !vc) throw new PolicyViolation('TEMPLATE_CODE_REQUIRED', '승인으로 바꾸려면 대행사 템플릿 코드가 있어야 합니다.');
    await this.db.query(
      `UPDATE alimtalk_templates SET vendor_code = $2, review_state = coalesce($3, review_state), updated_by = $4, updated_at = now() WHERE code = $1`,
      [code, vc, st ?? null, RequestCtx.actorId()]);
    return (await this.status()).templates;
  }

  async test(to: string, template: string = 'NOTICE_GENERAL') {
    const phone = String(to ?? '').replace(/\D/g, '');
    if (!PHONE_RE.test(phone)) throw new PolicyViolation('PHONE_INVALID', '휴대폰 번호를 확인해 주십시오.');
    if (!(template in ALIMTALK_TEMPLATES)) throw new NotFound('없는 템플릿입니다.');
    const mode = await this.mode();
    if (!AlimtalkService.configuredFor(mode)) throw new PolicyViolation('ALIMTALK_NOT_CONFIGURED', '알림톡 방식 · 키가 준비되지 않았습니다 — 위 표의 ✗ 줄을 채우십시오.');
    const limit = Number(await this.setting('alimtalk.test_daily', '20')) || 0;
    if ((await this.testUsedToday()) >= limit) throw new PolicyViolation('ALIMTALK_TEST_LIMIT', `오늘 시험 발송 ${limit}통을 다 썼습니다.`);
    const code = template as AlimtalkTemplateCode;
    const sample: Record<AlimtalkTemplateCode, Record<string, string>> = {
      CONSULT_OTP: { 인증번호: '123456', 분: '10' }, HANDOFF_ADMIN: { 건수: '1' },
      ORDER_STATUS: { 제목: '시험 발송', 내용: '운영 화면 시험 발송입니다.' }, NOTICE_GENERAL: { 제목: '시험 발송', 내용: '운영 화면 시험 발송입니다.' },
    };
    const r = await this.send({ to: phone, template: code, vars: sample[code], purpose: 'TEST' }, { allowUnapproved: true });
    return { ok: r.ok, to: `***${last4(phone)}`, msgId: r.msgId ?? null, errorKind: r.errorKind ?? null, error: r.error ?? null,
      left: Math.max(limit - (await this.testUsedToday()), 0) };
  }

  async sends(days: number) {
    const d = [1, 7, 30].includes(days) ? days : 7;
    const [c] = await this.db.query<{ sent: number; failed: number }>(
      `SELECT count(*) FILTER (WHERE status = 'SENT')::int AS sent, count(*) FILTER (WHERE status = 'FAILED')::int AS failed
         FROM alimtalk_sends WHERE created_at > now() - make_interval(days => $1)`, [d]);
    const reasons = await this.db.query<{ reason: string; n: number }>(
      `SELECT error_kind AS reason, count(*)::int AS n FROM alimtalk_sends
        WHERE status = 'FAILED' AND created_at > now() - make_interval(days => $1) GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 20`, [d]);
    const recent = await this.db.query(
      `SELECT created_at AS at, purpose, template_code AS template, to_last4 AS "toLast4", status, error_kind AS "errorKind", error
         FROM alimtalk_sends WHERE created_at > now() - make_interval(days => $1) ORDER BY id DESC LIMIT 50`, [d]);
    return { days: d, sent: c.sent, failed: c.failed, reasons, recent };
  }
}

/** a.b.c 경로로 값 꺼내기(대행사 응답의 메시지 번호) */
function pick(o: any, path: string): unknown {
  return path.split('.').reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), o);
}

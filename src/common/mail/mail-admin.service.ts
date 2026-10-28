import { Injectable } from '@nestjs/common';
import * as tls from 'tls';
import { DatabaseService } from '../../db/database.service';
import { PolicyViolation } from '../../core/errors';
import { MailService, SES_SEOUL_HOST } from './mail.service';

/* ---------------------------------------------------------------------
 * v10.140 (D136 · docs/211 · 설계 docs/210) — 운영 화면 › 외부 연동 › 「메일」
 *
 *   준비 상태 — 주소 · 사용자 이름 · 비밀번호 · 보내는 주소 · 스위치(notify.email_verified) 다섯 줄 · 값은 내보내지 않음(주소만 · 키는 어디서 왔는지)
 *   연결 확인 — SES 에 TLS 로 붙어 첫 인사(220)만 받고 끊음(메일 안 보냄 · 로그인 안 함)
 *   시험 메일 — SUPER 가 넣은 주소로 한 통 · **스위치와 따로**(꺼져 있어도 보냄 — 회원 알림은 그대로 안 나감) · 하루 notify.mail_test_daily(20)
 *   발송 기록 — 최근 N일 알림 메일 보냄 · 실패 · 대기 수 · 실패 까닭별 · 최근 실패 50줄(받는 주소는 앞 2글자 · 도메인만)
 * ------------------------------------------------------------------- */

const EMAIL_RE = /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/;
export const maskMail = (e: string | null | undefined) => (e ? `${e.slice(0, 2)}***@${e.split('@')[1] ?? ''}` : null);

@Injectable()
export class MailAdminService {
  constructor(private readonly db: DatabaseService, private readonly mail: MailService) {}

  async status() {
    const env = process.env;
    const st = await this.mail.settings();
    const admin = await this.db.query<{ name: string }>(`SELECT name FROM integration_secrets WHERE integration_code = 'MAIL'`);
    const src = (name: string, v: string | undefined) => (admin.some((r) => r.name === name) ? 'ADMIN' : v?.trim() ? 'ENV' : 'NONE');
    const [lim] = await this.db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = 'notify.mail_test_daily'`);
    const limit = Number(lim?.v ?? 20) || 0;
    const used = await this.usedToday();
    const cfg = this.mail.config(env, st.from);
    return {
      host: { value: env.SMTP_HOST?.trim() || SES_SEOUL_HOST, source: env.SMTP_HOST?.trim() ? 'ENV' : 'DEFAULT', port: Number(env.SMTP_PORT) || 465 },
      user: { set: !!env.SMTP_USER?.trim(), source: src('SMTP_USER', env.SMTP_USER) },
      pass: { set: !!env.SMTP_PASS, source: src('SMTP_PASS', env.SMTP_PASS) },
      from: { set: !!(st.from?.trim() || env.MAIL_FROM?.trim()), value: st.from?.trim() || env.MAIL_FROM?.trim() || null, source: st.from?.trim() ? 'SETTING' : env.MAIL_FROM?.trim() ? 'ENV' : 'NONE' },
      switchOn: st.verified,
      configured: !!cfg,
      ready: st.verified && !!cfg,
      test: { limit, used, left: Math.max(limit - used, 0) },
    };
  }

  /** SES 에 붙어 첫 인사(220)까지만 — 운영 서버에서 465 로 나갈 수 있는지(메일 · 로그인 없음) */
  async connect(): Promise<{ ok: boolean; host: string; port: number; ms: number; errorKind?: string; error?: string }> {
    const host = process.env.SMTP_HOST?.trim() || SES_SEOUL_HOST;
    const port = Number(process.env.SMTP_PORT) || 465;
    const t0 = Date.now();
    return new Promise((resolve) => {
      let done = false;
      const sock = tls.connect({ host, port, servername: host });
      const end = (r: { ok: boolean; errorKind?: string; error?: string }) => {
        if (done) return; done = true;
        clearTimeout(timer);
        try { if (r.ok) sock.write('QUIT\r\n'); sock.end(); sock.destroy(); } catch { /* 닫기 실패는 무시 */ }
        resolve({ host, port, ms: Date.now() - t0, ...r });
      };
      const timer = setTimeout(() => end({ ok: false, errorKind: 'TIMEOUT', error: '5초 안에 응답이 없습니다' }), 5000);
      sock.setEncoding('utf8');
      sock.on('data', (d: string) => end(/^220/.test(d) ? { ok: true } : { ok: false, errorKind: 'REJECTED', error: String(d).slice(0, 80) }));
      sock.on('error', (e: any) => end({ ok: false, errorKind: 'NETWORK', error: String(e?.code ?? e?.message ?? e).slice(0, 80) }));
    });
  }

  /** 시험 메일 한 통 — 스위치와 따로 · 하루 한도 · 받는 주소는 결과 · 감사 기록에 가려서 */
  async test(to: string) {
    const addr = String(to ?? '').trim();
    if (!EMAIL_RE.test(addr) || /[\r\n]/.test(addr)) throw new PolicyViolation('EMAIL_INVALID', '이메일 주소를 확인해 주십시오.');
    const s = await this.status();
    if (!s.configured) throw new PolicyViolation('MAIL_NOT_CONFIGURED', '메일 설정이 아직 없습니다 — 사용자 이름 · 비밀번호 · 보내는 주소를 먼저 넣어 주십시오.');
    if (s.test.left <= 0) throw new PolicyViolation('MAIL_TEST_LIMIT', `오늘 시험 메일(${s.test.limit}통)을 다 보냈습니다. 내일 다시 보내 주십시오.`);
    const at = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const r = await this.mail.send({
      to: addr, subject: '[소개뱅크] 시험 메일',
      text: `소개뱅크 운영 화면에서 보낸 시험 메일입니다(${at} UTC).\n\n이 메일이 받은편지함(스팸함 아님)에 왔다면 메일 설정이 맞습니다.\n원본 보기에서 spf=pass · dkim=pass · dmarc=pass 를 확인한 뒤 알림 메일 스위치(notify.email_verified)를 켜 주십시오(docs/167 7단계).`,
    });
    return { ok: r.ok, to: maskMail(addr), messageId: r.messageId ?? null, errorKind: r.errorKind ?? null, error: r.error ?? null, left: Math.max(s.test.left - 1, 0) };
  }

  /** 알림 메일 발송 기록 — 숫자 · 까닭 · 최근 실패(주소 가림) */
  async deliveries(days = 7) {
    const d = [1, 7, 30].includes(days) ? days : 7;
    const counts = await this.db.query<{ status: string; n: number }>(
      `SELECT d.status, count(*)::int AS n FROM notification_deliveries d JOIN notifications n ON n.id = d.notification_id
        WHERE d.channel = 'EMAIL' AND n.created_at >= now() - make_interval(days => $1) GROUP BY d.status`, [d]);
    const reasons = await this.db.query<{ reason: string; n: number }>(
      `SELECT coalesce(nullif(split_part(d.failed_reason, ' ', 1), ''), '(없음)') AS reason, count(*)::int AS n
         FROM notification_deliveries d JOIN notifications n ON n.id = d.notification_id
        WHERE d.channel = 'EMAIL' AND d.status = 'FAILED' AND n.created_at >= now() - make_interval(days => $1)
        GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, [d]);
    const recent = await this.db.query<{ at: string; event: string; reason: string | null; email: string | null }>(
      `SELECT n.created_at AS at, n.event_code AS event, left(d.failed_reason, 120) AS reason, a.email
         FROM notification_deliveries d JOIN notifications n ON n.id = d.notification_id JOIN accounts a ON a.id = n.account_id
        WHERE d.channel = 'EMAIL' AND d.status = 'FAILED' AND n.created_at >= now() - make_interval(days => $1)
        ORDER BY n.created_at DESC LIMIT 50`, [d]);
    const by = (k: string) => counts.find((c) => c.status === k)?.n ?? 0;
    return { days: d, sent: by('SENT') + by('DELIVERED'), failed: by('FAILED'), queued: by('QUEUED'), reasons,
             recent: recent.map((r) => ({ at: r.at, event: r.event, reason: r.reason, to: maskMail(r.email) })) };
  }

  /** 오늘(서울) 보낸 시험 메일 수 — 감사 기록 MAIL_TEST 로 셈 */
  private async usedToday(): Promise<number> {
    const [r] = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit.audit_logs WHERE action = 'MAIL_TEST'
          AND occurred_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'`).catch(() => [{ n: 0 }]);
    return r?.n ?? 0;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { MailMessage, SmtpConfig, SmtpConnect, SmtpResult, smtpSend } from './smtp';

/* ---------------------------------------------------------------------
 * v10.43 (2026-10-15) — 메일 발송 (Amazon SES SMTP)
 *
 * 환경 변수 (운영 .env 에 사람이 넣습니다 — 값은 화면 · 응답 · 로그 · DB 에 싣지 않습니다)
 *   SMTP_HOST        email-smtp.ap-northeast-2.amazonaws.com — v10.140: 비면 이 서울 SES 주소(SES_SEOUL_HOST)
 *   SMTP_PORT        465 (기본 — 처음부터 TLS)
 *   SMTP_USER        SES 「SMTP 자격 증명」 사용자 이름 (IAM 액세스 키와 다릅니다)
 *   SMTP_PASS        SES 「SMTP 자격 증명」 비밀번호
 *   MAIL_FROM        (선택) 보내는 주소 — **운영 설정 notify.mail_from 이 우선**입니다(운영 화면에서 바꿈 · open:check 가 봄).
 *                    notify.mail_from 이 비어 있을 때만 이 값을 씁니다. 예: no-reply@mail.sogaebank.com (SES 에서 인증한 도메인)
 *   MAIL_FROM_NAME   소개뱅크 (기본)
 *   SMTP_TIMEOUT_MS  10000 (기본)
 *
 *   v10.140 (D136 · docs/211) — SMTP_USER · SMTP_PASS 는 운영 화면(외부 연동 › 연동 키)에서 넣으면 IntegrationSecretService 가 process.env 에 얹음
 *            → 운영 .env 수정 · 재시작 없이. 시험 메일 · 준비 상태 · 발송 기록은 MailAdminService(운영 화면 › 외부 연동 › 메일).
 *
 * 「보낼 수 있음(ready)」 = SMTP_HOST · USER · PASS 와 보내는 주소가 있고 **운영 설정 notify.email_verified = on**.
 *   notify.email_verified 는 B900 부터 있던 스위치입니다(SPF · DKIM · DMARC 를 마치고 실제 도달을 확인했는가).
 *   운영자가 시험 메일이 받은편지함(스팸함 아님)에 오는 것을 본 뒤 켭니다 — docs/92 5절.
 *   설정만 있고 스위치가 off 면 보내지 않습니다(보냈다고 착각하지 않기 위해).
 * ------------------------------------------------------------------- */

/** v10.140 — SMTP_HOST 가 비었을 때 쓰는 주소(서울 SES · docs/167) */
export const SES_SEOUL_HOST = 'email-smtp.ap-northeast-2.amazonaws.com';

@Injectable()
export class MailService {
  private readonly log = new Logger('Mail');
  /** 시험에서 일반 소켓을 끼우기 위한 자리 — 운영에서는 비워 둡니다(TLS) */
  connect?: SmtpConnect;

  constructor(private readonly db: DatabaseService) {}

  /** 설정 — 하나라도 빠지면 null. fromSetting = 운영 설정 notify.mail_from (비면 MAIL_FROM) */
  config(env: NodeJS.ProcessEnv = process.env, fromSetting?: string | null): SmtpConfig | null {
    const host = env.SMTP_HOST?.trim() || SES_SEOUL_HOST, user = env.SMTP_USER?.trim(), pass = env.SMTP_PASS;
    const from = fromSetting?.trim() || env.MAIL_FROM?.trim();
    if (!host || !user || !pass || !from) return null;
    return {
      host, user, pass, from,
      port: Number(env.SMTP_PORT) || 465,
      fromName: env.MAIL_FROM_NAME?.trim() || '소개뱅크',
      timeoutMs: Number(env.SMTP_TIMEOUT_MS) || 10000,
    };
  }

  /** 운영 설정 두 개를 한 번에 — 보내는 주소 · 메일 인증 스위치 */
  async settings(): Promise<{ from: string | null; verified: boolean }> {
    const [r] = await this.db.query<{ from: string | null; verified: boolean }>(
      `SELECT (SELECT value FROM site_settings WHERE key = 'notify.mail_from') AS "from",
              coalesce((SELECT ready FROM v_notify_channels WHERE channel = 'EMAIL'), false) AS verified`);
    return { from: r?.from ?? null, verified: !!r?.verified };
  }

  /** 실제로 보낼 수 있는가 — 설정 있음 + notify.email_verified = on */
  async ready(): Promise<boolean> {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return false;   /* 개발 PC · 설정 전 — DB 를 부르지 않음(v10.140: 주소는 기본값이 있어 사용자 이름 · 비밀번호로 봄) */
    const st = await this.settings();
    return st.verified && !!this.config(process.env, st.from);
  }

  /** 한 통 보내기. 받는 주소는 로그에 앞 2글자만 남깁니다 */
  async send(m: MailMessage): Promise<SmtpResult> {
    const cfg = this.config(process.env, (await this.settings()).from);
    if (!cfg) return { ok: false, errorKind: 'BAD_INPUT', error: '메일 설정(SMTP_*) 이 없습니다' };
    const r = await smtpSend(cfg, m, this.connect);
    const who = m.to.slice(0, 2) + '***@' + (m.to.split('@')[1] ?? '');
    if (r.ok) this.log.log(`보냄 ${who} ${r.messageId}`);
    else this.log.warn(`보내지 못함 ${who} ${r.errorKind}: ${r.error}`);
    return r;
  }
}

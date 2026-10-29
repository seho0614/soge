import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { DatabaseService } from '../../db/database.service';
import { MailService } from '../../common/mail/mail.service';
import { AppError, Forbidden, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { AuthService } from './auth.service';
import {
  AccountLocked, TooManyAttempts, assertStrongPassword, clientIpKey, minutesText, tokenHash,
} from './auth-throttle';

/* ---------------------------------------------------------------------
 * v10.48 (D102 · 2026-10-20) — 비밀번호 재설정 · 변경 · 회원 탈퇴 · 운영 잠금 해제
 *
 *   재설정   POST /auth/password/forgot  → 가입 메일로 30분짜리 1회용 링크(증표 원문은 메일에만 · DB 에는 sha256)
 *            POST /auth/password/reset   → 새 비밀번호 · 판 번호 +1(그 전 로그인 모두 끊김) · 잠금 해제
 *            계정이 있든 없든 같은 답을 합니다 — 이 화면으로 가입 여부를 알아낼 수 없게.
 *            메일 발송(SES) 준비 전: 운영은 MAIL_NOT_READY(고객센터 안내) · 개발(NODE_ENV=development)은 응답에 devLink
 *   변경     PATCH /me/password          → 현재 비밀번호 확인(틀리면 로그인 실패와 같이 셈) · 새 증표를 돌려줌
 *   탈퇴     GET  /me/withdraw/check · POST /me/withdraw → 막는 항목은 DB 함수 fn_withdraw_blockers 한 곳(약관 제13조 ②)
 *   운영     GET/DELETE /admin/accounts/:id/login-lock
 * ------------------------------------------------------------------- */

export const WITHDRAW_REASONS: Record<string, string> = {
  LOW_USE: '자주 쓰지 않아서',
  NOT_USEFUL: '원하는 소개를 찾기 어려워서',
  OTHER_SERVICE: '다른 서비스를 쓰려고',
  PRIVACY: '개인정보가 걱정돼서',
  BAD_EXPERIENCE: '이용 중 불편을 겪어서',
  OTHER: '기타(직접 적기)',
};

type Blocker = { code: string; label: string; cnt: number; link: string };

@Injectable()
export class AccountSecurityService {
  constructor(
    private readonly db: DatabaseService,
    private readonly mail: MailService,
    private readonly auth: AuthService,
  ) {}

  private static devMode(): boolean {
    return (process.env.NODE_ENV ?? 'development') === 'development';
  }

  /** v10.147 — 재설정 메일을 보낼 수 있는가 · 화면이 입력 전에 고객센터로 안내하려고(forgot 과 같은 기준) */
  async forgotReady() {
    return { ready: (await this.mail.ready()) || AccountSecurityService.devMode() };
  }

  /* ── 재설정 메일 ─────────────────────────────────────────────── */
  async forgot(emailRaw: string) {
    const email = String(emailRaw ?? '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 120) {
      throw new PolicyViolation('EMAIL_INVALID', '이메일 형식이 맞지 않습니다.');
    }
    const ready = await this.mail.ready();
    const dev = AccountSecurityService.devMode();
    if (!ready && !dev) {
      /* 계정 유무와 관계없이 같은 답 — 메일을 보낼 수 없을 때는 고객센터로 */
      throw new PolicyViolation('MAIL_NOT_READY',
        '메일 발송을 준비하는 중이라 지금은 비밀번호 재설정 메일을 보낼 수 없습니다. 고객센터 「계정」 문의로 알려 주시면 확인 뒤 도와 드립니다.');
    }
    const ipKey = clientIpKey();
    const [ok] = await this.db.query<{ allowed: boolean }>(
      `SELECT fn_reset_request_allowed($1, $2) AS allowed`, [email, ipKey]);
    if (!ok?.allowed) {
      throw new TooManyAttempts('TOO_MANY_REQUESTS', '재설정 메일 요청이 많습니다. 1시간 뒤에 다시 요청해 주십시오.');
    }
    const [mins] = await this.db.query<{ v: number }>(`SELECT fn_setting_int('auth.reset.ttl_minutes', 30) AS v`);
    const ttl = Math.min(60, Number(mins?.v ?? 30));
    const note = `가입된 이메일이면 비밀번호 재설정 링크를 보냈습니다. ${ttl}분 안에 메일의 링크를 여십시오. 받은편지함에 없으면 스팸함을 확인해 주십시오.`;

    const [acc] = await this.db.query<{ id: string; email: string }>(
      `SELECT id, email FROM accounts WHERE email = $1 AND status = 'ACTIVE' AND withdrawn_at IS NULL`, [email]);
    if (!acc) return { ok: true, note };

    const token = randomBytes(32).toString('base64url');
    await this.db.query(`SELECT fn_password_reset_issue($1, $2, $3)`, [acc.id, tokenHash(token), ipKey]);
    const path = `/login/reset?token=${token}`;

    if (ready) {
      const [b] = await this.db.query<{ v: string | null }>(
        `SELECT value AS v FROM site_settings WHERE key = 'site.base_url'`);
      const base = (b?.v || 'https://sogaebank.com').replace(/\/+$/, '');
      const sent = await this.mail.send({
        to: acc.email,
        subject: '[소개뱅크] 비밀번호 재설정 안내',
        text: `소개뱅크 비밀번호 재설정 링크입니다.\n\n${base}${path}\n\n`
            + `${ttl}분 동안 한 번만 쓸 수 있습니다. 새로 요청하시면 이 링크는 쓸 수 없게 됩니다.\n`
            + `직접 요청하지 않으셨다면 이 메일을 무시하십시오 — 비밀번호는 바뀌지 않습니다.\n\n`
            + `본 메일은 발신 전용입니다.\n(주)한국바이오헬스케어 소개뱅크 사업부`,
      });
      if (!sent.ok) {
        /* 보내지 못한 링크는 바로 무효 — 남겨 두면 메일함 밖에서 쓰일 수 있는 것처럼 보입니다 */
        await this.db.query(
          `UPDATE password_reset_tokens SET revoked_at = now() WHERE token_hash = $1 AND used_at IS NULL`, [tokenHash(token)]);
        throw new PolicyViolation('MAIL_SEND_FAILED', '재설정 메일을 보내지 못했습니다. 잠시 뒤 다시 시도해 주십시오.');
      }
      return { ok: true, note };
    }
    /* 개발 환경 · 메일 설정 전 — 흐름 시험용 링크(운영은 위에서 MAIL_NOT_READY) */
    return { ok: true, note, devLink: path };
  }

  /* ── 재설정 ──────────────────────────────────────────────────── */
  async reset(token: string, password: string) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{30,100}$/.test(token)) {
      throw new PolicyViolation('RESET_TOKEN_INVALID', '링크가 올바르지 않습니다. 비밀번호 찾기에서 다시 요청해 주십시오.');
    }
    assertStrongPassword(password);
    const hash = await bcrypt.hash(password, 12);
    await this.db.transaction(async () => {
      const [r] = await this.db.query<{ a: string | null }>(`SELECT fn_password_reset_consume($1) AS a`, [tokenHash(token)]);
      if (!r?.a) {
        throw new PolicyViolation('RESET_TOKEN_INVALID', '링크가 만료됐거나 이미 쓰였습니다. 비밀번호 찾기에서 다시 요청해 주십시오.');
      }
      const [acc] = await this.db.query<{ email: string }>(
        `UPDATE accounts SET password_hash = $2, password_changed_at = now(), token_version = token_version + 1
          WHERE id = $1 RETURNING email`, [r.a, hash]);
      await this.db.query(`SELECT fn_login_clear($1)`, [acc.email]);
      await this.notifyChanged(r.a, '비밀번호 재설정');
      await this.audit(r.a, 'PASSWORD_RESET', { via: 'MAIL_LINK' });
    });
    return { ok: true, note: '비밀번호를 바꿨습니다. 새 비밀번호로 로그인해 주십시오. 다른 기기의 로그인은 모두 풀렸습니다.' };
  }

  /* ── 로그인 상태에서 변경 ────────────────────────────────────── */
  async change(current: string, next: string) {
    const me = RequestCtx.actorId();
    if (!me) throw new Forbidden('UNAUTHENTICATED', '로그인이 필요합니다.');
    assertStrongPassword(next);
    if (current === next) throw new PolicyViolation('SAME_PASSWORD', '지금과 다른 비밀번호를 넣어 주십시오.');
    await this.checkPassword(me, current);
    const hash = await bcrypt.hash(next, 12);
    await this.db.transaction(async () => {
      await this.db.query(
        `UPDATE accounts SET password_hash = $2, password_changed_at = now(), token_version = token_version + 1
          WHERE id = $1`, [me, hash]);
      await this.notifyChanged(me, '비밀번호 변경');
      await this.audit(me, 'PASSWORD_CHANGE', {});
    });
    /* 판 번호가 올라 지금 쓰던 증표도 무효 — 이 기기에서는 새 증표로 이어 갑니다(다른 기기는 끊김) */
    const t = await this.auth.issue(me);
    return { ok: true, note: '비밀번호를 바꿨습니다. 다른 기기의 로그인은 모두 풀렸습니다.', accessToken: t.accessToken, refreshToken: t.refreshToken };
  }

  /* ── 탈퇴 ───────────────────────────────────────────────────── */
  async withdrawCheck() {
    const me = RequestCtx.actorId();
    if (!me) throw new Forbidden('UNAUTHENTICATED', '로그인이 필요합니다.');
    const blockers = await this.blockers(me);
    const [x] = await this.db.query<{ has_deal: boolean; paid_sub: boolean; partner: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM deals d WHERE $1 IN (d.buyer_account_id, d.seller_account_id, d.introducer_account_id)) AS has_deal,
              EXISTS (SELECT 1 FROM subscriptions s JOIN subscription_plans p ON p.code = s.plan_code
                       WHERE s.account_id = $1 AND s.status IN ('ACTIVE','PAST_DUE') AND p.monthly_price > 0) AS paid_sub,
              EXISTS (SELECT 1 FROM partners p JOIN businesses b ON b.id = p.business_id
                       WHERE b.account_id = $1 AND p.status IN ('APPLIED','ACTIVE')) AS partner`, [me]);
    return {
      canWithdraw: blockers.length === 0,
      blockers,
      reasons: Object.entries(WITHDRAW_REASONS).map(([code, label]) => ({ code, label })),
      keepsRecords: !!x?.has_deal,
      paidSubscription: !!x?.paid_sub,
      partner: !!x?.partner,
      notes: [
        '탈퇴하시면 올린 매물 · 요청이 바로 내려가고, 발급한 소개코드가 멈춥니다.',
        x?.has_deal
          ? '거래 기록이 있어 관련 법령(전자상거래법 · 상법)에 따라 5년 동안 보관한 뒤 파기합니다. 그 기간에도 로그인과 이용은 할 수 없습니다.'
          : '거래 기록이 없어 회원 정보(이메일 · 이름 · 연락처)를 바로 파기합니다.',
        ...(x?.paid_sub ? ['유료 구독은 자동 결제를 멈춥니다. 이미 낸 기간의 환불 규칙은 구독 환불 약관을 따릅니다.'] : []),
        ...(x?.partner ? ['파트너센터 활동(입점 · 서비스 노출)도 함께 끝납니다.'] : []),
        '같은 이메일로 다시 가입하시려면 파기가 끝난 뒤에 하실 수 있습니다.',
      ],
    };
  }

  async withdraw(password: string, reason: string, memo?: string) {
    const me = RequestCtx.actorId();
    if (!me) throw new Forbidden('UNAUTHENTICATED', '로그인이 필요합니다.');
    if (!WITHDRAW_REASONS[reason]) throw new PolicyViolation('BAD_REASON', '탈퇴 사유를 골라 주십시오.');
    const m = (memo ?? '').trim();
    if (reason === 'OTHER' && m.length < 2) throw new PolicyViolation('MEMO_REQUIRED', '「기타」를 고르셨으면 사유를 적어 주십시오.');
    if (m.length > 500) throw new PolicyViolation('MEMO_TOO_LONG', '사유는 500자까지 적을 수 있습니다.');
    await this.checkPassword(me, password);
    const blockers = await this.blockers(me);
    if (blockers.length) {
      throw new AppError(409, {
        code: 'WITHDRAW_BLOCKED',
        message: `${blockers.map((b) => b.label).join(' · ')}이(가) 끝난 뒤에 탈퇴하실 수 있습니다.`,
        details: { blockers },
      });
    }
    let retentionUntil: string | null = null;
    try {
      retentionUntil = await this.db.transaction(async () => {
        const [r] = await this.db.query<{ d: string | null }>(
          `SELECT fn_account_withdraw($1, $2, $3)::text AS d`, [me, reason, m || null]);
        await this.audit(me, 'ACCOUNT_WITHDRAW', { reason });
        return r?.d ?? null;
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('WITHDRAW_BLOCKED')) {
        throw new AppError(409, { code: 'WITHDRAW_BLOCKED', message: '진행 중인 일이 생겨 탈퇴를 마치지 못했습니다. 다시 확인해 주십시오.' });
      }
      if (msg.includes('WITHDRAW_NOT_ACTIVE')) throw new StateConflict('WITHDRAW_NOT_ACTIVE', '탈퇴할 수 없는 계정입니다.');
      throw e;
    }
    return { ok: true, retentionUntil, note: '탈퇴했습니다. 그동안 소개뱅크를 이용해 주셔서 고맙습니다.' };
  }

  /* ── 운영: 잠금 보기 · 풀기 ────────────────────────────────── */
  async lockState(accountId: string) {
    const [r] = await this.db.query<{ locked_until: Date | null; hits: number | null; last_at: Date | null }>(
      `SELECT t.locked_until, t.hits, t.last_at
         FROM accounts a
         LEFT JOIN auth_throttle t ON t.key_kind = 'LOGIN_EMAIL' AND t.key_hash = fn_auth_email_key(a.email)
        WHERE a.id = $1`, [accountId]);
    const locked = !!r?.locked_until && new Date(r.locked_until).getTime() > Date.now();
    return { locked, lockedUntil: locked ? r!.locked_until : null, recentFails: locked ? 0 : Number(r?.hits ?? 0), lastFailAt: r?.last_at ?? null };
  }

  async unlock(accountId: string) {
    const [a] = await this.db.query<{ email: string }>(`SELECT email FROM accounts WHERE id = $1`, [accountId]);
    if (!a) throw new PolicyViolation('NOT_FOUND', '회원이 없습니다.');
    const [r] = await this.db.query<{ n: number }>(`SELECT fn_login_clear($1) AS n`, [a.email]);
    return { ok: true, cleared: Number(r?.n ?? 0) > 0 };
  }

  /* ── 안쪽 ───────────────────────────────────────────────────── */
  private async blockers(accountId: string): Promise<Blocker[]> {
    return this.db.query<Blocker>(`SELECT code, label, cnt, link FROM fn_withdraw_blockers($1)`, [accountId]);
  }

  /** 현재 비밀번호 확인 — 틀리면 로그인 실패와 같이 셉니다(로그인한 증표를 훔친 사람이 비밀번호를 맞혀 보지 못하게) */
  private async checkPassword(accountId: string, password: string) {
    const [a] = await this.db.query<{ email: string; password_hash: string }>(
      `SELECT email, password_hash FROM accounts WHERE id = $1`, [accountId]);
    if (!a) throw new Forbidden('UNAUTHENTICATED', '로그인이 필요합니다.');
    const ipKey = clientIpKey();
    const [gate] = await this.db.query<{ blocked: string | null; retry_after_sec: number }>(
      `SELECT blocked, retry_after_sec FROM fn_login_gate($1, $2)`, [a.email, ipKey]);
    if (gate && gate.blocked === 'LOCKED') throw new AccountLocked(gate.retry_after_sec);
    if (gate && gate.blocked === 'TOO_MANY') {
      throw new TooManyAttempts('TOO_MANY_ATTEMPTS', `잠시 뒤에 다시 시도해 주십시오(${minutesText(gate.retry_after_sec)}).`, gate.retry_after_sec);
    }
    if (typeof password !== 'string' || !a.password_hash || !(await bcrypt.compare(password, a.password_hash))) {
      const [f] = await this.db.query<{ locked_until: Date | null }>(
        `SELECT locked_until FROM fn_login_fail($1, $2)`, [a.email, ipKey]);
      if (f && f.locked_until) throw new AccountLocked(Math.ceil((new Date(f.locked_until).getTime() - Date.now()) / 1000));
      throw new PolicyViolation('CURRENT_PASSWORD_WRONG', '지금 비밀번호가 맞지 않습니다.');
    }
    await this.db.query(`SELECT fn_login_clear($1)`, [a.email]);
  }

  private async notifyChanged(accountId: string, what: string) {
    await this.db.query(
      `INSERT INTO notifications (account_id, event_code, title, body, link_url)
       VALUES ($1, 'PASSWORD_CHANGED', $2, $3, '/login/forgot')`,
      [accountId, `${what}이 끝났습니다`,
       '비밀번호가 바뀌어 다른 기기의 로그인이 모두 풀렸습니다. 직접 하신 것이 아니라면 바로 비밀번호 찾기로 다시 바꿔 주십시오.']);
  }

  /** 감사 기록 — 응답(새 증표)이 감사 기록에 들어가지 않도록 @Audit 대신 여기서 남깁니다 */
  private async audit(accountId: string, action: string, data: Record<string, unknown>) {
    const c = RequestCtx.get();
    await this.db.query(
      `INSERT INTO audit.audit_logs (actor_account_id, actor_role, action, target_type, target_id, after_data, ip, user_agent)
       VALUES ($1, $2, $3, 'ACCOUNT', $1, $4::jsonb, $5, $6)`,
      [accountId, c?.actorRole ?? 'MEMBER', action, JSON.stringify(data), c?.ip ?? null, c?.userAgent ?? null]);
  }
}

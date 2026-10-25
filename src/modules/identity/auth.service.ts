import { Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcryptjs';
import { DatabaseService } from '../../db/database.service';
import { PrincipalService } from './principal.service';
import { AppError, Forbidden, PolicyViolation, NotFound } from '../../core/errors';
import { AccountLocked, TooManyAttempts, assertStrongPassword, clientIpKey, minutesText } from './auth-throttle';
import { AttributionEngine } from '../../engines/attribution/attribution.engine';
import { RequestCtx } from '../../core/request-context';
import { I18nService } from '../i18n/i18n.service';

const ACCESS_TTL = '15m';
const REFRESH_TTL_DAYS = 14;

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly principals: PrincipalService,
    private readonly attribution: AttributionEngine,
    private readonly i18n: I18nService,
  ) {}

  async login(email: string, password: string, visitorKey?: string) {
    /* v10.48 (D102) — 로그인 잠금 · 요청 횟수 제한. 판정은 DB 함수 한 곳입니다.
     *   같은 이메일 5회 연속 실패 → 30분 잠금(423) · 같은 IP 의 실패 1분 5회 → 429.
     *   계정이 없는 이메일도 똑같이 세고 똑같이 답합니다 — 잠금 여부로 계정 유무를 알 수 없게. */
    const ipKey = clientIpKey();
    const [gate] = await this.db.query<{ blocked: string | null; retry_after_sec: number }>(
      `SELECT blocked, retry_after_sec FROM fn_login_gate($1, $2)`, [email, ipKey]);
    if (gate && gate.blocked === 'LOCKED') throw new AccountLocked(gate.retry_after_sec);
    if (gate && gate.blocked === 'TOO_MANY') {
      throw new TooManyAttempts('TOO_MANY_ATTEMPTS',
        `로그인 실패가 많아 잠시 막았습니다. ${minutesText(gate.retry_after_sec)} 뒤에 다시 시도해 주십시오.`, gate.retry_after_sec);
    }

    const [acc] = await this.db.query<{ id: string; password_hash: string; status: string }>(
      `SELECT id, password_hash, status FROM accounts WHERE email = $1`,
      [email],
    );
    // 계정 없음과 비밀번호 불일치를 구분하지 않습니다 — 계정 존재 여부가 새면 안 됩니다
    if (!acc || !acc.password_hash || !(await bcrypt.compare(password, acc.password_hash))) {
      const [f] = await this.db.query<{ fails: number; locked_until: Date | null }>(
        `SELECT fails, locked_until FROM fn_login_fail($1, $2)`, [email, ipKey]);
      if (f && f.locked_until) {
        if (acc) await this.notifyLocked(acc.id);
        throw new AccountLocked(Math.ceil((new Date(f.locked_until).getTime() - Date.now()) / 1000));
      }
      const [mx] = await this.db.query<{ v: number }>(`SELECT fn_setting_int('auth.login.max_fail', 5) AS v`);
      const left = Math.max(0, Number(mx?.v ?? 5) - Number(f?.fails ?? 0));
      throw new AppError(403, {
        code: 'INVALID_CREDENTIALS',
        message: left > 0 && left <= 2
          ? `이메일 또는 비밀번호가 올바르지 않습니다. ${left}번 더 틀리면 잠시 잠깁니다.`
          : '이메일 또는 비밀번호가 올바르지 않습니다.',
        details: { attemptsLeft: left },
      });
    }
    if (acc.status !== 'ACTIVE') {
      throw new Forbidden('ACCOUNT_INACTIVE', '사용할 수 없는 계정입니다.');
    }
    await this.db.query(`SELECT fn_login_clear($1)`, [email]);

    // ★ 귀속 연결. 이 호출이 빠지면 비로그인 유입이 전부 유실됩니다
    if (visitorKey) {
      await this.attribution.link(visitorKey, acc.id, 'LOGIN');
    }

    await this.db.query(`UPDATE accounts SET last_login_at = now() WHERE id = $1`, [acc.id]);
    return this.issue(acc.id);
  }

  /** 잠겼다는 알림 — 본인이 아니라면 비밀번호를 바꾸라는 뜻. 알림을 남기지 못해도 로그인 응답은 그대로 */
  private async notifyLocked(accountId: string) {
    await this.db.query(
      `INSERT INTO notifications (account_id, event_code, title, body, link_url)
       VALUES ($1, 'LOGIN_LOCKED', '로그인이 잠시 잠겼습니다',
               '비밀번호가 여러 번 틀려 로그인을 잠시 막았습니다. 직접 하신 것이 아니라면 비밀번호를 바꿔 주십시오.', '/login/forgot')`,
      [accountId]).catch(() => undefined);
  }

  async signup(input: {
    email: string; password: string; name: string; visitorKey?: string; agreedTerms?: unknown; jobTitle?: string;
  }) {
    /* v10.31 — 시안 가입 3단계 「영문 · 숫자 · 특수문자 조합 10자 이상」(전: 10자 이상만) */
    assertStrongPassword(input.password);   /* v10.48 — 변경 · 재설정과 같은 규칙(auth-throttle.ts) */
    /* v10.27 (G-188) — 가입 때 약관 동의를 받습니다(시안 가입 4단계 「전체 · 필수 · 선택」).
     *   전에는 DTO 에 agreedTerms 가 있었지만 **서비스가 읽지 않아** 동의 기록이 남지 않았습니다.
     *   agreedTerms 를 보내면: 발행된 필수 약관이 모두 들어 있어야 하고(아니면 422 REQUIRED_TERM),
     *   발행된 약관마다 동의 · 거부를 한 줄씩 남깁니다(선택 항목을 안 고른 것도 「거부」로 남김 — 언제 무엇을 보고 골랐는지가 근거).
     *   보내지 않거나 빈 목록이면 예전처럼 기록 없이 가입됩니다(API 직접 호출 · 기존 시험 15곳이 [] 를 보냄 — 호환).
     *   이 회원은 v_term_not_agreed 에 잡히고, 약관 동의 화면(/terms/agree)에서 필수 약관 동의를 받습니다. */
    let terms: Array<{ code: string; version: string; is_required: boolean }> | null = null;
    let agreed: Set<string> | null = null;
    if (input.agreedTerms !== undefined && input.agreedTerms !== null
        && !(Array.isArray(input.agreedTerms) && input.agreedTerms.length === 0)) {
      if (!Array.isArray(input.agreedTerms) || input.agreedTerms.some((c) => typeof c !== 'string')) {
        throw new PolicyViolation('INVALID_TERMS', '약관 동의 형식이 올바르지 않습니다.');
      }
      agreed = new Set(input.agreedTerms as string[]);
      /* v10.28 (G-218 · D042) — 알림(개인정보 처리 위탁 등)은 동의 항목이 아니라 기록하지 않고, 동의로 보내면 422 NOTICE_ONLY */
      const all = await this.db.query<{ code: string; version: string; is_required: boolean; is_notice: boolean }>(
        /* v10.31 (합침 · D090) — 가입 때는 전체 대상 약관만(파트너 이용약관은 입점한 뒤 그 회원에게 받습니다) */
        `SELECT code, version, is_required, is_notice FROM terms WHERE status = 'PUBLISHED' AND audience = 'ALL' ORDER BY display_order`);
      const notice = [...agreed].filter((c) => all.some((t) => t.code === c && t.is_notice));
      if (notice.length) {
        throw new PolicyViolation('NOTICE_ONLY',
          '알림(개인정보 처리 위탁 안내 등)은 동의를 받는 항목이 아닙니다. 동의 목록에서 빼고 보내 주십시오.');
      }
      terms = all.filter((t) => !t.is_notice);
      const unknown = [...agreed].filter((c) => !terms!.some((t) => t.code === c));
      if (unknown.length) {
        throw new PolicyViolation('NOT_PUBLISHED', `발행되지 않은 약관에는 동의할 수 없습니다: ${unknown.join(', ')}`);
      }
      const missing = terms.filter((t) => t.is_required && !agreed!.has(t.code));
      if (missing.length) {
        throw new PolicyViolation('REQUIRED_TERM', '필수 약관에 모두 동의해 주십시오.');
      }
    }
    return this.db.transaction(async () => {
      const hash = await bcrypt.hash(input.password, 12);
      const [acc] = await this.db.query<{ id: string }>(
        `INSERT INTO accounts (email, password_hash, name, account_type, job_title)
         VALUES ($1,$2,$3,'INDIVIDUAL',$4) RETURNING id`,
        [input.email, hash, input.name, input.jobTitle?.trim() || null],
      );
      await this.db.query(
        `INSERT INTO account_roles (account_id, role) VALUES ($1,'MEMBER')`, [acc.id],
      );
      for (const t of terms ?? []) {
        await this.db.query(
          `INSERT INTO term_agreements (account_id, term_code, term_version, agreed, ip, user_agent)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [acc.id, t.code, t.version, agreed!.has(t.code),
           RequestCtx.get()?.ip ?? null, RequestCtx.get()?.userAgent ?? null]);
      }
      if (input.visitorKey) {
        await this.attribution.link(input.visitorKey, acc.id, 'SIGNUP');
      }
      return this.issue(acc.id);
    });
  }

  /** 로그인 증표 발급. v10.48 — 비밀번호 변경 뒤 새 증표를 주려고 공개합니다(AccountSecurityService). tv = accounts.token_version */
  async issue(accountId: string) {
    const principal = await this.principals.load(accountId);
    if (!principal) throw new Forbidden('ACCOUNT_INACTIVE', '사용할 수 없는 계정입니다.');
    const tv = principal.tokenVersion ?? 0;

    const secret = process.env.JWT_SECRET!;
    const accessToken = jwt.sign(
      {
        sub: principal.accountId,
        roles: principal.roles,
        iv: !!principal.identityVerifiedAt,
        bv: !!principal.businessVerifiedAt,
        sub_active: principal.hasActiveSubscription,
        tv,
      },
      secret,
      { expiresIn: ACCESS_TTL },
    );
    const refreshToken = jwt.sign({ sub: principal.accountId, typ: 'refresh', tv }, secret, {
      expiresIn: `${REFRESH_TTL_DAYS}d`,
    });
    return { accessToken, refreshToken, principal };
  }

  /** access 토큰 검증. refresh 토큰은 여기서 거부합니다 — 14일짜리가 access 로 쓰이면 만료가 무의미해집니다. */
  verify(token: string): { sub: string; tv: number } {
    const payload = this.decode(token);
    if (payload.typ === 'refresh') {
      throw new Forbidden('INVALID_TOKEN', '인증 정보가 유효하지 않습니다.');
    }
    /* v10.48 — 판 번호가 없는 증표(이 판 전에 발급)는 0 으로 봅니다. 계정 판 번호도 처음 0 이라 그대로 통합니다 */
    return { sub: payload.sub, tv: Number(payload.tv ?? 0) };
  }

  /** refresh 토큰으로 재발급. principal 을 DB 에서 다시 조립하므로 정지·만료가 즉시 반영됩니다. */
  async refresh(refreshToken: string) {
    const payload = this.decode(refreshToken);
    if (payload.typ !== 'refresh') {
      throw new Forbidden('INVALID_TOKEN', '인증 정보가 유효하지 않습니다.');
    }
    /* v10.48 — 비밀번호를 바꾸거나 탈퇴하면 판 번호가 올라가 그 전 refresh 증표로는 다시 받지 못합니다 */
    const p = await this.principals.load(payload.sub);
    if (!p || (p.tokenVersion ?? 0) !== Number(payload.tv ?? 0)) {
      throw new Forbidden('INVALID_TOKEN', '인증 정보가 유효하지 않습니다.');
    }
    return this.issue(payload.sub);
  }

  private decode(token: string): { sub: string; typ?: string; tv?: number } {
    try {
      return jwt.verify(token, process.env.JWT_SECRET!) as { sub: string; typ?: string; tv?: number };
    } catch {
      throw new Forbidden('INVALID_TOKEN', '인증 정보가 유효하지 않습니다.');
    }
  }

  /**
   * 약관 한 건 (20261002).
   *
   * 지금 유효한 판이 있으면 그것을, 없으면 **시행 예정인 발행본**을 돌려줍니다.
   * 동의 화면은 시행 예정 약관(예: 마케팅 수신)도 미리 동의받는데, 전문 링크가
   * 유효본만 보는 목록에서 찾느라 404 였습니다(10/2 전 페이지 링크 점검 실측).
   */
  async term(code: string) {
    const [t] = await this.db.query(
      `SELECT code, version, title, body, is_required AS "isRequired", is_notice AS "isNotice",
              effective_from AS "effectiveFrom", (effective_from > now()) AS scheduled
         FROM terms
        WHERE upper(code) = upper($1) AND status = 'PUBLISHED' AND effective_from <> 'infinity'
        ORDER BY (effective_from <= now()) DESC,
                 CASE WHEN effective_from <= now() THEN effective_from END DESC NULLS LAST,
                 effective_from ASC
        LIMIT 1`, [code]);
    if (!t) throw new NotFound('발행된 약관이 아닙니다.');
    /* v10.103 (3-1) — 참고용 번역(효력은 한국어 원문) · 얹었으면 translated: true */
    return this.i18n.overlayOne(t, 'TERM', (r) => `${r.code}@${r.version}`, { title: 'title', body: 'body' }, 'translated');
  }

  /** 유효한 약관만. 버전이 여러 개면 최신 것만 내려갑니다. */
  /**
   * v10.31 — 약관 전체 목록(시안 이용안내 「약관 · 정책」 표 · 약관 전문 탭 10종). 지금 유효한 판 · 시행 예정 발행본 · 폐기된 것까지
   *   상태 글(발행 · 2026-10-01 시행 / 시행 예정 / 폐기)과 함께. 본문은 싣지 않습니다(전문은 /terms/doc/{code}).
   */
  async termsIndex() {
    const rows = await this.db.query<Record<string, any>>(
      `SELECT DISTINCT ON (code) code, version, title, status, is_required AS "isRequired", is_notice AS "isNotice",
              CASE WHEN effective_from = 'infinity' THEN NULL ELSE effective_from END AS "effectiveFrom",
              (effective_from > now() AND status = 'PUBLISHED') AS scheduled
         FROM terms WHERE status IN ('PUBLISHED','ARCHIVED')
        ORDER BY code, (status = 'PUBLISHED' AND effective_from <= now()) DESC, (status = 'PUBLISHED') DESC, effective_from DESC`);
    /* v10.103 (3-1) — 제목만 참고용 번역 */
    return this.i18n.overlay(rows, 'TERM', (r) => `${r.code}@${r.version}`, { title: 'title' }, 'translated');
  }

  async terms() {
    const rows = await this.db.query<Record<string, any>>(
      `SELECT DISTINCT ON (code) code, version, title, body, is_required AS "isRequired", is_notice AS "isNotice"
         FROM terms WHERE effective_from <= now()
        ORDER BY code, effective_from DESC`,
    );
    /* v10.103 (3-1) — 참고용 번역(동의 기록은 code · 판으로 남아 원문 기준) */
    return this.i18n.overlay(rows, 'TERM', (r) => `${r.code}@${r.version}`, { title: 'title', body: 'body' }, 'translated');
  }
}

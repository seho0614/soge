import { Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcryptjs';
import { DatabaseService } from '../../db/database.service';
import { PrincipalService } from './principal.service';
import { Forbidden, PolicyViolation, NotFound } from '../../core/errors';
import { AttributionEngine } from '../../engines/attribution/attribution.engine';
import { RequestCtx } from '../../core/request-context';

const ACCESS_TTL = '15m';
const REFRESH_TTL_DAYS = 14;

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly principals: PrincipalService,
    private readonly attribution: AttributionEngine,
  ) {}

  async login(email: string, password: string, visitorKey?: string) {
    const [acc] = await this.db.query<{ id: string; password_hash: string; status: string }>(
      `SELECT id, password_hash, status FROM accounts WHERE email = $1`,
      [email],
    );
    // 계정 없음과 비밀번호 불일치를 구분하지 않습니다 — 계정 존재 여부가 새면 안 됩니다
    if (!acc || !(await bcrypt.compare(password, acc.password_hash))) {
      throw new Forbidden('INVALID_CREDENTIALS', '이메일 또는 비밀번호가 올바르지 않습니다.');
    }
    if (acc.status !== 'ACTIVE') {
      throw new Forbidden('ACCOUNT_INACTIVE', '사용할 수 없는 계정입니다.');
    }

    // ★ 귀속 연결. 이 호출이 빠지면 비로그인 유입이 전부 유실됩니다
    if (visitorKey) {
      await this.attribution.link(visitorKey, acc.id, 'LOGIN');
    }

    await this.db.query(`UPDATE accounts SET last_login_at = now() WHERE id = $1`, [acc.id]);
    return this.issue(acc.id);
  }

  async signup(input: {
    email: string; password: string; name: string; visitorKey?: string; agreedTerms?: unknown; jobTitle?: string;
  }) {
    /* v10.31 — 시안 가입 3단계 「영문 · 숫자 · 특수문자 조합 10자 이상」(전: 10자 이상만) */
    if (input.password.length < 10 || !/[A-Za-z]/.test(input.password) || !/[0-9]/.test(input.password)
        || !/[^A-Za-z0-9]/.test(input.password)) {
      throw new PolicyViolation('WEAK_PASSWORD', '비밀번호는 영문 · 숫자 · 특수문자를 섞어 10자 이상이어야 합니다.');
    }
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

  private async issue(accountId: string) {
    const principal = await this.principals.load(accountId);
    if (!principal) throw new Forbidden('ACCOUNT_INACTIVE', '사용할 수 없는 계정입니다.');

    const secret = process.env.JWT_SECRET!;
    const accessToken = jwt.sign(
      {
        sub: principal.accountId,
        roles: principal.roles,
        iv: !!principal.identityVerifiedAt,
        bv: !!principal.businessVerifiedAt,
        sub_active: principal.hasActiveSubscription,
      },
      secret,
      { expiresIn: ACCESS_TTL },
    );
    const refreshToken = jwt.sign({ sub: principal.accountId, typ: 'refresh' }, secret, {
      expiresIn: `${REFRESH_TTL_DAYS}d`,
    });
    return { accessToken, refreshToken, principal };
  }

  /** access 토큰 검증. refresh 토큰은 여기서 거부합니다 — 14일짜리가 access 로 쓰이면 만료가 무의미해집니다. */
  verify(token: string): { sub: string } {
    const payload = this.decode(token);
    if (payload.typ === 'refresh') {
      throw new Forbidden('INVALID_TOKEN', '인증 정보가 유효하지 않습니다.');
    }
    return { sub: payload.sub };
  }

  /** refresh 토큰으로 재발급. principal 을 DB 에서 다시 조립하므로 정지·만료가 즉시 반영됩니다. */
  async refresh(refreshToken: string) {
    const payload = this.decode(refreshToken);
    if (payload.typ !== 'refresh') {
      throw new Forbidden('INVALID_TOKEN', '인증 정보가 유효하지 않습니다.');
    }
    return this.issue(payload.sub);
  }

  private decode(token: string): { sub: string; typ?: string } {
    try {
      return jwt.verify(token, process.env.JWT_SECRET!) as { sub: string; typ?: string };
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
    return t;
  }

  /** 유효한 약관만. 버전이 여러 개면 최신 것만 내려갑니다. */
  /**
   * v10.31 — 약관 전체 목록(시안 이용안내 「약관 · 정책」 표 · 약관 전문 탭 10종). 지금 유효한 판 · 시행 예정 발행본 · 폐기된 것까지
   *   상태 글(발행 · 2026-10-01 시행 / 시행 예정 / 폐기)과 함께. 본문은 싣지 않습니다(전문은 /terms/doc/{code}).
   */
  async termsIndex() {
    return this.db.query(
      `SELECT DISTINCT ON (code) code, version, title, status, is_required AS "isRequired", is_notice AS "isNotice",
              CASE WHEN effective_from = 'infinity' THEN NULL ELSE effective_from END AS "effectiveFrom",
              (effective_from > now() AND status = 'PUBLISHED') AS scheduled
         FROM terms WHERE status IN ('PUBLISHED','ARCHIVED')
        ORDER BY code, (status = 'PUBLISHED' AND effective_from <= now()) DESC, (status = 'PUBLISHED') DESC, effective_from DESC`);
  }

  async terms() {
    return this.db.query(
      `SELECT DISTINCT ON (code) code, version, title, body, is_required AS "isRequired", is_notice AS "isNotice"
         FROM terms WHERE effective_from <= now()
        ORDER BY code, effective_from DESC`,
    );
  }
}

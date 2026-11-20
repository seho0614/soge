import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { DatabaseService } from '../../db/database.service';
import { AppError, Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { AttributionEngine } from '../../engines/attribution/attribution.engine';
import { maskMail } from '../../common/mail/mail-admin.service';
import { AuthService } from '../identity/auth.service';
import { RecommendService } from '../affiliate/recommend.service';
import { AccountLocked, TooManyAttempts, assertStrongPassword, clientIpKey, minutesText } from '../identity/auth-throttle';
import { assertSignupAllowed } from '../identity/signup-block';
import { clientIpRaw, isInternalIp, settingInt } from '../identity/abuse-guard';
import { isStaff } from '../identity/staff-policy';
import { notifyNewDevice, recordLogin } from '../identity/login-history';
import {
  SOC_PROVIDERS, SOC_REDIRECT_RE, SocProfile, SocProvider, SocResult, assumeProfile, authorizeUrl, b64url, exchangeAndFetch, isProd, sha, socReady, subjectHash,
} from './social.provider';

/* ---------------------------------------------------------------------
 * v10.498 (D272 · docs/636) 카카오 · 네이버 간편 로그인 — 대표 11/20 「㊷ ②」
 *
 *   흐름(사용자 웹 서버가 사이에서 부름 · 브라우저는 API 를 직접 부르지 않음)
 *     ① 시작   POST /auth/social/{p}/start(로그인) · POST /me/social/{p}/start(로그인한 회원의 연결)
 *              사용자 웹이 만든 이 브라우저 묶음 값(binding · httpOnly 쿠키)의 지문 · state 지문 · PKCE verifier 를 soc_states 에(10분 · 한 번)
 *     ② 돌아옴 POST /auth/social/{p}/callback — state · 묶음 · redirectUri 가 모두 맞아야(아니면 409 SOCIAL_STATE_INVALID · 어느 것이 틀렸는지 말하지 않음)
 *              연결된 업체 회원 → 로그인(LOGIN) / 연결 시작이었으면 연결(LINKED) / 처음 온 회원 → 이어서 표(PENDING · 15분)
 *     ③ 이어서 POST /auth/social/pending/view · /pending/link(확인된 같은 이메일 계정 + 그 계정 비밀번호) · /pending/signup(새로 가입 · 필수 약관)
 *   지키는 것
 *     · 저절로 합치지 않음 — 같은 이메일 계정이 있어도 업체가 「확인된 이메일」이라 하고, 회원이 그 계정 비밀번호로 확인해야 연결.
 *       확인 안 된 이메일이 겹치면 가입도 연결도 막음(409 DUPLICATE — 비밀번호로 로그인한 뒤 내 정보에서 연결).
 *     · 운영 역할 계정은 간편 로그인 · 연결 불가(SOCIAL_STAFF_NOT_ALLOWED — 운영자는 비밀번호 + 2단계 인증 + 허용 IP).
 *     · 본인인증(NICE)은 그대로 — 간편 가입 회원도 본인인증 전에는 지금과 같은 화면 · 기능 제한(principal.iv).
 *     · 가입 차단(signup.open · 가입 차단 목록 · 같은 IP 하루 상한) · 필수 약관 동의 · 추천 코드는 이메일 가입과 같은 규칙.
 *     · 이메일 가입 계정과 같은 로그인 기록 · 낯선 기기 알림 · 로그인 기기(세션) · 방문자 키 연결(AuthService.issue).
 *     · 간편 가입 계정은 비밀번호가 없음(password_hash '') — 「비밀번호 만들기」(POST /me/social/password) 뒤 탈퇴 · 모든 기기 로그아웃 등 비밀번호 확인 기능을 씀.
 *       비밀번호가 없는데 마지막 연결을 끊으려 하면 422 SOCIAL_LAST_METHOD.
 *   스위치 social.kakao · social.naver 처음 off · social.mode 처음 ASSUME(운영 서버에서는 간주 로그인 막음) · LIVE 는 키 + social.privacy_ok.
 * ------------------------------------------------------------------- */

const STATE_MIN = 10;
const PENDING_MIN = 15;
const LINK_TRIES = 5;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[A-Za-z]{2,24}$/;
const NAME_RE = /^[^\u0000-\u001f<>]{1,40}$/;
/* 운영 역할 — staff-policy 의 OPS_ROLES 와 같은 목록(같은 이메일 연결 후보에서 뺌 · 로그인 · 연결은 isStaff 로 막음) */
const STAFF_ROLES = ['REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER', 'PARTNER_MAL', 'PARTNER_AFF', 'ACCOUNTANT'];

export interface SocSettings { kakao: boolean; naver: boolean; mode: 'ASSUME' | 'LIVE'; privacyOk: boolean }

export function providerOf(path: string): SocProvider {
  const p = String(path ?? '').toUpperCase();
  if (!(SOC_PROVIDERS as string[]).includes(p)) throw new NotFound('없는 간편 로그인 업체입니다.');
  return p as SocProvider;
}

export async function socSettings(db: DatabaseService): Promise<SocSettings> {
  const rows = await db.query<{ key: string; value: string | null }>(
    `SELECT key, value FROM site_settings WHERE key IN ('social.kakao', 'social.naver', 'social.mode', 'social.privacy_ok')`);
  const v = (k: string) => (rows.find((r) => r.key === k)?.value ?? '').trim().toLowerCase();
  return { kakao: v('social.kakao') === 'on', naver: v('social.naver') === 'on', mode: v('social.mode') === 'live' ? 'LIVE' : 'ASSUME', privacyOk: v('social.privacy_ok') === 'on' };
}
const enabledOf = (s: SocSettings, p: SocProvider) => (p === 'KAKAO' ? s.kakao : s.naver);

@Injectable()
export class SocialAuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auth: AuthService,
    private readonly recommend: RecommendService,
    private readonly attribution: AttributionEngine,
  ) {}

  private async event(p: SocProvider, kind: 'LOGIN' | 'SIGNUP' | 'LINK' | 'UNLINK' | 'FAIL', accountId: string | null, reason: string | null, assumed: boolean) {
    await this.db.query(`INSERT INTO soc_events (provider, kind, account_id, reason, assumed) VALUES ($1, $2, $3, $4, $5)`,
      [p, kind, accountId, reason, assumed]).catch(() => undefined);
  }

  /** 켜진 업체 — 사용자 웹 로그인 화면 단추. 운영 서버에서 간주면 단추를 내지 않음 */
  async providers() {
    const s = await socSettings(this.db);
    const usable = !(s.mode === 'ASSUME' && isProd());
    return { mode: s.mode, items: SOC_PROVIDERS.filter((p) => usable && enabledOf(s, p)).map((p) => ({ provider: p, path: p.toLowerCase() })) };
  }

  /* ── ① 시작 ─────────────────────────────────────────────────── */
  async start(p: SocProvider, d: { redirectUri: string; binding: string }, linkAccountId: string | null) {
    const s = await socSettings(this.db);
    if (!enabledOf(s, p)) throw new PolicyViolation('SOCIAL_OFF', '이 간편 로그인은 지금 쓸 수 없습니다.');
    if (s.mode === 'ASSUME' && isProd()) throw new PolicyViolation('SOCIAL_ASSUME_PROD', '간편 로그인이 아직 준비 중입니다.');
    if (!SOC_REDIRECT_RE.test(d.redirectUri) || !d.redirectUri.includes(`/login/social/${p.toLowerCase()}/callback`)) {
      throw new PolicyViolation('SOCIAL_REDIRECT', '돌아올 주소가 맞지 않습니다.');
    }
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(d.binding)) throw new PolicyViolation('SOCIAL_BINDING', '브라우저 확인 값이 맞지 않습니다.');
    if (linkAccountId) await this.assertNotStaff(linkAccountId);
    const state = b64url(32), verifier = b64url(48);
    const url = s.mode === 'ASSUME'
      ? `${d.redirectUri}?${new URLSearchParams({ code: `ASSUME.${b64url(9).toLowerCase().replace(/[^a-z0-9]/g, '').padEnd(6, 'x').slice(0, 12)}`, state }).toString()}`
      : await authorizeUrl(this.db, p, { state, verifier, redirectUri: d.redirectUri });
    if (!url) throw new PolicyViolation('SOCIAL_NOT_READY', '간편 로그인 키가 아직 없습니다.');
    await this.db.query(
      `INSERT INTO soc_states (state_hash, binding_hash, provider, mode, account_id, verifier, redirect_uri, assumed)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [sha(state), sha(d.binding), p, linkAccountId ? 'LINK' : 'LOGIN', linkAccountId, verifier, d.redirectUri, s.mode === 'ASSUME']);
    return { authorizeUrl: url, mode: s.mode, expiresInSec: STATE_MIN * 60 };
  }

  /* ── ② 돌아옴 ───────────────────────────────────────────────── */
  async callback(p: SocProvider, d: { code: string; state: string; binding: string; redirectUri: string; visitorKey?: string }) {
    const st = await this.db.transaction(async () => {
      const [r] = await this.db.query<{ id: string; binding_hash: string; provider: string; mode: string; account_id: string | null; verifier: string; redirect_uri: string; assumed: boolean; fresh: boolean; used: boolean }>(
        `SELECT id::text AS id, binding_hash, provider, mode, account_id, verifier, redirect_uri, assumed,
                created_at > now() - make_interval(mins => $2::int) AS fresh, used_at IS NOT NULL AS used
           FROM soc_states WHERE state_hash = $1 FOR UPDATE`, [sha(String(d.state ?? '')), STATE_MIN]);
      if (r && !r.used) await this.db.query(`UPDATE soc_states SET used_at = now() WHERE id = $1::bigint`, [r.id]);   // 맞든 틀리든 한 번만
      return r;
    });
    if (!st || st.used || !st.fresh || st.provider !== p || st.binding_hash !== sha(String(d.binding ?? '')) || st.redirect_uri !== d.redirectUri) {
      await this.event(p, 'FAIL', null, 'SOCIAL_STATE_INVALID', !!st?.assumed);
      throw new StateConflict('SOCIAL_STATE_INVALID', '로그인 요청이 오래되었거나 다른 브라우저에서 시작되었습니다. 처음부터 다시 해 주십시오.');
    }
    const s = await socSettings(this.db);
    if (!enabledOf(s, p)) throw new PolicyViolation('SOCIAL_OFF', '이 간편 로그인은 지금 쓸 수 없습니다.');
    let r: SocResult;
    if (st.assumed) {
      if (s.mode !== 'ASSUME' || isProd()) throw new StateConflict('SOCIAL_STATE_INVALID', '로그인 요청이 오래되었거나 다른 브라우저에서 시작되었습니다. 처음부터 다시 해 주십시오.');
      r = assumeProfile(d.code);
    } else {
      if (String(d.code ?? '').startsWith('ASSUME.')) throw new StateConflict('SOCIAL_STATE_INVALID', '로그인 요청이 오래되었거나 다른 브라우저에서 시작되었습니다. 처음부터 다시 해 주십시오.');
      r = await exchangeAndFetch(this.db, p, { code: d.code, state: d.state, verifier: st.verifier, redirectUri: st.redirect_uri });
    }
    if (!r.ok) {
      await this.event(p, 'FAIL', st.account_id, r.code, st.assumed);
      throw new AppError(502, { code: r.code, message: '간편 로그인 업체에서 회원 정보를 받지 못했습니다. 잠시 뒤 다시 해 주십시오.' });
    }
    const prof: SocProfile = r.profile;
    const sh = subjectHash(p, prof.id);
    const [link] = await this.db.query<{ account_id: string }>(`SELECT account_id FROM soc_links WHERE provider = $1 AND subject_hash = $2`, [p, sh]);

    if (st.mode === 'LINK' && st.account_id) {
      if (link && link.account_id !== st.account_id) {
        await this.event(p, 'FAIL', st.account_id, 'SOCIAL_LINKED_OTHER', st.assumed);
        throw new StateConflict('SOCIAL_LINKED_OTHER', '이 간편 로그인 계정은 이미 다른 소개뱅크 계정에 연결되어 있습니다.');
      }
      if (link) return { result: 'LINKED', already: true };
      await this.assertNotStaff(st.account_id);
      await this.insertLink(st.account_id, p, sh, prof.email, st.assumed);
      await this.event(p, 'LINK', st.account_id, null, st.assumed);
      return { result: 'LINKED', already: false };
    }

    if (link) {
      const tokens = await this.loginAs(link.account_id, p, st.assumed, d.visitorKey);
      await this.db.query(`UPDATE soc_links SET last_login_at = now() WHERE provider = $1 AND subject_hash = $2`, [p, sh]);
      return { result: 'LOGIN', ...tokens };
    }

    /* 처음 온 업체 회원 — 이어서 표(저절로 합치지 않음) */
    const ticket = b64url(32);
    await this.db.query(
      `INSERT INTO soc_pending (ticket_hash, provider, subject_hash, email, email_verified, name_hint, assumed) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [sha(ticket), p, sh, prof.email && EMAIL_RE.test(prof.email) ? prof.email : null, prof.emailVerified, prof.name && NAME_RE.test(prof.name) ? prof.name : null, st.assumed]);
    const v = await this.pendingView(ticket);
    return { result: 'PENDING', ticket, ...v };
  }

  /* ── ③ 이어서 ───────────────────────────────────────────────── */
  private async pendingRow(ticket: string) {
    const [r] = await this.db.query<{ id: string; provider: SocProvider; subject_hash: string; email: string | null; email_verified: boolean; name_hint: string | null; assumed: boolean; link_tries: number; expires: Date; ok: boolean }>(
      `SELECT id::text AS id, provider, subject_hash, email, email_verified, name_hint, assumed, link_tries,
              created_at + make_interval(mins => $2::int) AS expires,
              used_at IS NULL AND created_at > now() - make_interval(mins => $2::int) AND link_tries < $3::int AS ok
         FROM soc_pending WHERE ticket_hash = $1`, [sha(String(ticket ?? '')), PENDING_MIN, LINK_TRIES]);
    if (!r || !r.ok) throw new StateConflict('SOCIAL_TICKET_INVALID', '간편 로그인 이어서 하기 시간이 지났습니다. 처음부터 다시 해 주십시오.');
    return r;
  }

  /** 같은 이메일 계정 — 확인된 이메일 · 활동 중 · 운영 역할 아님 · 비밀번호 있음 일 때만 연결 후보 */
  private async matchAccount(email: string | null, verified: boolean): Promise<{ id: string; exists: boolean } | null> {
    if (!email) return null;
    const [a] = await this.db.query<{ id: string; ok: boolean }>(
      `SELECT a.id, (a.status = 'ACTIVE' AND coalesce(a.password_hash, '') <> ''
                     AND NOT EXISTS (SELECT 1 FROM account_roles r WHERE r.account_id = a.id AND r.role = ANY($2::text[]))) AS ok
         FROM accounts a WHERE a.email = $1`, [email, STAFF_ROLES]);
    if (!a) return null;
    return { id: a.id, exists: verified && a.ok };
  }

  async pendingView(ticket: string) {
    const r = await this.pendingRow(ticket);
    const m = await this.matchAccount(r.email, r.email_verified);
    return {
      provider: r.provider, emailMasked: maskMail(r.email), emailVerified: r.email_verified, needEmail: !r.email,
      emailMatch: !!m?.exists, emailTaken: !!m && !m.exists, nameHint: r.name_hint, expiresAt: r.expires,
    };
  }

  async pendingLink(ticket: string, password: string, visitorKey?: string) {
    const r = await this.pendingRow(ticket);
    const m = await this.matchAccount(r.email, r.email_verified);
    if (!m?.exists || !r.email) throw new PolicyViolation('SOCIAL_NO_MATCH', '연결할 수 있는 같은 이메일 계정이 없습니다 — 새로 가입하거나, 비밀번호로 로그인한 뒤 내 정보에서 연결해 주십시오.');
    /* 이메일 로그인과 같은 잠금 · 횟수 제한(fn_login_gate) */
    const ipKey = clientIpKey();
    const [gate] = await this.db.query<{ blocked: string | null; retry_after_sec: number }>(`SELECT blocked, retry_after_sec FROM fn_login_gate($1, $2)`, [r.email, ipKey]);
    if (gate?.blocked === 'LOCKED') throw new AccountLocked(gate.retry_after_sec);
    if (gate?.blocked === 'TOO_MANY') throw new TooManyAttempts('TOO_MANY_ATTEMPTS', `로그인 실패가 많아 잠시 막았습니다. ${minutesText(gate.retry_after_sec)} 뒤에 다시 시도해 주십시오.`, gate.retry_after_sec);
    const [acc] = await this.db.query<{ password_hash: string }>(`SELECT password_hash FROM accounts WHERE id = $1`, [m.id]);
    if (!acc?.password_hash || !(await bcrypt.compare(String(password ?? ''), acc.password_hash))) {
      await this.db.query(`UPDATE soc_pending SET link_tries = least(link_tries + 1, 10) WHERE id = $1::bigint`, [r.id]);
      await this.db.query(`SELECT fails FROM fn_login_fail($1, $2)`, [r.email, ipKey]).catch(() => undefined);
      await recordLogin(this.db, m.id, false);
      await this.event(r.provider, 'FAIL', m.id, 'INVALID_CREDENTIALS', r.assumed);
      throw new AppError(403, { code: 'INVALID_CREDENTIALS', message: '비밀번호가 올바르지 않습니다.', details: { attemptsLeft: Math.max(0, LINK_TRIES - r.link_tries - 1) } });
    }
    await this.db.query(`SELECT fn_login_clear($1)`, [r.email]);
    await this.db.transaction(async () => {
      await this.consume(r.id);
      await this.insertLink(m.id, r.provider, r.subject_hash, r.email!, r.assumed);
    });
    await this.event(r.provider, 'LINK', m.id, null, r.assumed);
    const tokens = await this.loginAs(m.id, r.provider, r.assumed, visitorKey);
    return { result: 'LOGIN', linked: true, ...tokens };
  }

  async pendingSignup(ticket: string, d: { name: string; email?: string; agreedTerms: string[]; recommendCode?: string; visitorKey?: string }) {
    const r = await this.pendingRow(ticket);
    const email = (r.email ?? String(d.email ?? '').trim().toLowerCase()) || '';
    if (!EMAIL_RE.test(email)) throw new PolicyViolation('SOCIAL_EMAIL', '이메일 주소를 확인해 주십시오.');
    const name = String(d.name ?? '').replace(/\s+/g, ' ').trim();
    if (!NAME_RE.test(name)) throw new PolicyViolation('SOCIAL_NAME', '이름은 1 ~ 40자입니다.');
    const [dup] = await this.db.query<{ id: string }>(`SELECT id FROM accounts WHERE email = $1`, [email]);
    if (dup) throw new StateConflict('DUPLICATE', '이미 가입된 이메일입니다 — 그 계정에 연결하려면 비밀번호로 로그인한 뒤 내 정보 › 간편 로그인에서 연결해 주십시오.');
    /* 이메일 가입과 같은 문(AuthService.signup) — 가입 잠시 막기 · 가입 차단 목록 · 같은 IP 하루 상한 */
    const [gate] = await this.db.query<{ open: string }>(`SELECT coalesce((SELECT value FROM site_settings WHERE key = 'signup.open'), 'on') AS open`);
    if (gate?.open === 'off') throw new PolicyViolation('SIGNUP_CLOSED', '지금은 새 가입을 잠시 받지 않습니다. 잠시 뒤 다시 시도해 주십시오.');
    await assertSignupAllowed(this.db, email, clientIpRaw());
    const ipKey = isInternalIp(clientIpRaw()) ? null : clientIpKey();
    const ipMax = ipKey ? await settingInt(this.db, 'abuse.signup_per_ip_day', 20) : 0;
    if (ipKey && ipMax > 0) {
      const [h] = await this.db.query<{ hits: number }>(`SELECT hits FROM auth_throttle WHERE key_kind = 'SIGNUP_IP' AND key_hash = $1`, [ipKey]);
      if ((h?.hits ?? 0) >= ipMax) throw new TooManyAttempts('SIGNUP_IP_LIMIT', '같은 곳에서 오늘 가입이 너무 많습니다. 내일 다시 시도해 주십시오.');
    }
    /* 필수 약관 — 간편 가입은 동의 목록을 꼭 보냄(빈 목록 호환 없음) */
    const agreed = new Set((Array.isArray(d.agreedTerms) ? d.agreedTerms : []).map(String));
    const all = await this.db.query<{ code: string; version: string; is_required: boolean; is_notice: boolean }>(
      `SELECT code, version, is_required, is_notice FROM v_terms_current WHERE audience = 'ALL' ORDER BY display_order`);
    if ([...agreed].some((c) => all.some((t) => t.code === c && t.is_notice))) {
      throw new PolicyViolation('NOTICE_ONLY', '알림(개인정보 처리 위탁 안내 등)은 동의를 받는 항목이 아닙니다. 동의 목록에서 빼고 보내 주십시오.');
    }
    const terms = all.filter((t) => !t.is_notice);
    const unknown = [...agreed].filter((c) => !terms.some((t) => t.code === c));
    if (unknown.length) throw new PolicyViolation('NOT_PUBLISHED', `발행되지 않은 약관에는 동의할 수 없습니다: ${unknown.join(', ')}`);
    if (terms.some((t) => t.is_required && !agreed.has(t.code))) throw new PolicyViolation('REQUIRED_TERM', '필수 약관에 모두 동의해 주십시오.');
    let recommender: string | null = null;
    if (typeof d.recommendCode === 'string' && d.recommendCode.trim() !== '') {
      const code = RecommendService.normalize(d.recommendCode);
      const owner = code ? await this.recommend.ownerOf(code) : null;
      if (!owner) throw new PolicyViolation('RECOMMEND_CODE_UNKNOWN', '없는 추천 코드입니다. 코드를 다시 확인해 주십시오.');
      recommender = owner.id;
    }
    const accountId = await this.db.transaction(async () => {
      await this.consume(r.id);
      const [acc] = await this.db.query<{ id: string }>(
        `INSERT INTO accounts (email, password_hash, name, account_type) VALUES ($1, '', $2, 'INDIVIDUAL') RETURNING id`, [email, name]);
      await this.db.query(`INSERT INTO account_roles (account_id, role) VALUES ($1, 'MEMBER')`, [acc.id]);
      if (ipKey && ipMax > 0) {
        await this.db.query(
          `INSERT INTO auth_throttle AS t (key_kind, key_hash, window_start, hits, last_at) VALUES ('SIGNUP_IP', $1, now(), 1, now())
           ON CONFLICT (key_kind, key_hash) DO UPDATE SET hits = t.hits + 1, last_at = now()`, [ipKey]);
      }
      for (const t of terms) {
        await this.db.query(
          `INSERT INTO term_agreements (account_id, term_code, term_version, agreed, ip, user_agent) VALUES ($1, $2, $3, $4, $5, $6)`,
          [acc.id, t.code, t.version, agreed.has(t.code), RequestCtx.get()?.ip ?? null, RequestCtx.get()?.userAgent ?? null]);
      }
      if (recommender) await this.db.query(`INSERT INTO introducer_referrals (inviter_id, invitee_id) VALUES ($1, $2)`, [recommender, acc.id]);
      await this.insertLink(acc.id, r.provider, r.subject_hash, email, r.assumed);
      if (d.visitorKey) await this.attribution.link(d.visitorKey, acc.id, 'SIGNUP');
      return acc.id;
    });
    await this.event(r.provider, 'SIGNUP', accountId, null, r.assumed);
    const tokens = await this.auth.issue(accountId);
    await recordLogin(this.db, accountId, true);
    return { result: 'SIGNUP', ...tokens };
  }

  /* ── 내 정보 › 간편 로그인 ─────────────────────────────────────── */
  async mine(accountId: string) {
    const [links, acc, prov] = await Promise.all([
      this.db.query(`SELECT provider, email_masked AS "emailMasked", linked_at AS "linkedAt", last_login_at AS "lastLoginAt", assumed FROM soc_links WHERE account_id = $1 ORDER BY provider`, [accountId]),
      this.db.query<{ has: boolean }>(`SELECT coalesce(password_hash, '') <> '' AS has FROM accounts WHERE id = $1`, [accountId]),
      this.providers(),
    ]);
    return { links, hasPassword: !!acc[0]?.has, providers: prov.items, mode: prov.mode };
  }

  async unlink(accountId: string, p: SocProvider) {
    const m = await this.mine(accountId);
    if (!m.links.some((x: any) => x.provider === p)) throw new NotFound('연결되어 있지 않습니다.');
    if (!m.hasPassword && m.links.length <= 1) {
      throw new PolicyViolation('SOCIAL_LAST_METHOD', '로그인할 다른 방법이 없습니다 — 먼저 비밀번호를 만들거나 다른 간편 로그인을 연결해 주십시오.');
    }
    await this.db.query(`DELETE FROM soc_links WHERE account_id = $1 AND provider = $2`, [accountId, p]);
    await this.event(p, 'UNLINK', accountId, null, false);
    return { ok: true, note: '연결을 끊었습니다. 카카오 · 네이버 쪽 「연결된 서비스」에서도 소개뱅크를 지울 수 있습니다.' };
  }

  /** 간편 가입 계정의 첫 비밀번호(비밀번호가 없을 때만 · 로그인한 본인) */
  async createPassword(accountId: string, password: string) {
    const [a] = await this.db.query<{ has: boolean }>(`SELECT coalesce(password_hash, '') <> '' AS has FROM accounts WHERE id = $1`, [accountId]);
    if (!a) throw new NotFound('계정을 찾을 수 없습니다.');
    if (a.has) throw new StateConflict('PASSWORD_EXISTS', '이미 비밀번호가 있습니다 — 비밀번호 바꾸기를 써 주십시오.');
    assertStrongPassword(password);
    const hash = await bcrypt.hash(password, 12);
    await this.db.query(`UPDATE accounts SET password_hash = $2 WHERE id = $1 AND coalesce(password_hash, '') = ''`, [accountId, hash]);
    return { ok: true, note: '비밀번호를 만들었습니다 — 이제 이메일 · 비밀번호로도 로그인할 수 있습니다.' };
  }

  /* ── 운영 화면(회원 › 간편 로그인 · SB-ADM-UPT-020) ───────────────── */
  async adminView() {
    const [s, ready, links, ev] = await Promise.all([
      socSettings(this.db), socReady(this.db),
      this.db.query(`SELECT provider, count(*)::int AS n, count(*) FILTER (WHERE assumed)::int AS assumed FROM soc_links GROUP BY provider ORDER BY provider`),
      this.db.query(`SELECT provider, kind, count(*)::int AS n FROM soc_events WHERE at > now() - interval '30 days' GROUP BY provider, kind ORDER BY provider, kind`),
    ]);
    const fails = await this.db.query(`SELECT provider, reason, count(*)::int AS n FROM soc_events WHERE kind = 'FAIL' AND at > now() - interval '7 days' GROUP BY provider, reason ORDER BY n DESC LIMIT 10`);
    return { settings: s, ready, prod: isProd(), links, events30: ev, fails7: fails, canEdit: RequestCtx.get()?.actorRole === 'SUPER' };
  }

  async setSettings(d: { kakao?: boolean; naver?: boolean; mode?: string; privacyOk?: boolean; reason: string }) {
    const reason = String(d.reason ?? '').replace(/\s+/g, ' ').trim();
    if (reason.length < 2 || reason.length > 200) throw new PolicyViolation('SOCIAL_REASON', '사유는 2 ~ 200자입니다.');
    const cur = await socSettings(this.db);
    const next: SocSettings = {
      kakao: d.kakao ?? cur.kakao, naver: d.naver ?? cur.naver, privacyOk: d.privacyOk ?? cur.privacyOk,
      mode: d.mode === undefined ? cur.mode : d.mode === 'LIVE' ? 'LIVE' : d.mode === 'ASSUME' ? 'ASSUME' : (() => { throw new PolicyViolation('SOCIAL_MODE', '방식은 ASSUME · LIVE 중 하나입니다.'); })(),
    };
    if (next.mode === 'LIVE' && (next.kakao || next.naver)) {
      if (!next.privacyOk) throw new PolicyViolation('SOCIAL_PRIVACY_FIRST', '개인정보처리방침에 간편 로그인 항목을 게시하고 법무 확인을 마친 뒤(처리방침 확인 켜기) 켭니다.');
      const ready = await socReady(this.db);
      if (next.kakao && !ready.KAKAO.ready) throw new PolicyViolation('SOCIAL_NOT_READY', '카카오 client_id 가 없습니다 — 외부 연동 › 연동 키(KAKAO_LOGIN_CLIENT_ID) 또는 카카오맵 REST 키를 넣으십시오.');
      if (next.naver && !ready.NAVER.ready) throw new PolicyViolation('SOCIAL_NOT_READY', '네이버 키가 없습니다 — 외부 연동 › 연동 키(NAVER_CLIENT_ID · NAVER_CLIENT_SECRET)를 넣으십시오.');
    }
    if (next.mode === 'ASSUME' && isProd() && (next.kakao || next.naver)) {
      throw new PolicyViolation('SOCIAL_ASSUME_PROD', '운영 서버에서는 간주(ASSUME)로 켤 수 없습니다 — LIVE 로 바꾼 뒤 켜십시오.');
    }
    const set: Array<[string, string]> = [];
    if (d.kakao !== undefined) set.push(['social.kakao', d.kakao ? 'on' : 'off']);
    if (d.naver !== undefined) set.push(['social.naver', d.naver ? 'on' : 'off']);
    if (d.mode !== undefined) set.push(['social.mode', next.mode]);
    if (d.privacyOk !== undefined) set.push(['social.privacy_ok', d.privacyOk ? 'on' : 'off']);
    if (!set.length) throw new PolicyViolation('SOCIAL_NOTHING', '바꿀 것이 없습니다.');
    const me = RequestCtx.actorId() ?? null;
    await this.db.transaction(async () => {
      await this.db.query(`SELECT set_config('app.setting_reason', $1, true)`, [reason]);
      for (const [k, v] of set) await this.db.query(`UPDATE site_settings SET value = $2, updated_by = $3, updated_at = now() WHERE key = $1`, [k, v, me]);
    });
    return { ok: true, settings: await socSettings(this.db) };
  }

  /* ── 안쪽 ───────────────────────────────────────────────────── */
  private async assertNotStaff(accountId: string) {
    const roles = await this.db.query<{ role: string }>(`SELECT role FROM account_roles WHERE account_id = $1`, [accountId]);
    if (isStaff(roles.map((x) => x.role))) {
      throw new Forbidden('SOCIAL_STAFF_NOT_ALLOWED', '운영 역할이 있는 계정은 간편 로그인을 쓸 수 없습니다 — 이메일 · 비밀번호와 2단계 인증으로 로그인해 주십시오.');
    }
  }

  private async insertLink(accountId: string, p: SocProvider, sh: string, email: string | null, assumed: boolean) {
    const [taken] = await this.db.query<{ x: number }>(`SELECT 1 AS x FROM soc_links WHERE account_id = $1 AND provider = $2`, [accountId, p]);
    if (taken) throw new StateConflict('SOCIAL_PROVIDER_TAKEN', '이 계정에는 이미 같은 업체의 다른 간편 로그인이 연결되어 있습니다 — 먼저 끊어 주십시오.');
    await this.db.query(
      `INSERT INTO soc_links (account_id, provider, subject_hash, email_masked, assumed) VALUES ($1, $2, $3, $4, $5)`,
      [accountId, p, sh, maskMail(email), assumed]);
  }

  private async consume(pendingId: string) {
    const r = await this.db.query(`UPDATE soc_pending SET used_at = now(), email = NULL WHERE id = $1::bigint AND used_at IS NULL RETURNING id`, [pendingId]);
    if (!r.length) throw new StateConflict('SOCIAL_TICKET_INVALID', '간편 로그인 이어서 하기 시간이 지났습니다. 처음부터 다시 해 주십시오.');
  }

  /** 연결된 계정으로 로그인 — 이메일 로그인과 같은 검사(활동 중 · 탈퇴 유예 · 운영 역할 막음) · 같은 기록 */
  private async loginAs(accountId: string, p: SocProvider, assumed: boolean, visitorKey?: string) {
    const [acc] = await this.db.query<{ status: string; grace: boolean }>(
      `SELECT status, (status = 'WITHDRAWN' AND withdrawn_at IS NOT NULL AND purged_at IS NULL AND fn_setting_int('member.withdraw_grace_days', 0) > 0
                       AND withdrawn_at > now() - make_interval(days => fn_setting_int('member.withdraw_grace_days', 0))) AS grace
         FROM accounts WHERE id = $1`, [accountId]);
    if (acc?.status === 'WITHDRAWN' && acc.grace) {
      await this.event(p, 'FAIL', accountId, 'WITHDRAW_PENDING', assumed);
      throw new AppError(403, { code: 'WITHDRAW_PENDING', message: '탈퇴 처리 중인 계정입니다 — 이메일 · 비밀번호로 로그인하면 탈퇴를 취소할 수 있습니다.' });
    }
    if (!acc || acc.status !== 'ACTIVE') {
      await this.event(p, 'FAIL', accountId, 'ACCOUNT_INACTIVE', assumed);
      throw new Forbidden('ACCOUNT_INACTIVE', '사용할 수 없는 계정입니다.');
    }
    await this.assertNotStaff(accountId);
    if (visitorKey) await this.attribution.link(visitorKey, accountId, 'LOGIN');
    await this.db.query(`UPDATE accounts SET last_login_at = now() WHERE id = $1`, [accountId]);
    await notifyNewDevice(this.db, accountId);
    await recordLogin(this.db, accountId, true);
    await this.event(p, 'LOGIN', accountId, null, assumed);
    return this.auth.issue(accountId);
  }
}

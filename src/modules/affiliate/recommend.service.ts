import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { PartnerActorService } from '../partner/partner-actor.service';
import { RequestCtx } from '../../core/request-context';
import { Forbidden, NotFound, PolicyViolation } from '../../core/errors';
import { maskEmail, maskName } from '../../common/mask';
import { directRewards, rewardSum, type DirectReward } from './referral-reward';

/** 추천 코드 모양 — 6자 · 0 · O · 1 · I 없음(D189 ck_accounts_recommend_code 와 같음) */
const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;
/** 트리 한 번에 보내는 사람 수 · 내려가는 대 수 — 넘으면 truncated */
const TREE_MAX = 3000;
const TREE_GEN = 30;

type TreeRow = {
  id: string; up: string; gen: number; created_at: Date; name: string; status: string;
  code: string | null; verified: Date | null; withdrawn: Date | null; email: string | null;
};

/** 한국 날짜 YYYY-MM-DD */
const ymd = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);

/**
 * v10.218 (D189 · docs/351) — 회원 추천인 · 추천 관계도.
 *
 * ── 대표 결정 (2026-11-09) ────────────────────────────────────
 *   가입 때 추천 코드(선택) · 코드는 모든 회원 · 바꾸기는 가입 때만(그 뒤 운영자 · 사유)
 *   관계도: 운영자는 전체 · 제휴 파트너(활동 중)는 자기 아래 전체
 *   보상: **직접 추천 1단계만** · 가입한 사람 첫 본인인증 때 한 번 — DB(fn_referral_reward)가 줌 · 처음엔 꺼짐
 *
 * ── 다단계로 보이지 않게 ─────────────────────────────────────
 *   파트너 화면에는 이름 첫 글자 · 가입일(직접 추천) / 가입 월(그 아래)만 — 실적 · 금액 · 연락처 · 회원 번호를 보내지 않습니다.
 *   계층 용어(하위 · 산하 · 직급 · 다운라인)를 쓰지 않습니다.
 */
@Injectable()
export class RecommendService {
  constructor(private readonly db: DatabaseService, private readonly actors: PartnerActorService) {}
  private get me() { return RequestCtx.actorId()!; }

  /** 화면에서 받은 코드 → 대문자 6자 또는 null */
  static normalize(code: unknown): string | null {
    if (typeof code !== 'string') return null;
    const c = code.trim().toUpperCase();
    return CODE_RE.test(c) ? c : null;
  }

  /** 코드 주인(활동 중 회원)의 계정 번호. 없으면 null */
  async ownerOf(code: string): Promise<{ id: string; name: string } | null> {
    const [a] = await this.db.query<{ id: string; name: string }>(
      `SELECT id, name FROM accounts WHERE recommend_code = $1 AND status = 'ACTIVE' AND withdrawn_at IS NULL`, [code]);
    return a ?? null;
  }

  /** 가입 화면 — 코드 확인(가린 이름만) */
  async check(code: string) {
    const c = RecommendService.normalize(code);
    const o = c ? await this.ownerOf(c) : null;
    if (!o) throw new NotFound('없는 추천 코드입니다. 코드를 다시 확인해 주십시오.');
    return { code: c, name: maskName(o.name) };
  }

  /** 나의공간 — 내 코드 · 링크 · 내가 직접 추천한 분 수 · 나를 추천한 분(가린 이름) */
  async mine() {
    const [r] = await this.db.query<{ code: string | null; direct: number; up: string | null; pts: number; is_on: boolean }>(
      `SELECT a.recommend_code AS code,
              (SELECT count(*)::int FROM introducer_referrals WHERE inviter_id = a.id) AS direct,
              (SELECT u.name FROM introducer_referrals r JOIN accounts u ON u.id = r.inviter_id WHERE r.invitee_id = a.id) AS up,
              (SELECT coalesce(sum(points), 0)::int FROM point_ledger WHERE account_id = a.id AND rule_code = 'REFERRAL_DIRECT') AS pts,
              coalesce((SELECT is_active FROM point_rules WHERE code = 'REFERRAL_DIRECT'), false) AS is_on
         FROM accounts a WHERE a.id = $1`, [this.me]);
    if (!r) throw new NotFound();
    return {
      code: r.code, link: r.code ? `/signup?rc=${r.code}` : null, directCount: r.direct,
      recommender: r.up ? maskName(r.up) : null, rewardPoints: r.pts, rewardOn: r.is_on,
    };
  }

  /** 파트너센터 — 활동 중 제휴 파트너 본인 아래 전체(가린 이름 · 날짜만) */
  async partnerTree() {
    if (!(await this.actors.affiliateActiveId(this.me))) {
      throw new Forbidden('AFF_REQUIRED', '활동 중인 제휴 파트너만 볼 수 있습니다.');
    }
    return this.memberTree();
  }

  /** v10.253 (docs/388) — 모든 회원: 나의공간 「추천 관계도」 — 파트너센터와 같은 모양(가린 이름 · 날짜만 · 실적 · 금액 · 연락처 · 회원 번호 없음) */
  async memberTree() {
    const [me] = await this.db.query<{ name: string; code: string | null }>(
      `SELECT name, recommend_code AS code FROM accounts WHERE id = $1`, [this.me]);
    const rows = await this.rows(this.me);
    const { keys, kids, truncated } = this.keyed(rows);
    /* v10.258 (docs/390) — 직접 추천한 분(1번째 줄)에만 「내가 받은 추천 보상」 · 그 아래 줄은 없음 */
    const rw = await directRewards(this.db, this.me);
    const byId = new Map(rw.map((x) => [x.id, x]));
    return {
      root: { name: me?.name ?? '', code: me?.code ?? null },
      total: Math.min(rows.length, TREE_MAX), truncated, generations: this.gens(rows),
      reward: rewardSum(rw),
      nodes: rows.slice(0, TREE_MAX).map((r) => ({
        k: keys.get(r.id)!, p: keys.get(r.up) ?? 0, gen: r.gen,
        name: r.withdrawn ? null : maskName(r.name),
        joined: r.gen === 1 ? ymd(r.created_at) : ymd(r.created_at).slice(0, 7),
        children: kids.get(r.id) ?? 0,
        reward: r.gen === 1 ? RecommendService.rewardOf(byId.get(r.id)) : null,
      })),
    };
  }

  /* ── 운영 화면 ───────────────────────────────────────────── */

  /** 회원 찾기(코드 · 이메일 정확히 · 이름 일부) — 없으면 직접 추천이 많은 회원 20명 */
  async adminSearch(q?: string) {
    const t = (q ?? '').trim();
    const c = RecommendService.normalize(t);
    const where = !t ? `EXISTS (SELECT 1 FROM introducer_referrals x WHERE x.inviter_id = a.id)`
      : c ? `a.recommend_code = $1` : t.includes('@') ? `lower(a.email) = lower($1)` : `a.name ILIKE '%' || $1 || '%'`;
    const rows = await this.db.query<{ id: string; name: string; email: string; code: string | null; created_at: Date; direct: number; up: string | null; status: string }>(
      `SELECT a.id, a.name, a.email, a.recommend_code AS code, a.created_at, a.status,
              (SELECT count(*)::int FROM introducer_referrals WHERE inviter_id = a.id) AS direct,
              (SELECT u.name FROM introducer_referrals r JOIN accounts u ON u.id = r.inviter_id WHERE r.invitee_id = a.id) AS up
         FROM accounts a WHERE ${where}
        ORDER BY direct DESC, a.created_at LIMIT 20`, t ? [c ?? t] : []);
    return rows.map((r) => ({
      id: r.id, name: r.name, email: maskEmail(r.email), code: r.code, status: r.status,
      joinedAt: ymd(r.created_at), directCount: r.direct, recommender: r.up,
    }));
  }

  /** 한 회원 — 위로 추천인 줄(가까운 순) · 아래 전체 */
  async adminNode(id: string) {
    const [m] = await this.db.query<{ id: string; name: string; email: string; code: string | null; created_at: Date; verified: Date | null; status: string }>(
      `SELECT id, name, email, recommend_code AS code, created_at, identity_verified_at AS verified, status FROM accounts WHERE id = $1`, [id]);
    if (!m) throw new NotFound('없는 회원입니다.');
    const up = await this.db.query<{ id: string; name: string; code: string | null; n: number; rewarded: Date | null }>(
      `WITH RECURSIVE u(id, n, rewarded) AS (
         SELECT r.inviter_id, 1, r.rewarded_at FROM introducer_referrals r WHERE r.invitee_id = $1
         UNION ALL
         SELECT r.inviter_id, u.n + 1, NULL::timestamptz FROM introducer_referrals r JOIN u ON r.invitee_id = u.id WHERE u.n < ${TREE_GEN}
       ) SELECT u.id, a.name, a.recommend_code AS code, u.n, u.rewarded FROM u JOIN accounts a ON a.id = u.id ORDER BY u.n`, [id]);
    const changes = await this.db.query<{ at: Date; old: string | null; new: string | null; reason: string }>(
      `SELECT c.changed_at AS at, o.name AS old, n.name AS new, c.reason
         FROM recommend_changes c LEFT JOIN accounts o ON o.id = c.old_inviter LEFT JOIN accounts n ON n.id = c.new_inviter
        WHERE c.invitee_id = $1 ORDER BY c.changed_at DESC LIMIT 20`, [id]);
    const rows = await this.rows(id);
    const { keys, kids, truncated } = this.keyed(rows);
    const rw = await directRewards(this.db, id);   // v10.258 — 그 회원이 직접 추천한 분별로 받은 보상
    const byId = new Map(rw.map((x) => [x.id, x]));
    return {
      reward: rewardSum(rw),
      member: { id: m.id, name: m.name, email: maskEmail(m.email), code: m.code, status: m.status,
                joinedAt: ymd(m.created_at), verified: !!m.verified },
      recommenders: up.map((u) => ({ id: u.id, name: u.name, code: u.code, gen: u.n })),
      rewarded: !!up[0]?.rewarded,
      changes: changes.map((c) => ({ at: c.at.toISOString(), old: c.old, new: c.new, reason: c.reason })),
      total: Math.min(rows.length, TREE_MAX), truncated, generations: this.gens(rows),
      nodes: rows.slice(0, TREE_MAX).map((r) => ({
        k: keys.get(r.id)!, p: keys.get(r.up) ?? 0, gen: r.gen, id: r.id, name: r.name, code: r.code,
        status: r.status, verified: !!r.verified, joined: ymd(r.created_at),
        children: kids.get(r.id) ?? 0,
        reward: r.gen === 1 ? RecommendService.rewardOf(byId.get(r.id)) : null,
      })),
    };
  }

  /** 추천인 고치기 · 지우기(코드 null) — 사유 · 변경 기록 · 고리 · 보상 준 관계는 DB 가 막음 */
  async adminSetRecommender(id: string, code: string | null | undefined, reason: string) {
    const why = (reason ?? '').trim();
    if (why.length < 2 || why.length > 300) throw new PolicyViolation('REASON_REQUIRED', '사유를 2 ~ 300자로 적어 주십시오.');
    let next: string | null = null;
    if (code !== null && code !== undefined && String(code).trim() !== '') {
      const c = RecommendService.normalize(code);
      const o = c ? await this.ownerOf(c) : null;
      if (!o) throw new PolicyViolation('RECOMMEND_CODE_UNKNOWN', '없는 추천 코드입니다. 코드를 다시 확인해 주십시오.');
      if (o.id === id) throw new PolicyViolation('RECOMMEND_SELF', '자기 자신을 추천인으로 둘 수 없습니다.');
      next = o.id;
    }
    const [acc] = await this.db.query<{ id: string }>(`SELECT id FROM accounts WHERE id = $1`, [id]);
    if (!acc) throw new NotFound('없는 회원입니다.');
    return this.db.transaction(async () => {
      const [cur] = await this.db.query<{ id: string; inviter_id: string; rewarded_at: Date | null }>(
        `SELECT id, inviter_id, rewarded_at FROM introducer_referrals WHERE invitee_id = $1 FOR UPDATE`, [id]);
      if ((cur?.inviter_id ?? null) === next) throw new PolicyViolation('RECOMMEND_SAME', '지금 추천인과 같습니다.');
      if (cur?.rewarded_at) throw new PolicyViolation('RECOMMEND_REWARDED', '추천 보상을 준 관계는 추천인을 바꾸거나 지울 수 없습니다.');
      if (!next) await this.db.query(`DELETE FROM introducer_referrals WHERE id = $1`, [cur!.id]);
      else if (cur) await this.db.query(`UPDATE introducer_referrals SET inviter_id = $2 WHERE id = $1`, [cur.id, next]);
      else await this.db.query(`INSERT INTO introducer_referrals (inviter_id, invitee_id) VALUES ($1, $2)`, [next, id]);
      await this.db.query(
        `INSERT INTO recommend_changes (invitee_id, old_inviter, new_inviter, reason, changed_by) VALUES ($1, $2, $3, $4, $5)`,
        [id, cur?.inviter_id ?? null, next, why, this.me]);
      return { ok: true, recommender: next };
    });
  }

  /** 보상 규칙 — 켜짐 · 점수 · 한 달 상한 */
  async rewardRule() {
    const [r] = await this.db.query<{ is_on: boolean; points: number; cap: number | null }>(
      `SELECT is_active AS is_on, points, monthly_cap AS cap FROM point_rules WHERE code = 'REFERRAL_DIRECT'`);
    const [n] = await this.db.query<{ n: number; pts: number }>(
      `SELECT count(*)::int AS n, coalesce(sum(points), 0)::int AS pts FROM point_ledger WHERE rule_code = 'REFERRAL_DIRECT'`);
    return { isActive: r?.is_on ?? false, points: r?.points ?? 0, monthlyCap: r?.cap ?? null, given: n?.n ?? 0, givenPoints: n?.pts ?? 0 };
  }

  /* ---------------------------------------------------------------------
   * v10.259 (docs/392) — 추천 보상 켜기 전 점검(읽기만 · 막지 않음)
   *   대표 할 일 「추천 보상 점수 · 켜기」 전에 볼 것: 점수 · 한 달 상한 · 본인인증 방식 · 같은 사람 여러 계정 ·
   *   처리방침(게시 · 「추천」 줄) · 출금(원천징수율 · 주민등록번호 받기) + 켜면 생길 포인트 어림.
   *   level: OK 됨 · WARN 알고 켜면 됨 · NO 켜면 사고가 날 수 있음(그래도 막지 않음 — 켜기는 SUPER 판단)
   * ------------------------------------------------------------------- */
  async turnOnCheck() {
    const rule = await this.rewardRule();
    const [st] = await this.db.query<{ provider: string | null; dup: string | null; tax_rate: string | null; tax_id: string | null; priv_ver: string | null; priv_ref: boolean | null }>(
      `SELECT (SELECT value FROM site_settings WHERE key = 'identity.provider') AS provider,
              (SELECT value FROM site_settings WHERE key = 'identity.ci_duplicate') AS dup,
              nullif((SELECT value FROM site_settings WHERE key = 'point.cashout_tax_rate'), '') AS tax_rate,
              (SELECT value FROM site_settings WHERE key = 'point.cashout_tax_id') AS tax_id,
              (SELECT version FROM v_terms_current WHERE code = 'PRIVACY') AS priv_ver,
              (SELECT body ILIKE '%추천%' FROM v_terms_current WHERE code = 'PRIVACY') AS priv_ref`);
    const provider = (st?.provider || 'STUB').toUpperCase();
    const dup = (st?.dup || 'warn').toLowerCase();
    type Lv = 'OK' | 'WARN' | 'NO';
    const items: Array<{ key: string; level: Lv; value: string; hint: string }> = [
      { key: 'POINTS', level: rule.points === 1000 ? 'WARN' : 'OK', value: `${rule.points.toLocaleString('ko-KR')}점`,
        hint: rule.points === 1000 ? '처음 넣어 둔 값(1,000점) 그대로입니다 — 정한 점수인지 확인하십시오.' : '정한 점수입니다.' },
      { key: 'CAP', level: rule.monthlyCap == null ? 'WARN' : 'OK', value: rule.monthlyCap == null ? '없음' : `한 달 ${rule.monthlyCap}건`,
        hint: rule.monthlyCap == null ? '한 사람이 한 달에 받을 수 있는 보상 수에 제한이 없습니다 — 처음에는 상한을 두기를 권합니다.' : '한 사람이 한 달에 받는 보상 수를 이 안으로 막습니다.' },
      { key: 'IDENTITY', level: provider === 'NICE' ? 'OK' : 'NO', value: provider,
        hint: provider === 'NICE' ? '실제 휴대폰 본인확인(NICE)입니다.'
          : '시험용 본인인증이라 실제 확인 없이 인증됩니다 — 가짜 계정을 만들어 보상을 받을 수 있습니다. NICE 연동 뒤 켜기를 권합니다.' },
      { key: 'CI_DUPLICATE', level: dup === 'block' ? 'OK' : 'WARN', value: dup,
        hint: dup === 'block' ? '같은 사람이 다른 계정으로 본인인증하면 막습니다.' : '같은 사람이 다른 계정으로 본인인증해도 통과합니다 — 한 사람이 계정을 여러 개 만들어 보상을 여러 번 받을 수 있습니다(외부 연동 › 본인인증에서 block).' },
      { key: 'PRIVACY', level: !st?.priv_ver ? 'NO' : st.priv_ref ? 'OK' : 'WARN', value: st?.priv_ver ? `지금 판 ${st.priv_ver}` : '게시 없음',
        hint: !st?.priv_ver ? '게시된 개인정보처리방침이 없습니다.' : st.priv_ref ? '처리방침에 「추천」 줄이 있습니다.' : '처리방침에 「추천」이라는 글이 없습니다 — 추천 관계 · 보상 줄을 법무와 확인하십시오(docs/388 · 392).' },
      { key: 'CASHOUT_TAX', level: st?.tax_rate ? 'OK' : 'WARN', value: st?.tax_rate ? `${st.tax_rate}%` : '비어 있음',
        hint: st?.tax_rate ? '받은 보상을 출금할 때 이 비율로 원천징수합니다.' : '원천징수율이 비어 있어 출금 신청이 막힙니다 — 보상은 쌓이지만 출금은 못 합니다.' },
      { key: 'CASHOUT_TAX_ID', level: st?.tax_id === 'on' ? 'OK' : 'WARN', value: st?.tax_id === 'on' ? '켜짐' : '꺼짐',
        hint: st?.tax_id === 'on' ? '출금 때 주민등록번호를 받습니다(신고 자료).' : '주민등록번호 받기가 꺼져 있습니다 — 지급 신고에 필요하면 처리방침 줄 게시 뒤 켜십시오.' },
    ];
    const cap = rule.monthlyCap;
    const capped = (rows: Array<{ n: number }>) => rows.reduce((a, r) => a + (cap == null ? r.n : Math.min(r.n, cap)), 0);
    const wait = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM introducer_referrals r JOIN accounts a ON a.id = r.invitee_id
        WHERE r.rewarded_at IS NULL AND a.identity_verified_at IS NULL GROUP BY r.inviter_id`);
    const recent = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM introducer_referrals WHERE created_at > now() - interval '30 days' GROUP BY inviter_id`);
    const [none] = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM introducer_referrals r JOIN accounts a ON a.id = r.invitee_id
        WHERE r.rewarded_at IS NULL AND a.identity_verified_at IS NOT NULL`);
    const waitN = wait.reduce((a, r) => a + r.n, 0), recentN = recent.reduce((a, r) => a + r.n, 0);
    return {
      isActive: rule.isActive, points: rule.points, monthlyCap: cap,
      ready: !items.some((x) => x.level === 'NO'),
      counts: { ok: items.filter((x) => x.level === 'OK').length, warn: items.filter((x) => x.level === 'WARN').length, no: items.filter((x) => x.level === 'NO').length },
      items,
      estimate: {
        waiting: waitN, waitingPoints: capped(wait) * rule.points,
        recent30: recentN, recent30Points: capped(recent) * rule.points,
        verifiedNoReward: none?.n ?? 0,
      },
    };
  }

  async setRewardRule(isActive: boolean, points: number, monthlyCap: number | null) {
    if (!Number.isInteger(points) || points < 1 || points > 100000) {
      throw new PolicyViolation('INVALID_POINTS', '점수는 1 ~ 100,000 사이 정수로 적어 주십시오.');
    }
    if (monthlyCap !== null && (!Number.isInteger(monthlyCap) || monthlyCap < 1 || monthlyCap > 1000)) {
      throw new PolicyViolation('INVALID_CAP', '한 달 상한은 비우거나 1 ~ 1,000 사이 정수로 적어 주십시오.');
    }
    await this.db.query(
      `UPDATE point_rules SET is_active = $1, points = $2, monthly_cap = $3 WHERE code = 'REFERRAL_DIRECT'`,
      [!!isActive, points, monthlyCap]);
    return this.rewardRule();
  }

  /* ── 트리 공통 ───────────────────────────────────────────── */

  /** v10.258 — 상자 하나의 보상 표시(받음 · 기다림 · 없음 · 포인트 · 받은 날) */
  static rewardOf(x: DirectReward | undefined) {
    return x ? { state: x.state, points: x.points, at: x.at ? ymd(x.at) : null } : null;
  }

  private rows(root: string) {
    return this.db.query<TreeRow>(
      `WITH RECURSIVE t(id, up, gen, created_at) AS (
         SELECT r.invitee_id, r.inviter_id, 1, r.created_at FROM introducer_referrals r WHERE r.inviter_id = $1
         UNION ALL
         SELECT r.invitee_id, r.inviter_id, t.gen + 1, r.created_at FROM introducer_referrals r JOIN t ON r.inviter_id = t.id
          WHERE t.gen < ${TREE_GEN}
       )
       SELECT t.id, t.up, t.gen, t.created_at, a.name, a.status, a.recommend_code AS code,
              a.identity_verified_at AS verified, a.withdrawn_at AS withdrawn, a.email
         FROM t JOIN accounts a ON a.id = t.id
        ORDER BY t.gen, t.created_at LIMIT ${TREE_MAX + 1}`, [root]);
  }

  /** 회원 번호 대신 1부터 붙이는 번호(뿌리 = 0) */
  private keyed(rows: TreeRow[]) {
    const keys = new Map<string, number>();
    const kids = new Map<string, number>();
    rows.slice(0, TREE_MAX).forEach((r, i) => { keys.set(r.id, i + 1); kids.set(r.up, (kids.get(r.up) ?? 0) + 1); });
    return { keys, kids, truncated: rows.length > TREE_MAX };
  }

  private gens(rows: TreeRow[]) {
    const m = new Map<number, number>();
    for (const r of rows.slice(0, TREE_MAX)) m.set(r.gen, (m.get(r.gen) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([gen, count]) => ({ gen, count }));
  }
}

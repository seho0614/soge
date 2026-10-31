import { Injectable } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { GATE_KEY, ROLES_KEY } from '../../core/auth';
import { maskName } from '../../common/mask';

/**
 * v10.31 (10/10 「시안 기준」 지시 · 운영 화면 W6) — 시안에 있는데 서버 자료가 없던 구역.
 *
 *   활주로(SB-ADM-DSH-010)        — 실제 매출(v_monthly_revenue) · 운영이 넣은 월 비용(ops_monthly_costs)으로 계산. 숫자를 지어내지 않습니다.
 *   정책 원본(SB-ADM-POL-010)      — policy_items + 서버 값(요금제 · 검수 한계 · 초과 코드 단가)
 *   관 UI/UX(SB-ADM-GWN-010)       — gwan_axes(축 노출 · UI 유형)
 *   옮길 대상 미리보기(SB-ADM-SEG-020) — v_segment_shift_preview · segment_shift_log
 *   통합 현황(SB-ADM-ITG-010)      — 실제 DB · 실제 라우트(데코레이터)에서 셉니다
 *   외부 송출 · 퍼블리셔 지급(SB-ADS-PLT-010 · SB-ADS-PAY-010) — adx_*
 */
@Injectable()
export class AdminV31Service {
  constructor(private readonly db: DatabaseService, private readonly modules: ModulesContainer) {}

  private async setting(key: string): Promise<string | null> {
    const [r] = await this.db.query<{ value: string | null }>(`SELECT value FROM site_settings WHERE key = $1`, [key]);
    return r?.value ?? null;
  }

  /* ── 활주로 ─────────────────────────────────────────────────────── */

  /**
   * 월별 실제 매출 · 입력한 비용으로 손익분기 · 필요 유료회원 · 최저 현금 · 누적 최대 적자를 셉니다.
   *  · 손익분기: 실적에서 매출 ≥ 비용이 된 첫 달(N개월차). 아직이면 최근 3개월 매출 증가 추세로 따라잡는 달(추정이라고 표시).
   *  · 필요 유료회원: 월 평균 비용 − 구독 밖 매출을 유료 회원 1명의 월 매출(실제 활성 유료 구독의 평균 요금)로 나눔.
   *  · 최저 현금: 시작 현금(finance.opening_cash) + 누적 손익의 최저점. 시작 현금이 없으면 누적 손익 최저점만.
   */
  async runway() {
    const rev = await this.db.query<{ month: string; amount: string }>(
      `SELECT to_char(month, 'YYYY-MM') AS month, sum(amount) AS amount FROM v_monthly_revenue GROUP BY month ORDER BY month`);
    const revByKind = await this.db.query<{ month: string; kind: string; amount: string }>(
      `SELECT to_char(month, 'YYYY-MM') AS month, kind, amount FROM v_monthly_revenue ORDER BY month, kind`);
    const cost = await this.db.query<{ month: string; amount: string }>(
      `SELECT to_char(month, 'YYYY-MM') AS month, sum(amount) AS amount FROM ops_monthly_costs GROUP BY month ORDER BY month`);
    const opening = await this.setting('finance.opening_cash');
    const [cur] = await this.db.query<{ m: string }>(`SELECT to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') AS m`);

    const months = [...new Set([...rev.map((r) => r.month), ...cost.map((c) => c.month)])].sort();
    const notes: string[] = [];
    if (!cost.length) notes.push('월 비용이 아직 입력되지 않았습니다 — 「경영 지표 › 월 비용 · 활주로」에서 넣으면 활주로가 계산됩니다.');
    if (!opening) notes.push('시작 현금(finance.opening_cash)이 없어 최저 현금 대신 누적 손익의 최저점을 보여 줍니다.');
    /* 첫 달부터 이번 달까지 빈 달도 채웁니다 */
    if (months.length) {
      const [y0, m0] = months[0]!.split('-').map(Number) as [number, number];
      const last = months[months.length - 1]! > cur.m ? months[months.length - 1]! : cur.m;
      const all: string[] = [];
      for (let y = y0, m = m0; `${y}-${String(m).padStart(2, '0')}` <= last; m === 12 ? (y++, m = 1) : m++) all.push(`${y}-${String(m).padStart(2, '0')}`);
      months.splice(0, months.length, ...all);
    }
    const R = new Map(rev.map((r) => [r.month, Number(r.amount)]));
    const C = new Map(cost.map((c) => [c.month, Number(c.amount)]));
    let cum = 0, minCum = 0, minIdx = 0, be: number | null = null;
    const rows = months.map((m, i) => {
      const r = R.get(m) ?? 0, c = C.get(m) ?? 0, net = r - c;
      cum += net;
      if (cum < minCum) { minCum = cum; minIdx = i + 1; }
      if (be == null && C.has(m) && c > 0 && r >= c) be = i + 1;
      return { month: m, revenue: r, cost: c, net, cum, hasCost: C.has(m) };
    });
    const withCost = rows.filter((r) => r.hasCost);
    const recent = withCost.slice(-3);
    const avgCost = recent.length ? Math.round(recent.reduce((a, r) => a + r.cost, 0) / recent.length) : null;

    /* 손익분기 — 실적에 없으면 최근 매출 추세(월 평균 증가분)로 */
    let breakEven: { month: number | null; kind: 'ACTUAL' | 'TREND' | 'NONE' | 'NO_DATA'; label: string };
    if (be != null) breakEven = { month: be, kind: 'ACTUAL', label: `${be}개월차` };
    else if (!withCost.length) breakEven = { month: null, kind: 'NO_DATA', label: '비용 입력 전' };
    else {
      const last3 = rows.slice(-3);
      const slope = last3.length >= 2 ? (last3[last3.length - 1]!.revenue - last3[0]!.revenue) / (last3.length - 1) : 0;
      const lastRev = rows[rows.length - 1]!.revenue;
      if (slope <= 0 || avgCost == null) breakEven = { month: null, kind: 'NONE', label: '지금 추세로는 도달 안 함' };
      else {
        const k = Math.ceil((avgCost - lastRev) / slope);
        breakEven = { month: rows.length + Math.max(k, 1), kind: 'TREND', label: `${rows.length + Math.max(k, 1)}개월차 (추세 추정)` };
      }
    }

    /* 필요 유료회원 — 실제 활성 유료 구독의 평균 요금 */
    const [arpu] = await this.db.query<{ avg: string | null; n: string; minp: string | null }>(
      `SELECT avg(p.monthly_price) FILTER (WHERE s.id IS NOT NULL) AS avg, count(s.id) AS n,
              min(p.monthly_price) FILTER (WHERE p.monthly_price > 0) AS minp
         FROM subscription_plans p
         LEFT JOIN subscriptions s ON s.plan_code = p.code AND s.status = 'ACTIVE'
        WHERE p.monthly_price > 0`);
    const subRecent = revByKind.filter((x) => x.kind === 'SUBSCRIPTION' && recent.some((r) => r.month === x.month));
    const otherRecent = revByKind.filter((x) => x.kind !== 'SUBSCRIPTION' && recent.some((r) => r.month === x.month));
    const avgOther = recent.length ? otherRecent.reduce((a, x) => a + Number(x.amount), 0) / recent.length : 0;
    const price = arpu?.avg ? Number(arpu.avg) : arpu?.minp ? Number(arpu.minp) : null;
    const needPaid = avgCost != null && price ? Math.max(0, Math.ceil((avgCost - avgOther) / price)) : null;
    void subRecent;

    const openingCash = opening ? Number(opening) : null;
    return {
      months: rows,
      breakEven,
      needPaid: { count: needPaid, pricePerMember: price,
        basis: arpu?.avg ? `활성 유료 구독 ${arpu.n}건의 평균 요금` : price ? '유료 요금제 최저 요금(활성 유료 구독 없음)' : '유료 요금제 없음' },
      minCash: { amount: openingCash != null ? openingCash + minCum : minCum, monthIndex: minIdx || null,
        month: minIdx ? rows[minIdx - 1]!.month : null, hasOpening: openingCash != null },
      maxDeficit: minCum < 0 ? -minCum : 0,
      avgCost, openingCash,
      notes,
      basis: '매출 = DB 에 실제로 들어온 돈(구독 − 환불 · 소개코드 추가분 · 리드 이용료 · 광고비 · 법률 · 세무 노출료 · 소개몰 수수료). 비용 = 운영이 입력한 월 비용. 소개비는 당사자 직접 지급이라 매출이 아닙니다(INV-11).',
    };
  }

  costs(month?: string) {
    return this.db.query(
      `SELECT to_char(c.month, 'YYYY-MM') AS month, c.category, coalesce(cl.label, c.category) AS "categoryLabel",
              c.amount, c.memo, a.name AS "enteredBy", c.entered_at AS "enteredAt"
         FROM ops_monthly_costs c
         LEFT JOIN accounts a ON a.id = c.entered_by
         LEFT JOIN code_labels cl ON cl.domain = 'finance.cost' AND cl.code = c.category
        WHERE ($1::text IS NULL OR to_char(c.month, 'YYYY-MM') = $1)
        ORDER BY c.month DESC, cl.sort_order NULLS LAST LIMIT 240`, [month ?? null]);
  }

  async putCost(dto: { month: string; category: string; amount: number; memo?: string }) {
    if (!/^\d{4}-\d{2}$/.test(dto.month)) throw new PolicyViolation('BAD_MONTH', '달은 2026-10 처럼 적어 주십시오.');
    const [row] = await this.db.query(
      `INSERT INTO ops_monthly_costs (month, category, amount, memo, entered_by)
       VALUES (($1 || '-01')::date, $2, $3, $4, $5)
       ON CONFLICT (month, category) DO UPDATE SET amount = EXCLUDED.amount, memo = EXCLUDED.memo,
              entered_by = EXCLUDED.entered_by, entered_at = now()
       RETURNING to_char(month, 'YYYY-MM') AS month, category, amount`,
      [dto.month, dto.category, Math.round(dto.amount), dto.memo ?? null, RequestCtx.actorId()]);
    return row;
  }

  /* ── 정책 원본 ─────────────────────────────────────────────────── */

  async policyItems() {
    const items = await this.db.query<any>(
      `SELECT code, title, content, basis, status, pending_effect AS "pendingEffect", live_key AS "liveKey",
              updated_at AS "updatedAt" FROM policy_items ORDER BY sort_order`);
    const plans = await this.db.query<{ code: string; monthly_price: string }>(
      `SELECT code, monthly_price FROM subscription_plans ORDER BY monthly_price`);
    const cap = await this.setting('review.daily_capacity');
    const [extra] = await this.db.query<{ p: string | null }>(
      `SELECT (SELECT value FROM site_settings WHERE key IN ('refcode.extra_price','billing.extra_code_price') AND value ~ '^[0-9]+$' LIMIT 1) AS p`);
    const won = (n: number) => n.toLocaleString('ko-KR');
    return items.map((i) => {
      let live: string | null = null;
      if (i.liveKey === 'PLANS' && plans.length) live = plans.map((p) => `${p.code} ${won(Number(p.monthly_price))}`).join(' · ');
      if (i.liveKey === 'REVIEW_CAP' && cap) live = `1명 · 일 ${cap}건 · SLA 24시간`;
      if (i.liveKey === 'REFCODE_EXTRA' && extra?.p) live = `건당 ${won(Number(extra.p))}원 정액 (거래금액 무연동)`;
      return { ...i, content: live ?? i.content, live: !!live };
    });
  }

  async updatePolicyItem(code: string, dto: { content?: string; status?: string; pendingEffect?: string }) {
    const [row] = await this.db.query(
      `UPDATE policy_items SET content = coalesce($2, content), status = coalesce($3, status),
              pending_effect = CASE WHEN $3 = 'CONFIRMED' THEN NULL ELSE coalesce($4, pending_effect) END,
              updated_by = $5, updated_at = now()
        WHERE code = $1 RETURNING code, content, status`,
      [code, dto.content?.trim() || null, dto.status ?? null, dto.pendingEffect ?? null, RequestCtx.actorId()]);
    if (!row) throw new NotFound('없는 정책 항목입니다.');
    return row;
  }

  /* ── 관 축 · UI 유형 ───────────────────────────────────────────── */

  gwanAxes(gwan?: string, publicOnly = false) {
    return this.db.query(
      `SELECT x.gwan_code AS "gwanCode", g.name AS "gwanName", x.axis_code AS "axisCode", x.name, x.nature, x.judge,
              x.urgent_label AS "urgentLabel", x.regulation, x.is_exposed AS "isExposed", x.ui_type AS "uiType",
              coalesce(cl.label, x.ui_type) AS "uiTypeLabel", x.ui_fixed AS "uiFixed", x.updated_at AS "updatedAt"
         FROM gwan_axes x JOIN gwans g ON g.code = x.gwan_code
         LEFT JOIN code_labels cl ON cl.domain = 'gwan.ui_type' AND cl.code = x.ui_type
        WHERE ($1::text IS NULL OR x.gwan_code = $1) AND (NOT $2 OR x.is_exposed)
        ORDER BY g.sort_order NULLS LAST, x.gwan_code, x.sort_order`, [gwan ?? null, publicOnly]);
  }

  async updateGwanAxis(gwan: string, axis: string, dto: { isExposed?: boolean; uiType?: string }) {
    if (dto.isExposed === undefined && !dto.uiType) throw new PolicyViolation('NOTHING', '바꿀 것이 없습니다.');
    const [row] = await this.db.query(
      `UPDATE gwan_axes SET is_exposed = coalesce($3, is_exposed), ui_type = coalesce($4, ui_type), updated_by = $5
        WHERE gwan_code = $1 AND axis_code = $2 RETURNING gwan_code AS "gwanCode", axis_code AS "axisCode", is_exposed AS "isExposed", ui_type AS "uiType"`,
      [gwan, axis, dto.isExposed ?? null, dto.uiType ?? null, RequestCtx.actorId()]);
    if (!row) throw new NotFound('없는 축입니다.');
    return { ...row, note: dto.isExposed === false ? '신규 노출만 멈춥니다 — 진행 중인 거래는 끝까지 갑니다.' : null };
  }

  /** v10.31 — AI 학습 화면 지표 4칸(시안 CLS-020 · RSK-020 「학습 · 최소 교정/신호 · 점수 상한/예외 기한 · 어휘/법 규칙 예외」) */
  async learnSettings() {
    const rows = await this.db.query<{ key: string; value: string | null }>(
      `SELECT key, value FROM site_settings WHERE key ~ '^(classify|risk)\\.learn\\.'`);
    const v = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const [c] = await this.db.query<Record<string, string>>(
      `SELECT (SELECT count(*) FROM classify_vocab) AS vocab,
              (SELECT count(*) FROM v_risk_law_exempted) AS law_exempted`).catch(() => [{ vocab: '0', law_exempted: '0' }]);
    return {
      classify: { enabled: v['classify.learn.enabled'] === 'on', minSignals: Number(v['classify.learn.min_signals'] ?? 3),
                  maxWeight: Number(v['classify.learn.max_weight'] ?? 9), vocab: Number(c.vocab) },
      risk: { enabled: v['risk.learn.enabled'] === 'on', minSignals: Number(v['risk.learn.min_signals'] ?? 3),
              expireDays: Number(v['risk.learn.expire_days'] ?? 90), lawExempted: Number(c.law_exempted) },
    };
  }

  /* ── 관 오픈 체크리스트(SB-ADM-SIT-040 · 시안 6줄) ───────────────── */

  async gwanOpenCheck(code: string) {
    const [g] = await this.db.query<any>(`SELECT code, name, is_active AS "isActive", is_hub AS "isHub" FROM gwans WHERE code = $1`, [code]);
    if (!g) throw new NotFound('없는 관입니다.');
    const [r] = await this.db.query<Record<string, string>>(
      `SELECT (SELECT count(*) FROM categories WHERE gwan_code = $1 AND status = 'APPROVED') AS cats,
              (SELECT count(*) FROM categories WHERE gwan_code = $1 AND status = 'APPROVED' AND fee_bearer IS NULL) AS no_bearer,
              (SELECT string_agg(DISTINCT fee_bearer, ' · ') FROM categories WHERE gwan_code = $1 AND status = 'APPROVED' AND fee_bearer IS NOT NULL) AS bearers,
              (SELECT count(*) FROM site_settings WHERE key LIKE 'footer.%' AND is_required_for_open AND coalesce(btrim(value), '') = '') AS legal_empty,
              (SELECT count(*) FROM v_open_blockers WHERE kind = 'SETTING' AND item LIKE 'footer.%') AS legal_bad,
              (SELECT value FROM site_settings WHERE key = 'footer.biz_reg_no') AS biz_no,
              (SELECT value FROM site_settings WHERE key = 'footer.mail_order_no') AS mail_no,
              (SELECT count(*) FROM terms WHERE status = 'DRAFT') AS terms_draft,
              (SELECT count(*) FROM v_terms_current WHERE (gwan_code IS NULL OR gwan_code = $1)) AS terms_pub,   /* v10.161 (D151) — 약관마다 하나 */
              (SELECT to_char(max(effective_from) FILTER (WHERE effective_from <> 'infinity'), 'YYYY-MM-DD') FROM terms WHERE status = 'PUBLISHED') AS terms_from,
              (SELECT count(DISTINCT r.account_id) FROM account_roles r JOIN accounts a ON a.id = r.account_id
                WHERE r.role IN ('REVIEWER') AND a.status = 'ACTIVE') AS reviewers`, [code]);
    const n = (k: string) => Number(r[k] ?? 0);
    const checks = [
      { key: 'CATEGORY', label: '업종 1종 이상 승인', ok: n('cats') > 0, detail: `${n('cats')}종 승인됨`, go: 'category' },
      { key: 'FEE_BEARER', label: '소개비 부담 주체 지정', ok: n('cats') > 0 && n('no_bearer') === 0,
        detail: n('no_bearer') ? `부담 주체가 비어 있는 업종 ${n('no_bearer')}종` : (r.bearers ?? '—'), go: 'category' },
      { key: 'GATE', label: '인증 게이트 지정', ok: true, detail: '등록 · 1:1 문의 시작 시 — 서버 게이트(본인인증 · 사업자 인증)', go: null },
      { key: 'LEGAL', label: '사이트 기본 정보 · 법정 고지', ok: n('legal_empty') === 0 && n('legal_bad') === 0,
        detail: n('legal_empty') || n('legal_bad') ? `비었거나 형식이 틀린 항목 ${n('legal_empty') + n('legal_bad')}개` : `채워졌습니다 — ${r.biz_no ?? ''} · ${r.mail_no ?? ''}`, go: 'siteinfo' },
      { key: 'TERMS', label: `약관 ${n('terms_pub')}종 발행`, ok: n('terms_pub') > 0 && n('terms_draft') === 0,
        detail: `DRAFT ${n('terms_draft')}${r.terms_from ? ` · ${r.terms_from} 시행` : ''}`, go: null },
      { key: 'REVIEWER', label: '검수 담당자 지정', ok: n('reviewers') > 0, detail: `${n('reviewers')}명`, go: 'roles' },
    ];
    return { code: g.code, name: g.name, isActive: g.isActive, isHub: g.isHub,
             passed: checks.filter((c) => c.ok).length, total: checks.length, canOpen: !g.isActive && checks.every((c) => c.ok), checks };
  }

  async openGwan(code: string) {
    const c = await this.gwanOpenCheck(code);
    if (c.isActive) throw new StateConflict('ALREADY_OPEN', '이미 운영중인 관입니다.');
    if (!c.canOpen) throw new PolicyViolation('OPEN_CHECK', `미통과 ${c.total - c.passed}건 — ${c.checks.filter((x) => !x.ok).map((x) => x.label).join(' · ')}`);
    await this.db.query(`UPDATE gwans SET is_active = true, opened_at = coalesce(opened_at, now()) WHERE code = $1`, [code]);
    return { code, isActive: true, note: `${c.name}을(를) 운영중으로 전환했습니다.` };
  }

  /* ── 성향 학습 미리보기 · 옮긴 기록 ─────────────────────────────── */

  async segmentPreview() {
    const rows = await this.db.query<any>(
      `SELECT v.account_id AS "accountId", a.name, v.current_code AS "currentCode", s1.name AS "currentName",
              v.to_code AS "toCode", s2.name AS "toName", v.clicks_from AS "clicksFrom", v.clicks_to AS "clicksTo",
              v.verdict, v.min_c AS "minClicks", v.ratio
         FROM v_segment_shift_preview v
         JOIN accounts a ON a.id = v.account_id
         LEFT JOIN ad_segments s1 ON s1.code = v.current_code
         LEFT JOIN ad_segments s2 ON s2.code = v.to_code
        ORDER BY (v.verdict = 'MOVE') DESC, v.clicks_to DESC LIMIT 200`);
    const [nc] = await this.db.query<{ n: number }>(`SELECT count(*)::int n FROM v_segment_learn_no_consent`);
    const minClicks = Number((await this.setting('segment.learn.min_clicks')) ?? 5);
    const ratio = Number((await this.setting('segment.learn.ratio')) ?? 3);
    return {
      enabled: (await this.setting('segment.learn.enabled')) === 'on',
      minClicks, ratio,
      moved: rows.filter((r) => r.verdict === 'MOVE').length,
      held: rows.filter((r) => r.verdict !== 'MOVE').length,
      noConsent: nc?.n ?? 0,
      /* 이름은 첫 글자만(시안 박○○) — 광고주는 이 목록을 받지 않습니다 */
      items: rows.map(({ name, accountId, ...r }) => ({ ...r, member: (maskName(name) ?? '').replace(/\*/g, '○'), ref: String(accountId).slice(0, 8) })),
    };
  }

  segmentLog() {
    return this.db.query(
      `SELECT l.id, l.from_code AS "fromCode", s1.name AS "fromName", l.to_code AS "toCode", s2.name AS "toName",
              l.clicks_from AS "clicksFrom", l.clicks_to AS "clicksTo", l.applied_at AS "appliedAt", l.reverted_at AS "revertedAt"
         FROM segment_shift_log l
         LEFT JOIN ad_segments s1 ON s1.code = l.from_code
         LEFT JOIN ad_segments s2 ON s2.code = l.to_code
        ORDER BY l.applied_at DESC LIMIT 50`);
  }

  /**
   * v10.117 (docs/181) — 성향 학습 되돌리기(SB-ADM-SEG-010 「옮긴 기록」의 줄마다).
   *   그 회원의 가장 최근 이동만 되돌립니다(뒤에 또 옮겨졌으면 최근 것부터). 성향이 아직 그 세그먼트이고 약관 동의가 있으면
   *   옮기기 전 세그먼트로 돌리고, 성향이 지워졌거나 이미 바뀌었으면 기록에만 「되돌림」을 남깁니다.
   *   학습을 막지는 않습니다(대표 2026-10-26 「막지 않음」) — 학습을 다시 돌리면 같은 클릭으로 다시 옮길 수 있습니다.
   */
  async revertSegmentShift(id: string) {
    return this.db.transaction(async () => {
      const [l] = await this.db.query<{ account_id: string; from_code: string | null; to_code: string; applied_at: Date; reverted_at: Date | null }>(
        `SELECT account_id, from_code, to_code, applied_at, reverted_at FROM segment_shift_log WHERE id = $1 FOR UPDATE`, [id]);
      if (!l) throw new NotFound('없는 기록입니다.');
      if (l.reverted_at) throw new StateConflict('ALREADY_REVERTED', '이미 되돌린 기록입니다.');
      const [newer] = await this.db.query(
        `SELECT 1 FROM segment_shift_log WHERE account_id = $1 AND reverted_at IS NULL AND applied_at > $2 AND id <> $3`, [l.account_id, l.applied_at, id]);
      if (newer) throw new StateConflict('NEWER_SHIFT', '이 회원은 그 뒤에 다시 옮겨졌습니다. 최근 기록부터 되돌리십시오.');
      const restored = l.from_code ? await this.db.query(
        `UPDATE member_ad_profiles p
            SET segment_code = $2,
                source = CASE WHEN EXISTS (SELECT 1 FROM segment_shift_log o WHERE o.account_id = p.account_id AND o.reverted_at IS NULL
                                             AND o.applied_at < $4) THEN 'BEHAVIOR' ELSE 'MEMBER' END
          WHERE p.account_id = $1 AND p.segment_code = $3 AND fn_adpersonal_on(p.account_id)
          RETURNING 1`, [l.account_id, l.from_code, l.to_code, l.applied_at]) : [];
      await this.db.query(`UPDATE segment_shift_log SET reverted_at = now(), reverted_by = $2 WHERE id = $1`, [id, RequestCtx.actorId() ?? null]);
      return { ok: true, restored: restored.length > 0,
        note: restored.length ? '옮기기 전 세그먼트로 되돌렸습니다. 학습을 다시 돌리면 같은 클릭으로 다시 옮길 수 있습니다.'
                              : '기록에 「되돌림」만 남겼습니다(성향이 지워졌거나 그 뒤 바뀌었음). 학습을 다시 돌리면 같은 클릭으로 다시 옮길 수 있습니다.' };
    });
  }

  /* ── 통합 현황 ─────────────────────────────────────────────────── */

  /** 등록된 라우트를 데코레이터(경로 · 메서드 · @Roles · @RequireGate)에서 셉니다 — 손으로 적은 표가 아닙니다 */
  private routes() {
    const out: { method: string; path: string; roles: string[]; gated: boolean }[] = [];
    const M = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD'];
    for (const mod of this.modules.values()) {
      for (const wrapper of mod.controllers.values()) {
        const cls = wrapper.metatype as (new (...a: unknown[]) => unknown) | null;
        if (!cls) continue;
        const base = String(Reflect.getMetadata(PATH_METADATA, cls) ?? '');
        const clsRoles: string[] = Reflect.getMetadata(ROLES_KEY, cls) ?? [];
        const clsGates: string[] = Reflect.getMetadata(GATE_KEY, cls) ?? [];
        const proto = cls.prototype as Record<string, unknown>;
        for (const name of Object.getOwnPropertyNames(proto)) {
          if (name === 'constructor') continue;
          const fn = proto[name];
          if (typeof fn !== 'function') continue;
          const p = Reflect.getMetadata(PATH_METADATA, fn);
          const m = Reflect.getMetadata(METHOD_METADATA, fn);
          if (p === undefined || m === undefined) continue;
          const roles: string[] = Reflect.getMetadata(ROLES_KEY, fn) ?? clsRoles;
          const gates: string[] = Reflect.getMetadata(GATE_KEY, fn) ?? clsGates;
          const path = `/${[base, String(p)].map((s) => s.replace(/^\/|\/$/g, '')).filter(Boolean).join('/')}`;
          out.push({ method: M[m] ?? String(m), path, roles, gated: gates.length > 0 });
        }
      }
    }
    return out;
  }

  async integrationStatus() {
    const routes = this.routes();
    const sys = (p: string) =>
      /\/ads\/|\/adx|\/ad-/.test(p) ? 'ADS'
      : /\/health|\/hlt/.test(p) ? 'HLT'
      : /\/partner|\/lead|\/partners/.test(p) ? 'LED'
      : /\/mal\/|\/consult|\/brokers|\/directory|realty|ownership/.test(p) ? 'MAL'
      : /\/biz\//.test(p) ? 'BIZ'
      : /\/mny\//.test(p) ? 'MNY'
      : /\/(listings|requests|categories|gwans|search)(\/|$)/.test(p) ? 'GWAN_VAR'
      : 'CORE';
    /* 관 4개(검사 ⑫ — 관 코드 목록을 박을 때는 HLT 까지) · 그 밖의 계통 */
    const GWAN_SYS = ['MNY', 'MAL', 'BIZ', 'HLT'];
    const SYS: [string, string, string][] = [
      ['CORE', '—', 'www.'],
      ...GWAN_SYS.map((g): [string, string, string] => [g, g, `${g.toLowerCase()}.`]),
      ['LED', 'LED', 'partner.'], ['ADS', '—', 'ads.'], ['GWAN_VAR', '—', '—'],
    ];
    const protectedOf = (r: { roles: string[]; gated: boolean }) => r.roles.length > 0 || r.gated;
    const opsOnly = (r: { roles: string[] }) => r.roles.length > 0 && r.roles.every((x) => ['ADMIN', 'SUPER', 'REVIEWER', 'PAYOUT'].includes(x));
    const systems = SYS.map(([code, gwan, sub]) => {
      const rs = routes.filter((r) => sys(r.path) === code);
      return { code, gwan, subdomain: sub, routes: rs.length, protected: rs.filter(protectedOf).length,
               public: rs.filter((r) => !protectedOf(r)).length, ops: rs.filter(opsOnly).length };
    });

    const [db] = await this.db.query<Record<string, string>>(
      `SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE') AS tables,
              (SELECT count(*) FROM information_schema.views WHERE table_schema = 'public' AND table_name LIKE 'v\\_%') AS views,
              (SELECT count(*) FROM information_schema.views WHERE table_schema = 'public'
                 AND (table_name LIKE 'v\\_inv%' OR table_name LIKE '%violation%' OR table_name LIKE '%mismatch%' OR table_name LIKE '%leak%')) AS watch_views,
              (SELECT count(DISTINCT role) FROM account_roles) AS roles,
              (SELECT count(*) FROM gwans) AS gwans`);
    /* 분리 점검 — 전부 0 이어야 합니다(실제 조회) */
    const checks = await this.db.query<{ code: string; label: string; n: string }>(
      `SELECT 'CROSS_GWAN_DEAL' AS code, '관 넘는 거래 (매물 관 ≠ 요청 관 · INV-SEP5)' AS label,
              (SELECT count(*) FROM deals d JOIN listings l ON l.id = d.listing_id JOIN requests r ON r.id = d.request_id
                WHERE l.gwan_code <> r.gwan_code) AS n
       UNION ALL
       SELECT 'CAT_GWAN', '매물 관 ≠ 업종 관',
              (SELECT count(*) FROM listings l JOIN categories c ON c.id = l.category_id WHERE c.gwan_code IS NOT NULL AND c.gwan_code <> l.gwan_code)
       UNION ALL
       SELECT 'NO_GWAN', '관가변인데 관 모름 (관 없는 매물 · 요청)',
              (SELECT count(*) FROM listings WHERE gwan_code IS NULL) + (SELECT count(*) FROM requests WHERE gwan_code IS NULL)
       UNION ALL
       SELECT 'CROSS_FK', '체계 간 직접 FK (소개몰 hlt_* ↔ 소개 체계 listings · deals · settlements)',
              (SELECT count(*) FROM information_schema.referential_constraints rc
                 JOIN information_schema.table_constraints a ON a.constraint_name = rc.constraint_name AND a.table_schema = 'public'
                 JOIN information_schema.table_constraints b ON b.constraint_name = rc.unique_constraint_name AND b.table_schema = 'public'
                WHERE (a.table_name LIKE 'hlt\\_%' AND b.table_name IN ('listings','deals','settlements','requests'))
                   OR (b.table_name LIKE 'hlt\\_%' AND a.table_name IN ('listings','deals','settlements','requests')))
       UNION ALL
       SELECT 'OPS_LEAK', '운영권한 누출 (정지 · 탈퇴 계정이 운영 역할을 가짐)',
              (SELECT count(*) FROM account_roles r JOIN accounts a ON a.id = r.account_id
                WHERE r.role IN ('ADMIN','SUPER','REVIEWER','PAYOUT') AND a.status <> 'ACTIVE')
       UNION ALL
       SELECT 'PAYOUT_SPLIT', '지급 담당이 운영 역할도 가짐 (승인 · 집행 분리)',
              (SELECT count(*) FROM account_roles p JOIN account_roles o ON o.account_id = p.account_id AND o.role IN ('ADMIN','SUPER')
                WHERE p.role = 'PAYOUT')`);
    const gate = await this.setting('adx.payout_gate');
    const gvar = systems.find((s) => s.code === 'GWAN_VAR')!.routes;
    return {
      kpis: {
        tables: Number(db.tables), views: Number(db.views), routes: routes.length,
        protectedRoutes: routes.filter(protectedOf).length, publicRoutes: routes.filter((r) => !protectedOf(r)).length,
        roles: Number(db.roles), watchViews: Number(db.watch_views), systems: SYS.length - 1, gwanVarRoutes: gvar,
        aclMode: 'DECORATOR', payoutGate: gate === 'open' ? 'OPEN' : 'CLOSED',
      },
      systems,
      checks: checks.map((c) => ({ ...c, n: Number(c.n) })),
      note: '숫자는 지금 DB 와 서버에 등록된 라우트(데코레이터)에서 바로 셉니다. 손으로 적은 표가 아닙니다.',
    };
  }

  /* ── 외부 송출(adx) · 퍼블리셔 지급 ──────────────────────────────── */

  async adxOverview() {
    const S = await this.db.query<{ key: string; value: string | null }>(
      `SELECT key, value FROM site_settings WHERE key LIKE 'adx.%'`);
    const set = Object.fromEntries(S.map((s) => [s.key, s.value]));
    const publishers = await this.db.query(
      `SELECT p.id, p.name, p.domain, p.domain_verified_at AS "domainVerifiedAt", p.status, p.share_bp AS "shareBp",
              cardinality(p.owner_ips) AS "ownerIps", a.name AS "accountName",
              (SELECT count(*) FROM adx_impressions i WHERE i.publisher_id = p.id AND i.served_at > now() - interval '30 days')::int AS impressions,
              (SELECT count(*) FROM adx_clicks c WHERE c.publisher_id = p.id AND c.clicked_at > now() - interval '30 days')::int AS clicks,
              (SELECT count(*) FROM adx_clicks c WHERE c.publisher_id = p.id AND c.clicked_at > now() - interval '30 days' AND c.invalid_rule IS NOT NULL)::int AS invalid
         FROM adx_publishers p LEFT JOIN accounts a ON a.id = p.account_id ORDER BY p.created_at`);
    const filters = await this.db.query<{ rule: string; n: string }>(
      `SELECT r AS rule, (SELECT count(*) FROM adx_clicks c WHERE c.invalid_rule = r AND c.clicked_at > now() - interval '30 days') AS n
         FROM unnest(ARRAY['F1','F2','F3','F4','F5','F6','F7']) r`);
    const [clicks] = await this.db.query<Record<string, string>>(
      `SELECT count(*) AS total, count(*) FILTER (WHERE invalid_rule IS NULL) AS valid,
              count(*) FILTER (WHERE invalid_rule IS NULL AND confirmed_at IS NULL) AS held,
              count(*) FILTER (WHERE confirmed_at IS NOT NULL) AS confirmed,
              coalesce(sum(cpc) FILTER (WHERE invalid_rule IS NULL), 0) AS billed
         FROM adx_clicks WHERE clicked_at > now() - interval '30 days'`);
    const [mis] = await this.db.query<{ n: string }>(`SELECT count(*) AS n FROM v_adx_ledger_mismatch`);
    const [ads] = await this.db.query<{ inv: string; paid: string }>(
      `SELECT (SELECT count(*) FROM ad_invoices) AS inv, (SELECT coalesce(sum(amount),0) FROM ad_payments) AS paid`);
    return {
      settings: {
        payoutGate: set['adx.payout_gate'] === 'open' ? 'open' : 'closed', cpc: Number(set['adx.cpc'] ?? 300),
        holdDays: Number(set['adx.hold_days'] ?? 7), minPayout: Number(set['adx.min_payout'] ?? 50000),
        withholdingBp: Number(set['adx.withholding_bp'] ?? 330), ctrSpikePct: Number(set['adx.ctr_spike_pct'] ?? 20),
        dcPrefixes: (set['adx.dc_ip_prefixes'] ?? '').split(',').filter((x) => x.trim()).length,
      },
      publishers,
      filters: filters.map((f) => ({ rule: f.rule, n: Number(f.n) })),
      clicks: Object.fromEntries(Object.entries(clicks).map(([k, v]) => [k, Number(v)])),
      ledgerMismatch: Number(mis.n),
      adBilling: { invoices: Number(ads.inv), paid: Number(ads.paid) },
      statements: await this.adxStatements(),
    };
  }

  adxStatements() {
    return this.db.query(
      `SELECT s.id, s.publisher_id AS "publisherId", p.name AS "publisherName", to_char(s.month, 'YYYY-MM') AS month,
              s.confirmed_revenue AS "confirmedRevenue", s.carried_in AS "carriedIn", s.gross, s.withholding, s.net, s.status,
              (SELECT count(*) FROM adx_statement_items i WHERE i.statement_id = s.id)::int AS clicks,
              rq.name AS "requestedBy", s.requested_at AS "requestedAt", ap.name AS "approvedBy", s.approved_at AS "approvedAt",
              pd.name AS "paidBy", s.paid_at AS "paidAt", s.paid_ref AS "paidRef",
              s.requested_by = $1 AS "mineRequested", s.approved_by = $1 AS "mineApproved"
         FROM adx_statements s JOIN adx_publishers p ON p.id = s.publisher_id
         LEFT JOIN accounts rq ON rq.id = s.requested_by LEFT JOIN accounts ap ON ap.id = s.approved_by
         LEFT JOIN accounts pd ON pd.id = s.paid_by
        ORDER BY s.month DESC, p.name LIMIT 200`, [RequestCtx.actorId()]);
  }

  async addPublisher(dto: { name: string; domain: string; accountEmail?: string; ownerIps?: string[] }) {
    const domain = dto.domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    let accountId: string | null = null;
    if (dto.accountEmail?.trim()) {
      const [a] = await this.db.query<{ id: string }>(`SELECT id FROM accounts WHERE email = $1`, [dto.accountEmail.trim()]);
      if (!a) throw new PolicyViolation('NO_ACCOUNT', '그 이메일의 회원이 없습니다.');
      accountId = a.id;
    }
    const ips = (dto.ownerIps ?? []).map((x) => x.trim()).filter(Boolean);
    const [row] = await this.db.query(
      `INSERT INTO adx_publishers (name, domain, account_id, owner_ips, created_by) VALUES ($1,$2,$3,$4::text[],$5)
       RETURNING id, name, domain`, [dto.name.trim(), domain, accountId, ips, RequestCtx.actorId()]);
    return row;
  }

  async updatePublisher(id: string, dto: { verifyDomain?: boolean; status?: string; ownerIps?: string[] }) {
    const [row] = await this.db.query(
      `UPDATE adx_publishers SET
              domain_verified_at = CASE WHEN $2::boolean IS TRUE THEN coalesce(domain_verified_at, now())
                                        WHEN $2::boolean IS FALSE THEN NULL ELSE domain_verified_at END,
              status = coalesce($3, status),
              owner_ips = coalesce($4::text[], owner_ips)
        WHERE id = $1 RETURNING id, status, domain_verified_at AS "domainVerifiedAt"`,
      [id, dto.verifyDomain ?? null, dto.status ?? null, dto.ownerIps ?? null]);
    if (!row) throw new NotFound('없는 퍼블리셔입니다.');
    return row;
  }

  async adxConfirm() {
    const [r] = await this.db.query<{ n: number }>(`SELECT fn_adx_confirm() AS n`);
    return { confirmed: r.n };
  }

  async adxClose(month: string) {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new PolicyViolation('BAD_MONTH', '달은 2026-09 처럼 적어 주십시오.');
    const [r] = await this.db.query<{ n: number }>(`SELECT fn_adx_month_close(($1 || '-01')::date) AS n`, [month]);
    return { statements: r.n, note: r.n ? `명세서 ${r.n}건을 만들었습니다.` : '새로 만들 명세서가 없습니다(확정된 클릭이 없거나 이미 마감).' };
  }

  async adxStatementAction(id: string, action: string, paidRef?: string) {
    const actor = RequestCtx.actorId();
    const sql = action === 'REQUEST'
      ? `UPDATE adx_statements SET status = 'REQUESTED', requested_by = $2 WHERE id = $1 RETURNING id, status`
      : action === 'APPROVE'
      ? `UPDATE adx_statements SET status = 'APPROVED', approved_by = $2 WHERE id = $1 RETURNING id, status`
      : action === 'PAY'
      ? `UPDATE adx_statements SET status = 'PAID', paid_by = $2, paid_ref = $3 WHERE id = $1 RETURNING id, status`
      : null;
    if (!sql) throw new PolicyViolation('BAD_ACTION', 'REQUEST · APPROVE · PAY 중 하나입니다.');
    const [row] = await this.db.query(sql, action === 'PAY' ? [id, actor, paidRef ?? null] : [id, actor]);
    if (!row) throw new StateConflict('NOT_FOUND', '없는 명세서입니다.');
    return row;
  }

  /** 외부 사이트 송출(공개) — 도메인 확인 · 운영 중 퍼블리셔만(DB 가 막음) */
  async adxServe(publisherId: string, device: string | null, ip: string | null, ua: string | null) {
    const [r] = await this.db.query(
      `SELECT impression_id AS "impressionId", placement_id AS "placementId", title, body, image_key AS "imageKey", cta
         FROM fn_adx_serve($1, $2, $3::inet, $4)`, [publisherId, device, ip, ua]);
    return r ?? { impressionId: null, note: '지금 내보낼 소재가 없습니다.' };
  }

  async adxClick(publisherId: string, impressionId: number | null, device: string | null, ip: string | null, ua: string | null) {
    const [r] = await this.db.query<{ click_id: string; invalid_rule: string | null; link_url: string | null }>(
      `SELECT * FROM fn_adx_click($1, $2, $3, $4::inet, $5)`, [publisherId, impressionId, device, ip, ua]);
    /* 무효 클릭이어도 광고주 지면으로는 보냅니다 — 판정은 과금 · 지급에서만 씁니다(사람을 막지 않음) */
    return { clickId: Number(r.click_id), valid: !r.invalid_rule, rule: r.invalid_rule, redirect: r.link_url };
  }
}

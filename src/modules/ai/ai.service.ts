import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';

/**
 * AI 3화면 서버 계층 — 분류 · 추천 · 위험감지.
 *
 * ── 이름에 대해 ────────────────────────────────────────────────────
 * "AI" 라고 부르지만 학습 모델이 아닙니다. 어휘 가중치 합산입니다.
 * 화면이 그 사실을 밝히고 있으므로 응답도 같은 말을 합니다 —
 * 모든 결과에 engine · limits 를 실어 보냅니다.
 *
 * ── 어휘집과 가중치는 데이터입니다 ─────────────────────────────────
 * 프로토타입은 브라우저 상수로 들고 있었습니다.
 * 어휘 하나를 고치려고 배포하는 구조였습니다.
 * banned_words 를 데이터로 둔 것과 같은 이유로 표로 옮겼습니다.
 */
@Injectable()
export class AiService {
  constructor(private readonly db: DatabaseService) {}

  /* ── 분류 ─────────────────────────────────────────────────────── */

  /**
   * 자동 분류.
   *
   * 제한업종·금칙어를 **점수 매기기 전에** 봅니다(INV-6).
   * 점수를 먼저 매기면 "무엇으로 분류될 뻔했는가"가 로그에 남습니다.
   */
  async classify(text: string) {
    if (!text || !text.trim()) {
      throw new PolicyViolation('EMPTY_TEXT', '분류할 내용이 없습니다.');
    }

    const blocked = await this.db.query<any>(
      'SELECT source, matched, severity, reason FROM fn_classify_blocked($1)', [text]);
    if (blocked.length) {
      await this.decide('CLS', { blocked: true, reasons: blocked });
      return {
        blocked: true,
        reasons: blocked,
        engine: 'RULE',
        note: '제한업종·금칙어에 걸려 분류하지 않았습니다. 점수를 매기기 전에 막았습니다(INV-6).',
      };
    }

    const rows = await this.db.query<any>(
      `SELECT category_code AS "code", name, gwan_code AS "gwan", grade, score, matched
         FROM fn_classify($1) LIMIT 3`, [text]);

    // 어휘집에 없으면 억지로 고르지 않습니다.
    // 여기서 1위를 반환하면 "오늘 날씨가 좋습니다"가 부동산이 됩니다.
    if (!rows.length) {
      // 못 잡은 입력이 곧 추가해야 할 어휘입니다. 남기지 않으면 개선할 근거가 없습니다.
      await this.log(text, null, null, null, true);
      return {
        blocked: false,
        classified: false,
        candidates: [],
        engine: 'VOCAB_WEIGHT',
        note: '분류하지 못했습니다. 어휘집에 없는 표현입니다 — 억지로 고르지 않습니다.',
      };
    }

    /* 실제 카테고리 id 를 함께 냅니다.
     * 코드(RE·FR…)만 주면 등록 폼이 채울 값이 없습니다 —
     * 분류는 됐는데 이용자는 여전히 손으로 골라야 합니다. */
    const linked = await this.db.query<{ code: string; category_id: string | null; name: string }>(
      `SELECT code, category_id, name FROM classify_categories
        WHERE code = ANY($1)`, [rows.map(r => r.code)]);
    const linkMap = new Map(linked.map(l => [l.code, l.category_id]));

    await this.log(text, rows[0]?.code ?? null, rows[0]?.score ?? null, rows[0]?.matched ?? null, false);

    return {
      blocked: false,
      classified: true,
      candidates: rows.map(r => ({ ...r, categoryId: linkMap.get(r.code) ?? null })),
      extracted: this.extract(text),
      engine: 'VOCAB_WEIGHT',
      // 제안일 뿐입니다. 확정으로 쓰면 틀린 분류가 검수 반려로 돌아옵니다.
      confirm: false,
      limits: '학습 모델이 아닙니다. 어휘집 범위 안에서만 유효합니다. 제안이며 이용자가 고릅니다.',
    };
  }

  /** 제안과 선택을 남깁니다. 이 기록이 없으면 분류기가 맞는지 알 수 없습니다. */
  private async log(text: string, suggested: string | null, score: number | null,
                    matched: string[] | null, unclassified: boolean, chosen?: string) {
    try {
      await this.db.query(
        `INSERT INTO classify_logs(account_id, input_text, suggested, score, matched, chosen, unclassified)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [RequestCtx.actorId() ?? null, text.slice(0, 500), suggested, score,
         matched ?? null, chosen ?? null, unclassified]);
    } catch { /* 이력 실패가 분류를 막지는 않습니다 */ }
  }

  /**
   * 이용자가 실제로 고른 분류를 남깁니다.
   *
   * 제안과 다르면 그 조합이 v_classify_corrections 에 쌓이고,
   * 같은 조합이 반복되면 어휘 가중치를 손봐야 한다는 신호입니다.
   */
  async feedback(text: string, suggested: string | null, chosen: string) {
    await this.log(text, suggested, null, null, false, chosen);
    return { recorded: true,
      note: suggested && suggested !== chosen
        ? '제안과 다른 선택을 기록했습니다. 같은 조합이 반복되면 어휘를 조정합니다.'
        : '기록했습니다.' };
  }

  /** 분류기 정확도와 못 잡은 입력. 어휘를 무엇으로 늘릴지의 근거입니다. */
  async health() {
    const [acc] = await this.db.query('SELECT * FROM v_classify_accuracy');
    const misses = await this.db.query('SELECT * FROM v_classify_misses LIMIT 30');
    const corr = await this.db.query('SELECT * FROM v_classify_corrections LIMIT 20');
    const unlinked = await this.db.query('SELECT * FROM v_classify_unlinked');
    const conflicts = await this.db.query('SELECT * FROM v_classify_vocab_conflicts LIMIT 20');
    /* v10.31 (시안 SB-ADM-AIS-010 「분류 어휘」 표) — 어휘 · 분류 · 미연결 · 충돌 · 제한업종 어휘 수 */
    const [vocab] = await this.db.query<Record<string, string>>(
      `SELECT (SELECT count(*) FROM classify_vocab) AS terms,
              (SELECT count(DISTINCT category_code) FROM classify_vocab) AS cats,
              (SELECT count(*) FROM restrict_vocab) AS restrict_terms,
              (SELECT count(DISTINCT code) FROM restrict_vocab) AS restrict_codes,
              (SELECT count(*) FROM restricted_industries WHERE is_active) AS restricted,
              (SELECT count(*) FROM v_restrict_no_vocab) AS restricted_no_vocab`).catch(() => [{} as Record<string, string>]);
    return { accuracy: acc, misses, corrections: corr, unlinked, conflicts,
      vocab: Object.fromEntries(Object.entries(vocab ?? {}).map(([k, v]) => [k, Number(v)])),
      note: unlinked.length
        ? `실제 카테고리에 연결되지 않은 분류 ${unlinked.length}건 — 분류해도 등록 폼을 채우지 못합니다.`
        : null };
  }

  /** 금액·지역·규격을 문장에서 뽑습니다. 정규식이며 추론이 아닙니다. */
  private extract(text: string) {
    const money = text.match(/(\d[\d,]*)\s*(억|천만|만)?\s*원/)?.[0] ?? null;
    const area  = text.match(/(\d[\d,]*)\s*(평|㎡|m2)/)?.[0] ?? null;
    const power = text.match(/(\d[\d,.]*)\s*(kW|MW|kw|mw)/)?.[0] ?? null;
    const region = text.match(/(서울|경기|인천|부산|대구|광주|대전|울산|세종|강원|충북|충남|전북|전남|경북|경남|제주)\s*\S*/)?.[0] ?? null;
    return { money, area, power, region };
  }

  /* ── 추천 ─────────────────────────────────────────────────────── */

  /** 가중치는 데이터입니다. 만지면 순위가 바뀝니다. */
  weights() {
    return this.db.query(
      'SELECT code, name, weight FROM recommend_weights ORDER BY sort_order');
  }

  /**
   * 후보 점수 계산.
   *
   * 광고(스폰서)는 여기 들어오지 않습니다 — 다른 표에 있고,
   * ad_slots.in_ranking 이 CHECK 로 false 에 고정돼 있습니다(표시광고법).
   */
  async recommend(candidates: Array<{ id: string; name?: string; scores: Record<string, number> }>,
                  override?: Record<string, number>) {
    if (!Array.isArray(candidates) || !candidates.length) {
      throw new PolicyViolation('NO_CANDIDATE', '후보가 없습니다.');
    }
    const rows = await this.db.query<{ code: string; name: string; weight: number }>(
      'SELECT code, name, weight FROM recommend_weights ORDER BY sort_order');

    const w = Object.fromEntries(rows.map(r => [r.code, override?.[r.code] ?? r.weight]));
    const total = Object.values(w).reduce((a, b) => a + Number(b), 0);

    const scored = candidates.map(c => {
      const parts = rows.map(r => ({
        code: r.code, name: r.name,
        raw: Number(c.scores?.[r.code] ?? 0),
        weight: Number(w[r.code]),
        points: Number(c.scores?.[r.code] ?? 0) * Number(w[r.code]) / 100,
      }));
      return {
        id: c.id, name: c.name,
        total: Math.round(parts.reduce((a, p) => a + p.points, 0) * 10) / 10,
        breakdown: parts,
      };
    }).sort((a, b) => b.total - a.total);

    return {
      weights: w,
      weightSum: total,
      // 합이 100이 아니면 "100점 만점" 표기가 거짓이 됩니다. 숨기지 않고 알립니다.
      weightWarning: total !== 100
        ? `가중치 합이 ${total} 입니다. 점수는 100점 만점 기준이 아닙니다.`
        : null,
      ranked: scored,
      engine: 'WEIGHTED_SUM',
      limits: '협업 필터링이 아닙니다. 성사 데이터 전까지는 가중치를 정하는 사람이 곧 알고리즘입니다.',
      adNote: '광고(스폰서)는 이 점수에 들어가지 않고 순위에도 끼지 않습니다(표시광고법).',
    };
  }

  /* ── 위험감지 ─────────────────────────────────────────────────── */

  /** 규칙 원문과 오탐 가능성을 함께 냅니다. 숨기면 운영이 기계를 맹신합니다. */
  rules() {
    return this.db.query(
      `SELECT code, name, protects, source, false_positive AS "falsePositive",
              severity, is_active AS "isActive"
         FROM risk_rules ORDER BY sort_order`);
  }

  alerts(state?: string) {
    return this.db.query(
      `SELECT a.id, a.rule_code AS "rule", r.name AS "ruleName",
              a.severity, a.subject, a.detail, a.reason, a.action,
              a.state, a.occurred_at AS "occurredAt",
              r.source AS "ruleSource", r.false_positive AS "falsePositive"
         FROM risk_alerts a JOIN risk_rules r ON r.code = a.rule_code
        WHERE ($1::text IS NULL OR a.state = $1)
        ORDER BY a.occurred_at DESC LIMIT 100`, [state ?? null]);
  }

  /** 경보 기록. 내용은 나중에 못 고칩니다 — 처리 상태만 바뀝니다. */
  async raise(input: {
    rule: string; subject: string; detail: string; reason?: string; action?: string;
  }) {
    const [rule] = await this.db.query<{ severity: string }>(
      'SELECT severity FROM risk_rules WHERE code = $1 AND is_active', [input.rule]);
    if (!rule) throw new StateConflict('NO_SUCH_RULE', '없거나 비활성인 규칙입니다.');

    const [row] = await this.db.query<any>(
      `INSERT INTO risk_alerts(rule_code, severity, subject, detail, reason, action)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, rule_code AS "rule", state, occurred_at AS "occurredAt"`,
      [input.rule, rule.severity, input.subject, input.detail,
       input.reason ?? null, input.action ?? null]);
    return row;
  }

  /**
   * 경보 처리.
   *
   * FALSE_POSITIVE 를 별도 상태로 둡니다.
   * 오탐을 CLOSED 로 묻으면 규칙이 얼마나 헛짚는지 알 수 없습니다.
   */
  async closeAlert(id: string, state: 'CLOSED' | 'FALSE_POSITIVE') {
    const [row] = await this.db.query<any>(
      `UPDATE risk_alerts SET state = $2, closed_by = $3
        WHERE id = $1 AND state NOT IN ('CLOSED','FALSE_POSITIVE')
      RETURNING id, state, closed_at AS "closedAt"`,
      [id, state, RequestCtx.actorId()]);
    if (!row) throw new StateConflict('ALREADY_CLOSED', '이미 처리된 경보입니다.');
    return row;
  }

  /** 규칙별 오탐률. 규칙을 고칠지 판단하는 근거입니다. */
  ruleHealth() {
    return this.db.query(
      `SELECT r.code, r.name, r.severity,
              count(a.id)                                            AS raised,
              count(a.id) FILTER (WHERE a.state = 'FALSE_POSITIVE')  AS false_positives,
              round(100.0 * count(a.id) FILTER (WHERE a.state = 'FALSE_POSITIVE')
                    / NULLIF(count(a.id), 0), 1)                     AS fp_rate
         FROM risk_rules r LEFT JOIN risk_alerts a ON a.rule_code = r.code
        GROUP BY r.code, r.name, r.severity, r.sort_order
        ORDER BY r.sort_order`);
  }

  /* ── 서버 계산 추천 ───────────────────────────────────────────────
   *
   * 기존 recommend() 는 **후보와 점수를 클라이언트가 보냈습니다.**
   * 리드 배정이 이 점수로 정해지므로, 자기 점수를 100 으로 보내면
   * 1등이 됐습니다 — 돈이 걸린 조작입니다.
   *
   * 여기서는 리드 id 만 받고 후보도 점수도 DB 가 만듭니다.
   * ─────────────────────────────────────────────────────────────── */
  async match(leadId: string, limit = 10) {
    const rows = await this.db.query<any>(
      'SELECT partner_id AS "partnerId", company, total, parts ' +
      'FROM fn_match_candidates($1, $2)', [leadId, limit]);

    const weights = await this.db.query(
      'SELECT code, name, weight FROM recommend_weights ORDER BY sort_order');

    return {
      leadId,
      weights,
      candidates: rows,
      note:
        '점수는 서버가 계산합니다. 지역·업종·성사 이력·응답 속도·열람률을 ' +
        '보며, 미납 한도를 넘었거나 승인 전인 파트너는 후보에 들지 않습니다.',
    };
  }

  /**
   * 성향 세그먼트.
   *
   * ★ 동의가 없으면 저장하지 않습니다. "일단 계산해 두자" 가
   *   가장 위험합니다 — 동의 없이 만든 프로필이 남습니다(INV-AD).
   */
  async myPersona() {
    const me = RequestCtx.actorId()!;
    const [agreed] = await this.db.query<any>(
      /* v10.28 (G-214) — 가장 최근 줄(끈 뒤에는 동의 아님) */
      `SELECT 1 FROM v_term_consent_current
        WHERE account_id = $1 AND term_code = 'ADPERSONAL' AND agreed`, [me]);
    if (!agreed) {
      return { segment: null, consented: false,
        note: '맞춤형 광고에 동의하지 않으셨습니다. 전체 공개 광고가 나갑니다.' };
    }
    const [r] = await this.db.query<any>(
      'SELECT fn_derive_segment($1) AS segment', [me]);
    return {
      segment: r?.segment ?? null, consented: true,
      note: '등록하신 관과 활동으로 정해집니다. 동의를 철회하시면 즉시 사라집니다.',
    };
  }

  /**
   * 판정 이력.
   *
   * ── 원문이 아니라 해시를 남깁니다 ────────────────────────────────
   * 분류 입력에는 연락처·상호가 섞여 들어옵니다. 그대로 남기면
   * **개인정보가 이력표에 쌓입니다.** 같은 글인지 비교할 수만
   * 있으면 되므로 해시로 충분합니다.
   *
   * ── 실패해도 본 작업은 계속합니다 ────────────────────────────────
   * 이력이 안 남았다고 분류까지 실패하면 안 됩니다.
   */
  private async decide(
    kind: 'PRF' | 'CLS' | 'REC',
    result: unknown,
    opts?: { text?: string; targetType?: string; targetId?: string },
  ) {
    try {
      const hash = opts?.text
        ? require('crypto').createHash('sha256').update(opts.text).digest('hex').slice(0, 32)
        : null;
      /* 어휘집에는 갱신 시각이 없습니다. 어휘 수를 판본으로 씁니다 —
         어휘가 바뀌면 같은 글도 다르게 분류되므로, 몇 개짜리
         어휘집이었는지만 알아도 재현할 수 있습니다. */
      const [v] = await this.db.query<{ v: string }>(
        `SELECT 'vocab-' || count(*)::text AS v FROM classify_vocab`);
      await this.db.query(
        `INSERT INTO ai_decisions (kind, account_id, target_type, target_id,
                                   input_hash, result, rule_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [kind, RequestCtx.actorId() ?? null, opts?.targetType ?? null, opts?.targetId ?? null,
         hash, JSON.stringify(result), v?.v ?? null]);
    } catch {
      /* 이력이 안 남았다고 분류까지 막을 이유는 없습니다. */
    }
  }

  /**
   * v10.31 — SB-AIS-REC-010 「AI 추천 결과」(시안 scAiRec): 내 요청 1건의 사업자 후보와 5항목 점수.
   *   후보 · 항목 점수는 DB(fn_request_candidates)가 실제 자료로 냅니다. 총점 = Σ(항목 × 가중치) / Σ가중치(시안 계산 그대로).
   *   요청한 본인(또는 운영)만 봅니다 — 남의 요청에 붙을 후보 목록은 영업 정보입니다. 계정 id 는 내보내지 않습니다.
   *   mine: 내가 올린 요청(고르는 줄) — 요청 id 가 없으면 가장 최근 것.
   */
  async requestCandidates(requestId?: string) {
    const me = RequestCtx.actorId();
    if (!me) throw new Forbidden('UNAUTHENTICATED', '로그인이 필요합니다.');
    const mine = await this.db.query<{ id: string; title: string; status: string; gwanCode: string }>(
      `SELECT id, title, status, gwan_code AS "gwanCode" FROM requests
        WHERE owner_account_id = $1 AND status IN ('PUBLISHED','IN_REVIEW','CLOSED')
        ORDER BY created_at DESC LIMIT 20`, [me]);
    const id = requestId ?? mine[0]?.id;
    const weights = await this.db.query<{ code: string; name: string; weight: number }>(
      'SELECT code, name, weight::int AS weight FROM recommend_weights ORDER BY sort_order');
    if (!id) return { request: null, mine, weights, candidates: [] };
    const [req] = await this.db.query<{ id: string; title: string; gwanCode: string; region: string | null; categoryName: string | null; owner: string }>(
      `SELECT r.id, r.title, r.gwan_code AS "gwanCode", r.region, c.name AS "categoryName", r.owner_account_id AS owner
         FROM requests r LEFT JOIN categories c ON c.id = r.category_id WHERE r.id = $1`, [id]);
    if (!req) throw new NotFound('요청을 찾을 수 없습니다.');
    const role = RequestCtx.get()?.actorRole ?? '';   /* 운영 역할이 있으면 앞에 옵니다(principal.service) */
    if (req.owner !== me && role !== 'ADMIN' && role !== 'SUPER') {
      throw new Forbidden('NOT_REQUEST_OWNER', '내가 올린 요청의 추천만 볼 수 있습니다.');
    }
    const rows = await this.db.query<any>(
      `SELECT company, region, verified, listing_id AS "listingId", listing_title AS "listingTitle", category_name AS "categoryName",
              s_loc, s_cat, s_win, s_spd, s_trust, deals, reply_hours AS "replyHours", review_avg AS "reviewAvg", review_count AS "reviewCount"
         FROM fn_request_candidates($1, 200)`, [id]);
    const wsum = weights.reduce((a, w) => a + Number(w.weight), 0) || 1;
    const candidates = rows.map((r) => {
      const scores = { loc: r.s_loc, cat: r.s_cat, win: r.s_win, spd: r.s_spd, trust: r.s_trust } as Record<string, number>;
      const total = Math.round(weights.reduce((a, w) => a + Number(scores[w.code] ?? 0) * Number(w.weight), 0) / wsum * 10) / 10;
      const { s_loc, s_cat, s_win, s_spd, s_trust, ...rest } = r; void s_loc; void s_cat; void s_win; void s_spd; void s_trust;
      return { ...rest, scores, total };
    }).sort((a, b) => b.total - a.total || String(a.company).localeCompare(String(b.company))).slice(0, 6);
    const { owner, ...request } = req; void owner;
    return {
      request, mine, weights, candidates,
      note: '점수는 서버가 실제 자료(사업자 주소 · 게시 매물 업종 · 성사 확정 · 대화 응답 시간 · 인증 · 후기)로 계산합니다. 광고는 점수에 넣지 않습니다.',
    };
  }
}


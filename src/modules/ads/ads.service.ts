import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { ComplianceService } from '../catalog/compliance.service';
import { I18nService } from '../i18n/i18n.service';

/**
 * 광고 · 관심 성향 (프론트 v3.2 서버 계층).
 *
 * ── 이 서비스가 하지 않는 일 ───────────────────────────────────────
 *   · 규제 소재 차단      → fn_ad_regulated_gate · fn_ad_slot_gate
 *   · 성향 동의 검사      → fn_profile_consent_gate (v10.115 — 근거는 약관 ADPERSONAL 하나 · 끄면 DB 가 성향을 지우고 광고 기록 회원 연결을 끊음)
 *   · 광고 집계 보호      → fn_ad_events_append_only
 *   · 광고를 순위에서 배제 → ad_slots.in_ranking CHECK
 *
 * 프로토타입 문서 §6이 스스로 적어 두었습니다 —
 * "이 차단은 화면이 아니라 서버에서 다시 검사해야 합니다."
 * 그 검사는 여기가 아니라 DB에 있습니다. 여기서 또 하면 두 곳이 갈립니다.
 */
@Injectable()
export class AdsService {
  constructor(private readonly db: DatabaseService, private readonly compliance: ComplianceService, private readonly i18n: I18nService) {}
  private get me() { return RequestCtx.actorId(); }

  /** v10.115 (D123) — 맞춤형 광고 약관(ADPERSONAL)의 지금 동의 · 성향은 이것이 있을 때만 씁니다 */
  private async consentOn(account: string | null | undefined): Promise<boolean> {
    if (!account) return false;
    const [r] = await this.db.query<{ on: boolean }>(`SELECT fn_adpersonal_on($1) AS on`, [account]);
    return !!r?.on;
  }
  /** 광고 고르기 · 기록에 쓸 내 세그먼트 — 약관 동의가 없으면 null */
  private async mySegment(): Promise<string | null> {
    if (!this.me) return null;
    const [p] = await this.db.query<{ segment_code: string }>(
      `SELECT segment_code FROM member_ad_profiles WHERE account_id = $1 AND fn_adpersonal_on(account_id)`, [this.me]);
    return p?.segment_code ?? null;
  }

  /* ── 성향 ──────────────────────────────────────────────────────── */

  /** 문항과 선택지. 가중치는 내보내지 않습니다 — 답을 역산할 수 있습니다. */
  async questions() {
    const rows = await this.db.query<any>(
      `SELECT q.code, q.question, q.is_multi AS "isMulti", q.sort_order,
              o.code AS opt_code, o.label
         FROM profile_questions q
         JOIN profile_options o ON o.question_code = q.code
        ORDER BY q.sort_order, o.sort_order`);

    const map = new Map<string, any>();
    for (const r of rows) {
      if (!map.has(r.code)) {
        map.set(r.code, { code: r.code, question: r.question, isMulti: r.isMulti, options: [] });
      }
      map.get(r.code).options.push({ code: r.opt_code, label: r.label });
    }
    /* v10.118 (D124) — 승인된 번역을 얹음(문항 PROFILE_Q · 보기 PROFILE_OPT 「문항:보기」) · 한국어 · 다국어 꺼짐이면 그대로 */
    const qs = [...map.values()];
    await this.i18n.overlay(qs, 'PROFILE_Q', (q) => q.code, { question: 'question' });
    const opts = qs.flatMap((q) => q.options.map((o: any) => Object.assign(o, { _id: `${q.code}:${o.code}` })));
    await this.i18n.overlayBy(opts, 'PROFILE_OPT', '_id', { label: 'label' });
    return {
      questions: qs,
      note: '선택한 값을 더해서 가장 높은 세그먼트를 씁니다. 추론이 아닙니다. ' +
            '등록하면 맞춤형 광고 동의 뒤 광고를 누른 기록으로 성향이 바뀔 수 있으며, 여섯 문항으로 사람을 규정하지 않습니다.',
    };
  }

  /** 성향 계산. 덧셈입니다 — 동점이면 앞선 세그먼트를 씁니다. */
  private async score(answers: Record<string, string[]>) {
    /* v10.115 — 답 검사: 있는 문항 · 있는 보기만 · 한 개만 고르는 문항은 1개 · 중복 없음(점수 부풀리기 · 큰 입력 막음) */
    if (!answers || typeof answers !== 'object' || Array.isArray(answers) || Object.keys(answers).length > 20) {
      throw new PolicyViolation('BAD_ANSWER', '답의 형식이 맞지 않습니다.');
    }
    const qs = await this.db.query<{ code: string; multi: boolean; opts: string[] }>(
      `SELECT q.code, q.is_multi AS multi, array_agg(o.code) AS opts
         FROM profile_questions q JOIN profile_options o ON o.question_code = q.code GROUP BY q.code, q.is_multi`);
    const known = new Map(qs.map((q) => [q.code, q]));
    const picked: { q: string; o: string }[] = [];
    for (const [q, list] of Object.entries(answers)) {
      const def = known.get(q);
      const arr = (Array.isArray(list) ? list : [list]).filter((x) => x !== null && x !== undefined && x !== '');
      if (!def || arr.some((o) => typeof o !== 'string' || !def.opts.includes(o)) || new Set(arr).size !== arr.length
          || (!def.multi && arr.length > 1)) {
        throw new PolicyViolation('BAD_ANSWER', '없는 문항이나 보기가 있습니다. 화면을 새로 고친 뒤 다시 골라 주십시오.');
      }
      for (const o of arr) picked.push({ q, o });
    }
    if (!picked.length) throw new PolicyViolation('NO_ANSWER', '선택한 답이 없습니다.');

    const rows = await this.db.query<{ weights: Record<string, number> }>(
      `SELECT o.weights FROM profile_options o
        WHERE (o.question_code, o.code) IN (${picked.map((_, i) => `($${i * 2 + 1},$${i * 2 + 2})`).join(',')})`,
      picked.flatMap(p => [p.q, p.o]));

    const scores: Record<string, number> = {};
    for (const r of rows) {
      for (const [seg, w] of Object.entries(r.weights)) {
        scores[seg] = (scores[seg] ?? 0) + Number(w);
      }
    }

    const order = await this.db.query<{ code: string }>(
      'SELECT code FROM ad_segments ORDER BY sort_order');
    let top = order[0]?.code, best = -1;
    for (const { code } of order) {
      if ((scores[code] ?? 0) > best) { best = scores[code] ?? 0; top = code; }
    }
    return { segment: top!, scores };
  }

  /** 진단만 합니다. 저장하지 않습니다 — 등록은 별도 동의가 필요합니다. */
  async analyze(answers: Record<string, string[]>) {
    const { segment, scores } = await this.score(answers);
    const [seg] = await this.db.query<any>(
      'SELECT code, name, description FROM ad_segments WHERE code = $1', [segment]);
    /* v10.31 — 시안 PRF-010 오른쪽 칸: 세그먼트별 근거 점수 막대(ranking) · 「이 성향에 나갈 광고」(upcomingAds — 등록 화면과 같은 조회).
     *   점수는 고른 답의 가중치 합 그대로입니다(가중치 표 자체는 내보내지 않음 — 답을 역산할 수 있어서). */
    const names = await this.db.query<{ code: string; name: string }>('SELECT code, name FROM ad_segments ORDER BY code');
    await this.i18n.overlay(names, 'AD_SEGMENT', (n) => n.code, { name: 'name' });   // v10.118
    if (seg) await this.i18n.overlayOne(seg, 'AD_SEGMENT', (x: any) => x.code, { name: 'name', description: 'description' });
    const sc = (scores ?? {}) as Record<string, number>;
    const ranking = names.map((n) => ({ code: n.code, name: n.name, score: Number(sc[n.code] ?? 0) }))
      .filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));
    const upcomingAds = segment ? await this.db.query<any>(
      `SELECT creative_code AS "code", advertiser, title, slot_code AS "slot"
         FROM v_ad_serving WHERE $1 = ANY(segments) ORDER BY creative_code`, [segment]) : [];
    return { ...seg, scores, ranking, upcomingAds, saved: false,
      note: '아직 저장되지 않았습니다. 등록하면 광고를 고르는 데만 쓰입니다.' };
  }

  /**
   * 성향 등록.
   *
   * consent 없이는 저장되지 않습니다. 여기서 막지 않아도 DB가 막지만,
   * 이용자에게는 400 이 422 보다 낫습니다.
   */
  async register(answers: Record<string, string[]>, consent: boolean) {
    if (!this.me) throw new PolicyViolation('UNAUTHORIZED', '로그인이 필요합니다.');
    if (!consent) {
      throw new PolicyViolation('CONSENT_REQUIRED',
        '맞춤형 광고에 동의해야 등록됩니다. 동의하지 않아도 서비스는 그대로 이용할 수 있습니다.');
    }
    const { segment, scores } = await this.score(answers);
    const [pub] = await this.db.query(`SELECT 1 FROM v_terms_current WHERE code = 'ADPERSONAL'`);
    if (!pub) {
      throw new PolicyViolation('CONSENT_UNAVAILABLE',
        '맞춤형 광고 약관을 준비하고 있어 지금은 등록할 수 없습니다. 진단 결과는 저장하지 않고 보여 드립니다.');
    }
    return this.db.transaction(async () => {
      /* v10.115 (D123) — 설문의 동의 = 맞춤형 광고 약관(ADPERSONAL) 동의 — 판 · 시각 · 접속 정보를 약관 동의 기록에 남깁니다 */
      await this.compliance.agree([{ code: 'ADPERSONAL', agreed: true }]);
      const [row] = await this.db.query<any>(
        `INSERT INTO member_ad_profiles(account_id, segment_code, answers, scores, consented_at, source)
         VALUES ($1,$2,$3,$4, now(), 'MEMBER')
         ON CONFLICT (account_id) DO UPDATE
           SET segment_code = EXCLUDED.segment_code, answers = EXCLUDED.answers,
               scores = EXCLUDED.scores, consented_at = now(), source = 'MEMBER'
         RETURNING segment_code AS "segment", consented_at AS "consentedAt"`,
        [this.me, segment, JSON.stringify(answers), JSON.stringify(scores)]);
      return { ...row, scores,
        note: '광고를 고르는 데만 씁니다. 광고주에게 제공하지 않습니다. 「약관 동의」 화면이나 여기서 해지하면 바로 지웁니다.' };
    });
  }

  async mine() {
    if (!this.me) throw new PolicyViolation('UNAUTHORIZED', '로그인이 필요합니다.');
    const [row] = await this.db.query<any>(
      `SELECT p.segment_code AS "segment", s.name, s.description,
              p.scores, p.consented_at AS "consentedAt", p.updated_at AS "updatedAt"
         FROM member_ad_profiles p JOIN ad_segments s ON s.code = p.segment_code
        WHERE p.account_id = $1`, [this.me]);
    if (!row || !(await this.consentOn(this.me))) return { registered: false, note: '등록된 성향이 없습니다. 성향을 쓰지 않는 광고만 나갑니다.' };

    // 이 성향으로 나갈 광고를 함께 보여 줍니다 — 무엇에 쓰이는지 알 수 있어야 합니다.
    const ads = await this.db.query<any>(
      `SELECT creative_code AS "code", advertiser, title, slot_code AS "slot"
         FROM v_ad_serving WHERE $1 = ANY(segments) ORDER BY creative_code`, [row.segment]);
    /* v10.31 — 시안 PRF-020 「근거 점수」 막대에 세그먼트 이름 */
    const names = await this.db.query<{ code: string; name: string }>('SELECT code, name FROM ad_segments ORDER BY code');
    await this.i18n.overlay(names, 'AD_SEGMENT', (n) => n.code, { name: 'name' });   // v10.118
    await this.i18n.overlayOne(row, 'AD_SEGMENT', (x: any) => x.segment, { name: 'name', description: 'description' });
    const sc = (row.scores ?? {}) as Record<string, number>;
    const ranking = names.map((n) => ({ code: n.code, name: n.name, score: Number(sc[n.code] ?? 0) }))
      .filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));
    return { registered: true, ...row, ranking, upcomingAds: ads };
  }

  /**
   * 등록 해지 = 맞춤형 광고 동의 철회(v10.115 · D123).
   *   약관 동의 기록에 「거부」 줄을 남기면 DB 가 성향을 지우고 광고 기록의 회원 연결을 끊습니다(trg_adpersonal_withdrawn).
   *   약관이 발행 전이거나 이미 꺼져 있으면 성향만 지웁니다.
   */
  async withdraw() {
    if (!this.me) throw new PolicyViolation('UNAUTHORIZED', '로그인이 필요합니다.');
    return this.db.transaction(async () => {
      const [had] = await this.db.query('SELECT 1 FROM member_ad_profiles WHERE account_id = $1', [this.me]);
      const [pub] = await this.db.query(`SELECT 1 FROM v_terms_current WHERE code = 'ADPERSONAL'`);
      if (pub && (await this.consentOn(this.me))) await this.compliance.agree([{ code: 'ADPERSONAL', agreed: false }]);
      await this.db.query('DELETE FROM member_ad_profiles WHERE account_id = $1', [this.me]);
      return { deleted: !!had,
        note: '성향을 지우고 맞춤형 광고 동의를 철회했습니다. 이제 성향을 쓰지 않는 광고만 나갑니다.' };
    });
  }

  /* ── 광고 노출 ─────────────────────────────────────────────────── */

  /**
   * 슬롯에 나갈 소재 하나를 고릅니다.
   * 경매도 점수도 없습니다 — 지정입니다.
   *   성향과 겹치는 소재 → 없으면 기본 소재 → 없으면 빈 자리
   */
  async serve(slot: string) {
    /* v10.115 — 성향은 맞춤형 광고 약관에 지금 동의한 회원만. 동의가 없거나 비회원이면 성향 지정이 없는 소재만 나갑니다 */
    const seg = await this.mySegment();

    const [hit] = await this.db.query<any>(
      `SELECT id, creative_code AS "code", advertiser, title, body, cta,
              landing_route AS "landingRoute", slot_code AS "slot"
         FROM v_ad_serving
        WHERE slot_code = $1
          AND (($2::text IS NULL AND cardinality(segments) = 0) OR $2 = ANY(segments))
        ORDER BY random() LIMIT 1`, [slot, seg]);

    const AD = { title: 'title', body: 'body', cta: 'cta' };   // v10.123 (D126) 광고 자리 소재 번역
    if (hit) return { ...(await this.i18n.overlayOne(hit, 'AD_PLACEMENT', (x: any) => x.id, AD)), label: '광고', matchedSegment: seg, empty: false };

    // 성향에 맞는 소재가 없으면 세그먼트 지정이 없는 기본 소재를 씁니다.
    const [fallback] = await this.db.query<any>(
      `SELECT id, creative_code AS "code", advertiser, title, body, cta,
              landing_route AS "landingRoute", slot_code AS "slot"
         FROM v_ad_serving
        WHERE slot_code = $1 AND cardinality(segments) = 0
        ORDER BY random() LIMIT 1`, [slot]);

    if (fallback) return { ...(await this.i18n.overlayOne(fallback, 'AD_PLACEMENT', (x: any) => x.id, AD)), label: '광고', matchedSegment: null, empty: false };
    return { empty: true, note: '이 슬롯에 나갈 소재가 없습니다. 자리를 비웁니다.' };
  }

  /**
   * v10.31 — SB-ADS-LND-010 광고주 랜딩 미리보기(/ad/{id}). 지금 내보내는 소재(v_ad_serving)만 — 내린 소재 · 없는 id 는 null.
   *   광고주에게 넘기는 것은 없습니다(클릭 수만 · 이름 · 연락처 안 감). 성향 · 세그먼트는 내보내지 않습니다.
   */
  async creative(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return { found: false };
    const [c] = await this.db.query<any>(
      `SELECT id, creative_code AS "code", advertiser, title, body, cta, landing_route AS "landingRoute",
              slot_code AS "slot", category
         FROM v_ad_serving WHERE id = $1 LIMIT 1`, [id]);
    if (c) await this.i18n.overlayOne(c, 'AD_PLACEMENT', (x: any) => x.id, { title: 'title', body: 'body', cta: 'cta' });   // v10.123 · D126
    return c ? { found: true, ...c, label: '광고' } : { found: false };
  }

  /**
   * 노출·클릭 기록. 과금 근거이므로 고쳐 쓸 수 없습니다.
   *
   * ── slot 을 안 받아도 됩니다 ──────────────────────────────────────
   * 화면이 `?slot=` 을 빠뜨리면 500 이 났습니다. 그런데 **소재는
   * 자기 슬롯을 이미 알고 있습니다** — 화면에 그 값을 다시 들려
   * 보내라고 요구할 이유가 없습니다.
   *
   * 기록이 안 되면 과금 근거가 비고, 그건 광고주에게 청구할 수
   * 없다는 뜻입니다. 화면 실수로 매출이 사라지면 안 됩니다.
   */
  async track(creativeId: string, slot: string | undefined, type: 'IMPRESSION' | 'CLICK') {
    const segCode = await this.mySegment();   // v10.115 — 약관 동의가 없으면 세그먼트를 남기지 않음
    /* 슬롯을 안 보냈으면 소재에서 찾습니다. */
    let s = slot;
    if (!s) {
      const [c] = await this.db.query<{ slot_code: string }>(
        'SELECT slot_code FROM ad_placements WHERE id = $1', [creativeId]);
      s = c?.slot_code;
    }
    if (!s) throw new StateConflict('AD_NOT_FOUND', '없는 광고 소재입니다.');

    await this.db.query(
      `INSERT INTO ad_events(creative_id, slot_code, event_type, account_id, segment_code)
       VALUES ($1,$2,$3,$4,$5)`,
      [creativeId, s, type, this.me ?? null, segCode]);
    return { ok: true, slot: s };
  }

  /* ── 운영 ──────────────────────────────────────────────────────── */

  creatives() {
    return this.db.query(
      `SELECT p.creative_code AS "code", p.advertiser, p.category, p.title,
              p.slot_code AS "slot", p.status, p.is_regulated AS "regulated",
              p.review_confirmed_at AS "reviewConfirmedAt",
              p.attribution_enabled AS "attributionEnabled",
              coalesce(array_agg(s.segment_code) FILTER (WHERE s.segment_code IS NOT NULL),'{}') AS segments
         FROM ad_placements p
         LEFT JOIN ad_creative_segments s ON s.creative_id = p.id
        GROUP BY p.id ORDER BY p.creative_code`);
  }

  /** 광고주 제공용 통계. 회원 식별자·세그먼트가 없습니다. */
  stats() {
    return this.db.query('SELECT * FROM v_ad_stats_for_advertiser ORDER BY creative_code');
  }

  /**
   * 슬롯·세그먼트 지정.
   * 규제 소재 차단은 DB 트리거가 합니다 — 여기서 다시 판정하지 않습니다.
   */
  async assign(code: string, slot: string | null, segments: string[]) {
    return this.db.transaction(async () => {
      const [ad] = await this.db.query<{ id: string }>(
        'UPDATE ad_placements SET slot_code = $2 WHERE creative_code = $1 RETURNING id', [code, slot]);
      if (!ad) throw new StateConflict('NO_SUCH_CREATIVE', '없는 소재입니다.');

      await this.db.query('DELETE FROM ad_creative_segments WHERE creative_id = $1', [ad.id]);
      for (const seg of segments ?? []) {
        await this.db.query(
          'INSERT INTO ad_creative_segments(creative_id, segment_code) VALUES ($1,$2)', [ad.id, seg]);
      }
      return { code, slot, segments };
    });
  }

  /** v10.31 — 슬롯 목록(시안 「슬롯 4」 · 「슬롯 배치 7」) */
  slots() {
    return this.db.query(
      `SELECT s.code, s.name, s.placement, s.width, s.height, s.in_ranking AS "inRanking", s.is_active AS "isActive",
              s.gwan_code AS "gwanCode",
              (SELECT string_agg(p.creative_code, ' ' ORDER BY p.creative_code) FROM ad_placements p
                WHERE p.slot_code = s.code AND p.status = 'ACTIVE' AND p.creative_code IS NOT NULL) AS current
         FROM ad_slots s ORDER BY s.code`);
  }

  /** v10.31 — 소재 중지 · 다시 노출(ACTIVE ↔ PAUSED). 차단 · 준비 중 소재는 바꾸지 않습니다 */
  async setCreativeStatus(code: string, status: string) {
    const [row] = await this.db.query<any>(
      `UPDATE ad_placements SET status = $2
        WHERE creative_code = $1 AND status IN ('ACTIVE','PAUSED') RETURNING creative_code AS code, status`, [code, status]);
    if (!row) throw new StateConflict('NOT_TOGGLABLE', '노출 중이거나 중지된 소재만 바꿀 수 있습니다(차단 · 준비 중 소재는 안 됨).');
    return row;
  }

  /** 의료 심의필 확인(T-03). 이 확인 전에는 어떤 슬롯에도 붙지 않습니다. */
  async confirmReview(code: string, reviewNo: string) {
    const [row] = await this.db.query<any>(
      /* v10.32 — 반려됐던 소재를 다시 확인하면 반려 기록을 지웁니다(ck_ad_review_not_both) */
      `UPDATE ad_placements
          SET review_no = $2, review_confirmed_at = now(),
              review_rejected_at = NULL, review_reject_reason = NULL, review_rejected_by = NULL
        WHERE creative_code = $1 AND is_regulated
      RETURNING creative_code AS "code", review_no AS "reviewNo",
                review_confirmed_at AS "confirmedAt"`, [code, reviewNo]);
    if (!row) throw new StateConflict('NOT_REGULATED', '규제 소재가 아니거나 없는 소재입니다.');
    return row;
  }

  /** v10.32 — 의료 심의 반려(T-03 · 시안 admptnm 「반려」). 확인 전(대기) 규제 소재만 · 사유 필수 */
  async rejectReview(code: string, reason: string) {
    const why = reason?.trim() ?? '';
    if (why.length < 2) throw new PolicyViolation('REASON_REQUIRED', '반려 사유를 적어 주십시오.');
    const [row] = await this.db.query<any>(
      `UPDATE ad_placements
          SET review_rejected_at = now(), review_reject_reason = $2, review_rejected_by = $3
        WHERE creative_code = $1 AND is_regulated
          AND review_confirmed_at IS NULL AND review_rejected_at IS NULL
      RETURNING creative_code AS "code", review_reject_reason AS "reason",
                review_rejected_at AS "rejectedAt"`, [code, why, this.me]);
    if (!row) throw new StateConflict('NOT_PENDING', '심의 대기 중인 규제 소재가 아닙니다(이미 확인 · 반려됐거나 없는 소재).');
    return row;
  }

  /* ── 인피드 ────────────────────────────────────────────────────────
   *
   * 목록 N건마다 광고 1개를 끼워 넣습니다. 스크롤할수록 노출이 느는
   * 유일한 자리라 재고가 여기서 가장 많이 나옵니다.
   *
   * ★ 지키는 것 셋
   *   ① "광고" 표기가 항상 붙습니다. 추천과 섞이면 목록 신뢰가
   *      무너지고, 그러면 목록 자체를 안 봅니다.
   *   ② 추천 점수에 넣지 않습니다 — 돈으로 순위를 사는 것이 됩니다.
   *   ③ 1인당 하루 상한을 넘으면 그날은 더 내보내지 않습니다.
   * ───────────────────────────────────────────────────────────── */
  async infeed(count: number, gwan?: string) {
    const [cfg] = await this.db.query<any>(
      `SELECT
         (SELECT value::int FROM site_settings WHERE key='ads.infeed_every')        AS every,
         (SELECT value::int FROM site_settings WHERE key='ads.infeed_max_per_view') AS cap,
         (SELECT value::int FROM site_settings WHERE key='ads.daily_cap_per_user')  AS daily`);

    const every = cfg?.every ?? 8;
    const cap   = cfg?.cap ?? 3;
    /* 목록 길이로 몇 개가 들어갈지 정합니다.
       25건을 보면 3개 — 더 넣으면 목록이 광고판이 됩니다. */
    const want = Math.min(cap, Math.floor(count / every));
    if (want <= 0) return { slots: [], every, note: '목록이 짧아 광고를 넣지 않습니다.' };

    const rows = await this.db.query<any>(
      /* ★ 본체의 소재 표는 `ad_placements` 입니다.
       *   `ad_creatives` 는 **분리한 광고 플랫폼(sgb-ads)** 쪽 이름이라
       *   여기서는 존재하지 않습니다 — 분리하면서 남은 참조였습니다.
       *
       *   예약(ad_bookings)과 조인하면 팔린 자리만 나가는데, 지금은
       *   선계약 전이라 아무것도 안 나갑니다. 예약이 있으면 그것을,
       *   없으면 활성 소재를 씁니다. */
      `SELECT p.id, p.title, p.body, p.image_key AS "imageKey",
              p.landing_route AS "landingUrl", p.advertiser
         FROM ad_placements p
        WHERE p.slot_code = 'INFEED'
          AND p.status = 'ACTIVE'
          AND (p.starts_at IS NULL OR p.starts_at <= (now() AT TIME ZONE 'Asia/Seoul')::date)
          AND (p.ends_at   IS NULL OR p.ends_at   >= (now() AT TIME ZONE 'Asia/Seoul')::date)
        ORDER BY random() LIMIT $1`, [want]);
    await this.i18n.overlay(rows, 'AD_PLACEMENT', (r: any) => r.id, { title: 'title', body: 'body' });   // v10.123 · D126

    return {
      every,
      /* 자리 번호를 함께 줍니다 — 화면이 계산하면 매번 달라집니다. */
      slots: rows.map((r, i) => ({
        position: (i + 1) * every,
        label: '광고',                    // ★ 항상 붙습니다
        ...r,
      })),
    };
  }

  /** 성향 조회 — 동의 여부까지 여기서 판단합니다. */
  async adProfileFor(accountId: string) {
    const [r] = await this.db.query<any>(
      `SELECT p.segment_code AS segment,
              (t.agreed_at IS NOT NULL) AS consented
         FROM accounts a
         LEFT JOIN member_ad_profiles p ON p.account_id = a.id
         LEFT JOIN v_term_consent_current t ON t.account_id = a.id      /* v10.28 (G-214) — 가장 최근 줄 */
                AND t.term_code = 'ADPERSONAL' AND t.agreed
        WHERE a.id = $1`, [accountId]);
    /* ★ 동의가 없으면 성향을 아예 내보내지 않습니다.
     *   "있는데 안 쓰겠지" 로 두면 언젠가 씁니다. */
    if (!r?.consented) return { segment: null, consented: false };
    return { segment: r.segment ?? null, consented: true };
  }

  /** 사업자 실재·휴폐업 확인. */
  async checkBizFor(bizId: string) {
    const [r] = await this.db.query<any>(
      /* nts_status 가 휴·폐업이면 active=false 입니다.
       * 국세청이 알려주는 값이라 우리가 따로 판단하지 않습니다. */
      `SELECT company_name AS name,
              (verified_at IS NOT NULL
               AND coalesce(nts_status, 'UNKNOWN') NOT IN ('CLOSED','SUSPENDED')) AS active
         FROM businesses WHERE id = $1`, [bizId]);
    return r ? { exists: true, name: r.name, active: r.active }
             : { exists: false, name: null, active: false };
  }

  /**
   * 광고 귀속 켜기 · 끄기 (INV-AD12).
   *
   * 켜면 이 광고로 들어온 소개가 **이 광고주의 이 건에만** 귀속됩니다.
   * 끄면 광고 클릭은 귀속을 만들지 않습니다 — DB 트리거가 막습니다.
   */
  async setAttribution(code: string, enabled: boolean) {
    const [r] = await this.db.query<any>(
      `UPDATE ad_placements SET attribution_enabled = $2
        WHERE creative_code = $1
        RETURNING creative_code AS code, advertiser,
                  attribution_enabled AS enabled,
                  advertiser_business_id AS "advertiserBizId"`,
      [code, enabled]);
    if (!r) throw new StateConflict('AD_NOT_FOUND', '없는 광고 소재입니다.');

    /* 광고주가 없으면 켜도 귀속이 안 됩니다 — 트리거가 막습니다.
       켜 두고 "왜 안 붙나" 를 나중에 묻게 되므로 지금 알립니다. */
    if (enabled && !r.advertiserBizId) {
      return { ...r,
        warning: '이 소재에 광고주 사업자가 연결돼 있지 않아 귀속이 생기지 않습니다.' };
    }
    return r;
  }
}

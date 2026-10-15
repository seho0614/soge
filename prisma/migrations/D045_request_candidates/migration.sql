-- v10.31 (w1 · 10/10 시안 기준 지시) — SB-AIS-REC-010 「AI 추천 결과」: 요청 1건에 붙일 사업자 후보를 5항목 점수로 줄 세웁니다.
--   시안 scAiRec: 요청 줄 · 가중치 밀대 5개(지역 적합 30 · 카테고리 일치 30 · 성사 이력 20 · 응답 속도 10 · 신뢰지표 10 — recommend_weights 그대로) ·
--   후보 카드(항목별 점수 막대 · 총점 · 성사 n건 · 평균 응답 · 인증 표시) · 광고는 점수 밖.
--   전에는 화면에 「정렬 기준」 표만 있고 후보가 없었습니다(결함 중). 견본 숫자를 넣지 않고 **실제 자료로 계산**합니다.
--
-- 후보 = 그 요청의 관에 게시 중인 매물을 가진 사업자(요청자 본인 제외). 항목 점수(0 ~ 100):
--   loc   지역 적합   요청 지역(시 · 구)과 사업자 주소: 시 · 구까지 같으면 100 · 시도만 같으면 60 · 다르면 0 · 요청에 지역이 없으면 50 · 사업자 주소가 없으면 0
--   cat   카테고리    같은 업종 매물이 있으면 100 · 같은 관만이면 50(요청에 업종이 없으면 50)
--   win   성사 이력   성사 확정 건수 × 20 (5건이면 100)
--   spd   응답 속도   받은 대화에 첫 답을 한 평균 시간: 0시간 100 → 72시간 이상 0 (직선) · 답한 기록이 없으면 0
--   trust 신뢰지표   사업자 인증 40 + 후기 평균 별점 / 5 × 60(후기가 없으면 0)
-- 총점은 화면이 가중치로 가중 평균(합 / 가중치 합)을 냅니다 — 가중치를 움직이면 순위가 바로 다시 계산됩니다(시안).

CREATE OR REPLACE FUNCTION public.fn_request_candidates(p_request uuid, p_limit int DEFAULT 6)
RETURNS TABLE(account_id uuid, company text, region text, verified boolean, listing_id uuid, listing_title text, category_name text,
              s_loc int, s_cat int, s_win int, s_spd int, s_trust int, deals int, reply_hours numeric, review_avg numeric, review_count int)
LANGUAGE sql STABLE AS $$
  WITH r AS (
    SELECT q.gwan_code, q.category_id, q.owner_account_id,
           nullif(split_part(coalesce(q.region,''), ' ', 1), '') AS r_sido,
           nullif(split_part(coalesce(q.region,''), ' ', 2), '') AS r_sgg
      FROM requests q WHERE q.id = p_request
  ), cand AS (
    SELECT l.owner_account_id AS acc,
           bool_or(r.category_id IS NOT NULL AND l.category_id = r.category_id) AS same_cat,
           (array_agg(l.id ORDER BY (l.category_id = r.category_id) DESC NULLS LAST, l.published_at DESC))[1] AS lid
      FROM listings l CROSS JOIN r
     WHERE l.status = 'PUBLISHED' AND l.gwan_code = r.gwan_code AND l.owner_account_id <> r.owner_account_id
     GROUP BY l.owner_account_id
  ), reply AS (
    SELECT c.counterpart_id AS acc,
           avg(extract(epoch FROM (fr.at - f0.at)) / 3600.0) AS hrs
      FROM conversations c
      JOIN LATERAL (SELECT min(m.created_at) AS at FROM messages m WHERE m.conversation_id = c.id AND m.sender_id = c.initiator_id) f0 ON true
      JOIN LATERAL (SELECT min(m.created_at) AS at FROM messages m WHERE m.conversation_id = c.id AND m.sender_id = c.counterpart_id
                       AND m.created_at >= f0.at) fr ON fr.at IS NOT NULL
     WHERE c.counterpart_id IN (SELECT acc FROM cand)
     GROUP BY c.counterpart_id
  ), rv AS (
    SELECT target_id AS acc, avg(rating)::numeric AS avg_r, count(*)::int AS n
      FROM deal_reviews WHERE target_id IN (SELECT acc FROM cand) GROUP BY target_id
  )
  SELECT cand.acc, coalesce(b.company_name, '개인'),
         nullif(btrim(concat_ws(' ', b.sido, b.sigungu)), ''),
         (b.verified_at IS NOT NULL),
         cand.lid, l.title, cat.name,
         CASE WHEN r.r_sido IS NULL THEN 50
              WHEN b.sido IS NULL OR b.sido = '' THEN 0
              WHEN left(b.sido, 2) = left(r.r_sido, 2) AND (r.r_sgg IS NULL OR coalesce(b.sigungu, '') LIKE r.r_sgg || '%') THEN 100
              WHEN left(b.sido, 2) = left(r.r_sido, 2) THEN 60 ELSE 0 END,
         CASE WHEN r.category_id IS NULL THEN 50 WHEN cand.same_cat THEN 100 ELSE 50 END,
         least(100, coalesce(st.confirmed_deals, 0)::int * 20),
         CASE WHEN reply.hrs IS NULL THEN 0 ELSE greatest(0, round(100 - reply.hrs * 100 / 72))::int END,
         ((CASE WHEN b.verified_at IS NOT NULL THEN 40 ELSE 0 END) + coalesce(round(rv.avg_r / 5 * 60), 0))::int,
         coalesce(st.confirmed_deals, 0)::int,
         round(reply.hrs::numeric, 1), round(rv.avg_r, 1), coalesce(rv.n, 0)
    FROM cand CROSS JOIN r
    JOIN listings l ON l.id = cand.lid
    JOIN categories cat ON cat.id = l.category_id
    LEFT JOIN businesses b ON b.account_id = cand.acc
    LEFT JOIN v_introducer_stats st ON st.account_id = cand.acc
    LEFT JOIN reply ON reply.acc = cand.acc
    LEFT JOIN rv ON rv.acc = cand.acc
    LEFT JOIN accounts a ON a.id = cand.acc
   WHERE a.status = 'ACTIVE' AND a.withdrawn_at IS NULL
   ORDER BY 1
   LIMIT 200;
$$;

COMMENT ON FUNCTION public.fn_request_candidates IS
  'SB-AIS-REC-010 — 요청 1건의 사업자 후보와 5항목 점수(0~100). 총점 · 순위는 가중치(recommend_weights · 화면 밀대)로 화면 · API 가 냅니다. 견본 숫자 없음.';

-- ── C942_seg_multi · 소재가 여러 세그먼트를 겨냥할 때 ───────────────
--
-- ★ 시험에서 학습이 0건이었습니다. 원인을 보니
--
--     소재 AD-102 → SEG-A, SEG-B 둘 다 겨냥
--     SEG-A 회원이 6번 클릭
--     → v_segment_behavior 에 SEG-A 6회 · SEG-B 6회 로 **둘 다** 잡힘
--     → "원래보다 3배" 조건에 걸리지 않음
--
--   **클릭 하나로는 어느 세그먼트가 끌었는지 모릅니다.**
--   광고가 두 사람을 동시에 겨냥했기 때문입니다.
--
-- ── 어떻게 푸나 ─────────────────────────────────────────────────────
--   그 소재가 **현재 세그먼트를 겨냥하지 않는** 경우만 셉니다.
--
--     SEG-A 회원이 SEG-B 전용 소재를 눌렀다  → 신호
--     SEG-A 회원이 SEG-A·B 소재를 눌렀다     → 신호 아님
--
--   후자는 자기 세그먼트 광고를 본 것일 수도 있습니다.
--   **애매하면 안 옮깁니다** — 잘못 옮기면 엉뚱한 광고가 갑니다.

CREATE OR REPLACE VIEW v_segment_behavior AS
SELECT e.account_id,
       p.segment_code AS current_code,
       cs.segment_code AS clicked_code,
       count(*)::int AS clicks,
       /* 그 소재가 현재 세그먼트도 겨냥하는가 */
       bool_or(EXISTS (
         SELECT 1 FROM ad_creative_segments x
          WHERE x.creative_id = e.creative_id
            AND x.segment_code = p.segment_code)) AS ambiguous
  FROM ad_events e
  JOIN member_ad_profiles p ON p.account_id = e.account_id
  JOIN ad_creative_segments cs ON cs.creative_id = e.creative_id
 WHERE e.event_type = 'CLICK'
   AND e.occurred_at >= now() - interval '90 days'
   AND e.account_id IS NOT NULL
   AND e.anonymized_at IS NULL
 GROUP BY e.account_id, p.segment_code, cs.segment_code, e.creative_id;

COMMENT ON VIEW v_segment_behavior IS
  '회원별 광고 클릭을 세그먼트로 묶은 것. **ambiguous 가 true 면 '
  '그 소재가 현재 세그먼트도 겨냥한 것**이라 신호로 쓰지 않습니다 — '
  '클릭 하나로는 어느 쪽이 끌었는지 모릅니다.';

CREATE OR REPLACE VIEW v_segment_shift_candidates AS
WITH cfg AS (
  SELECT
    (SELECT coalesce(value,'5')::int FROM site_settings
      WHERE key='segment.learn.min_clicks') AS min_c,
    (SELECT coalesce(value,'3')::int FROM site_settings
      WHERE key='segment.learn.ratio') AS ratio
),
/* 다른 세그먼트 **전용** 소재를 누른 것만 셉니다 */
other AS (
  SELECT account_id, current_code, clicked_code, sum(clicks)::int AS clicks
    FROM v_segment_behavior
   WHERE clicked_code <> current_code
     AND NOT ambiguous
   GROUP BY account_id, current_code, clicked_code
),
own AS (
  SELECT account_id, sum(clicks)::int AS clicks
    FROM v_segment_behavior
   WHERE clicked_code = current_code
   GROUP BY account_id
),
best AS (
  SELECT DISTINCT ON (o.account_id)
         o.account_id, o.current_code, o.clicked_code, o.clicks
    FROM other o
   ORDER BY o.account_id, o.clicks DESC
)
SELECT b.account_id, b.current_code,
       b.clicked_code AS to_code,
       coalesce(w.clicks,0) AS clicks_from,
       b.clicks AS clicks_to
  FROM best b
  LEFT JOIN own w ON w.account_id = b.account_id
  CROSS JOIN cfg
 WHERE b.clicks >= cfg.min_c
   AND b.clicks >= greatest(coalesce(w.clicks,0) * cfg.ratio, cfg.min_c);

COMMENT ON VIEW v_segment_shift_candidates IS
  '세그먼트를 옮길 대상. **다른 세그먼트 전용 소재**를 원래보다 '
  '몇 배 많이 누른 사람만 고릅니다 — 애매하면 안 옮깁니다.';

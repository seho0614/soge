-- =====================================================================
-- C940_segment_learn  ·  성향 세그먼트 자동 학습
--
-- ── 사장님 지시 (2026-09-23) ────────────────────────────────────────
--   분류 학습(C930)처럼 **성향도 스스로 고쳐지게** 합니다.
--
-- ── 무엇을 배우나 ───────────────────────────────────────────────────
--   질문 6개로 정한 세그먼트가 **실제 행동과 맞는지** 봅니다.
--
--     SEG-A(부동산) 로 잡힌 사람이
--     실제로는 창업 광고만 누른다면
--     → 그 사람의 세그먼트를 SEG-B 로 옮깁니다.
--
--   질문은 가입할 때 한 번 답한 것이고, **사업은 바뀝니다.**
--   행동이 더 최근 사실입니다.
--
-- ── ★ 개인정보를 늘리지 않습니다 ────────────────────────────────────
--   이미 있는 ad_events(노출·클릭)만 씁니다. 새로 모으는 것이
--   없습니다 — 있는 것을 다르게 읽을 뿐입니다.
--
--   광고주는 여전히 집계만 받습니다. 세그먼트가 바뀌어도
--   "누가" 는 나가지 않습니다.
-- =====================================================================

-- ── ① 세그먼트 교정 이력 ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS segment_shift_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  from_code     text,
  to_code       text NOT NULL,
  clicks_from   int NOT NULL DEFAULT 0,   -- 원래 세그먼트 광고 클릭
  clicks_to     int NOT NULL DEFAULT 0,   -- 옮겨갈 세그먼트 광고 클릭
  applied_at    timestamptz NOT NULL DEFAULT now(),
  reverted_at   timestamptz,
  reverted_by   uuid REFERENCES accounts(id),

  CONSTRAINT shift_diff_check CHECK (from_code IS DISTINCT FROM to_code)
);

COMMENT ON TABLE segment_shift_log IS
  '성향 세그먼트가 행동으로 바뀐 기록. **질문은 가입할 때 한 번 '
  '답한 것이고 사업은 바뀝니다** — 행동이 더 최근 사실입니다. '
  '되돌릴 수 있게 남깁니다.';

CREATE INDEX IF NOT EXISTS idx_shift_account
  ON segment_shift_log(account_id, applied_at DESC);

-- ── ② 설정 ────────────────────────────────────────────────────────
INSERT INTO site_settings (key, value, scope, description, value_example, value_pattern)
VALUES
 ('segment.learn.enabled', 'on', 'GLOBAL',
  '성향 자동 학습. off 로 두면 가입할 때 답한 세그먼트가 그대로 '
  '유지됩니다.',
  'on', '^(on|off)$'),
 ('segment.learn.min_clicks', '5', 'GLOBAL',
  '옮기려면 다른 세그먼트 광고를 몇 번 눌러야 하는지. '
  '**한두 번으로 옮기지 마십시오** — 지나가다 누른 것일 수 있습니다.',
  '5', '^[1-9][0-9]?$'),
 ('segment.learn.ratio', '3', 'GLOBAL',
  '몇 배 차이나야 옮길지. 3 이면 원래 세그먼트보다 3배 많이 '
  '눌렀을 때만 옮깁니다.',
  '3', '^[1-9]$')
ON CONFLICT (key) DO NOTHING;

-- ── ③ 행동 집계 ───────────────────────────────────────────────────
--
-- ★ 클릭만 봅니다. 노출은 우리가 보여 준 것이라 그 사람의
--   관심이 아닙니다 — 노출로 배우면 우리가 보여 준 것을
--   우리가 다시 배우는 꼴입니다.
CREATE OR REPLACE VIEW v_segment_behavior AS
SELECT e.account_id,
       p.segment_code AS current_code,
       cs.segment_code AS clicked_code,
       count(*)::int AS clicks
  FROM ad_events e
  JOIN member_ad_profiles p ON p.account_id = e.account_id
  JOIN ad_creative_segments cs ON cs.creative_id = e.creative_id
 WHERE e.event_type = 'CLICK'
   AND e.occurred_at >= now() - interval '90 days'
   AND e.account_id IS NOT NULL
   AND e.anonymized_at IS NULL
 GROUP BY e.account_id, p.segment_code, cs.segment_code;

COMMENT ON VIEW v_segment_behavior IS
  '회원별 광고 클릭을 세그먼트로 묶은 것. **클릭만 봅니다** — '
  '노출은 우리가 보여 준 것이라 그 사람의 관심이 아닙니다.';

-- ── ④ 옮길 대상 ───────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_segment_shift_candidates AS
WITH cfg AS (
  SELECT
    (SELECT coalesce(value,'5')::int FROM site_settings
      WHERE key='segment.learn.min_clicks') AS min_c,
    (SELECT coalesce(value,'3')::int FROM site_settings
      WHERE key='segment.learn.ratio') AS ratio
),
me AS (
  SELECT account_id, current_code,
         sum(clicks) FILTER (WHERE clicked_code = current_code) AS own,
         max(clicks) FILTER (WHERE clicked_code <> current_code) AS other_max
    FROM v_segment_behavior
   GROUP BY account_id, current_code
)
SELECT m.account_id, m.current_code,
       b.clicked_code AS to_code,
       coalesce(m.own,0)::int AS clicks_from,
       b.clicks AS clicks_to
  FROM me m
  JOIN v_segment_behavior b
    ON b.account_id = m.account_id AND b.clicks = m.other_max
   AND b.clicked_code <> m.current_code
  CROSS JOIN cfg
 WHERE b.clicks >= cfg.min_c
   AND b.clicks >= greatest(coalesce(m.own,0) * cfg.ratio, cfg.min_c);

COMMENT ON VIEW v_segment_shift_candidates IS
  '세그먼트를 옮길 대상. 원래 세그먼트보다 **몇 배 많이 누른** '
  '사람만 고릅니다 — 한두 번은 지나가다 누른 것일 수 있습니다.';

-- ── ⑤ 학습 실행 ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_segment_learn() RETURNS TABLE(
  out_account uuid, out_from text, out_to text, out_cf int, out_ct int
) AS $$
DECLARE v_on text;
BEGIN
  SELECT value INTO v_on FROM site_settings WHERE key='segment.learn.enabled';
  IF coalesce(v_on,'off') <> 'on' THEN RETURN; END IF;

  RETURN QUERY
  WITH cand AS (SELECT * FROM v_segment_shift_candidates),
  upd AS (
    UPDATE member_ad_profiles p
       SET segment_code = c.to_code,
           /* ★ 출처를 바꿉니다. 나중에 "내가 이렇게 답했나?" 할 때
              질문이 아니라 행동으로 바뀐 것임을 알 수 있습니다. */
           source = 'BEHAVIOR',
           updated_at = now()
      FROM cand c
     WHERE p.account_id = c.account_id
       /* 동의한 사람만입니다. 동의를 뺀 사람은 성향 자체를 안 씁니다. */
       AND p.consented_at IS NOT NULL
    RETURNING p.account_id, c.current_code AS f, c.to_code AS t,
              c.clicks_from AS cf, c.clicks_to AS ct
  ),
  logged AS (
    INSERT INTO segment_shift_log (account_id, from_code, to_code, clicks_from, clicks_to)
    SELECT u.account_id, u.f, u.t, u.cf, u.ct FROM upd u
    RETURNING account_id, from_code, to_code, clicks_from, clicks_to
  )
  SELECT l.account_id, l.from_code, l.to_code, l.clicks_from, l.clicks_to
    FROM logged l;
END $$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_segment_learn IS
  '행동으로 세그먼트를 옮깁니다. **동의한 회원만** 대상이고, '
  'source 를 BEHAVIOR 로 바꿔 질문이 아닌 행동으로 바뀐 것임을 '
  '남깁니다.';

-- ── ⑥ 감시 ────────────────────────────────────────────────────────

/* 동의 안 한 사람의 성향을 건드리면 안 됩니다. */
CREATE OR REPLACE VIEW v_segment_learn_no_consent AS
SELECT s.account_id, s.to_code, s.applied_at
  FROM segment_shift_log s
  JOIN member_ad_profiles p ON p.account_id = s.account_id
 WHERE p.consented_at IS NULL AND s.reverted_at IS NULL;

COMMENT ON VIEW v_segment_learn_no_consent IS
  '동의하지 않은 회원의 세그먼트가 바뀐 기록. **0이어야 합니다** — '
  '동의를 뺀 사람은 성향 자체를 쓰지 않습니다.';

/* 한 사람이 자주 옮겨 다니면 기준이 잘못된 것입니다. */
CREATE OR REPLACE VIEW v_segment_shift_thrash AS
SELECT account_id, count(*)::int AS shifts
  FROM segment_shift_log
 WHERE applied_at >= now() - interval '30 days'
   AND reverted_at IS NULL
 GROUP BY account_id
HAVING count(*) >= 3;

COMMENT ON VIEW v_segment_shift_thrash IS
  '한 달에 3번 이상 세그먼트가 바뀐 회원. **0이어야 합니다** — '
  '왔다 갔다 하면 기준(min_clicks · ratio)이 너무 느슨한 것입니다.';

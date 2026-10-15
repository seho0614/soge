-- =====================================================================
-- C930_classify_learn  ·  분류 자동 학습
--
-- ── 사장님 지시 (2026-09-23) ────────────────────────────────────────
--   ① 분류가 자주 틀린다
--   ② "AI" 라고 부르고 싶다
--   ③ 어휘집을 손으로 늘리는 게 번거롭다
--
--   → 운영이 고칠 때마다 **어휘집이 스스로 늘어나게** 합니다.
--
-- ── ★ 신경망이 아닙니다 ─────────────────────────────────────────────
--   "운영 판단을 학습해 정확도가 올라가는 분류 엔진" 입니다.
--   거짓이 아니고, **왜 그 분류인지 단어로 설명됩니다** —
--   신경망은 그걸 못 합니다.
--
-- ── 폭주를 막는 것이 먼저입니다 ─────────────────────────────────────
--   한 번 고쳤다고 바로 바꾸면 **운영자 한 사람의 실수가
--   전체 분류를 망칩니다.** 그래서
--     · 같은 방향으로 3회 이상일 때만 반영
--     · 한 단어의 점수에 상한
--     · 되돌릴 수 있게 이력 보존
--     · 제한업종(INV-6)은 학습 대상에서 제외
-- =====================================================================

-- ── ① 학습 신호 ───────────────────────────────────────────────────
--
-- 운영이 분류를 고치면 그 글의 단어마다 한 줄이 쌓입니다.
CREATE TABLE IF NOT EXISTS classify_signals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  term        text NOT NULL,
  from_code   text,                  -- AI 가 제안한 분류
  to_code     text NOT NULL,         -- 사람이 고른 분류
  /* ★ classify_logs.id 는 bigint 입니다 — uuid 로 두면
     외래키가 안 걸립니다. */
  log_id      bigint REFERENCES classify_logs(id) ON DELETE SET NULL,
  actor_id    uuid REFERENCES accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sig_diff_check CHECK (from_code IS DISTINCT FROM to_code)
);

COMMENT ON TABLE classify_signals IS
  '분류 교정 신호. 운영이 고칠 때마다 그 글의 단어가 쌓입니다 — '
  '**한 줄로는 아무것도 바꾸지 않습니다.** 3회 이상 같은 방향일 때 '
  '어휘집에 반영됩니다.';

CREATE INDEX IF NOT EXISTS idx_sig_term ON classify_signals(term, to_code);

-- ── ② 학습 이력 ───────────────────────────────────────────────────
--
-- ★ 되돌릴 수 있어야 합니다. 학습이 폭주하면 무엇이 언제
--   바뀌었는지 알아야 되돌립니다.
CREATE TABLE IF NOT EXISTS classify_learn_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  term        text NOT NULL,
  category_code text NOT NULL,
  before_w    int,                   -- NULL 이면 새로 생긴 것
  after_w     int NOT NULL,
  signals     int NOT NULL,          -- 몇 번의 교정으로 바뀌었나
  applied_at  timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  reverted_by uuid REFERENCES accounts(id)
);

COMMENT ON TABLE classify_learn_log IS
  '학습으로 바뀐 기록. **되돌리려면 무엇이 언제 바뀌었는지 '
  '알아야 합니다** — 학습이 잘못 가도 여기로 복구합니다.';

-- ── ③ 설정 ────────────────────────────────────────────────────────
INSERT INTO site_settings (key, value, scope, description, value_example, value_pattern)
VALUES
 ('classify.learn.enabled', 'on', 'GLOBAL',
  '분류 자동 학습. off 로 두면 어휘집이 그대로 멈춥니다 — '
  '학습이 이상하게 가면 먼저 이것을 끄고 원인을 보십시오.',
  'on', '^(on|off)$'),
 ('classify.learn.min_signals', '3', 'GLOBAL',
  '몇 번 고쳐야 반영할지. **1 로 두지 마십시오** — 운영자 한 사람의 '
  '실수가 바로 전체 분류를 바꿉니다.',
  '3', '^[1-9][0-9]?$'),
 ('classify.learn.max_weight', '9', 'GLOBAL',
  '한 단어의 점수 상한. 한 단어가 전부를 정하면 다른 단어가 '
  '무의미해집니다.',
  '9', '^[1-9]$')
ON CONFLICT (key) DO NOTHING;

-- ── ④ 단어 뽑기 ───────────────────────────────────────────────────
--
-- ★ 조사·숫자·한 글자는 뺍니다. "의 · 를 · 이" 가 어휘집에
--   들어가면 모든 글이 모든 분류에 걸립니다.
CREATE OR REPLACE FUNCTION fn_classify_terms(p_text text)
RETURNS TABLE(term text) AS $$
  SELECT DISTINCT t FROM (
    SELECT btrim(regexp_replace(w, '[^가-힣A-Za-z0-9]', '', 'g')) AS t
      FROM regexp_split_to_table(coalesce(p_text,''), '\s+') AS w
  ) x
   WHERE length(t) >= 2
     AND t !~ '^[0-9]+$'
     /* 흔한 말은 분별력이 없습니다 */
     AND t NOT IN ('있습니다','합니다','입니다','때문','그리고','하지만',
                   '해주세요','부탁','문의','관련','가능','필요','우리','저희');
$$ LANGUAGE sql IMMUTABLE;

-- ── ⑤ 학습 반영 ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_classify_learn() RETURNS TABLE(
  term text, category_code text, before_w int, after_w int, signals int
) AS $$
DECLARE
  v_on   text;
  v_min  int;
  v_max  int;
BEGIN
  SELECT value INTO v_on FROM site_settings WHERE key='classify.learn.enabled';
  IF coalesce(v_on,'off') <> 'on' THEN RETURN; END IF;

  SELECT coalesce(value,'3')::int INTO v_min
    FROM site_settings WHERE key='classify.learn.min_signals';
  SELECT coalesce(value,'9')::int INTO v_max
    FROM site_settings WHERE key='classify.learn.max_weight';

  RETURN QUERY
  WITH agg AS (
    SELECT s.term, s.to_code, count(*)::int AS n
      FROM classify_signals s
     WHERE s.created_at >= now() - interval '90 days'
       /* ★ 제한업종은 학습하지 않습니다(INV-6).
          사람이 고쳤다고 대부·다단계를 열어 줄 수는 없습니다. */
       AND s.to_code NOT LIKE 'X-%'
     GROUP BY s.term, s.to_code
    HAVING count(*) >= v_min
  ),
  upd AS (
    INSERT INTO classify_vocab (category_code, term, weight)
    SELECT a.to_code, a.term, least(a.n, v_max)
      FROM agg a
    ON CONFLICT (category_code, term) DO UPDATE
      SET weight = least(classify_vocab.weight + 1, v_max)
    RETURNING category_code, term, weight
  )
  INSERT INTO classify_learn_log (term, category_code, before_w, after_w, signals)
  SELECT u.term, u.category_code,
         (SELECT weight FROM classify_vocab v
           WHERE v.term=u.term AND v.category_code=u.category_code),
         u.weight,
         (SELECT n FROM agg a WHERE a.term=u.term AND a.to_code=u.category_code)
    FROM upd u
  RETURNING classify_learn_log.term, classify_learn_log.category_code,
            classify_learn_log.before_w, classify_learn_log.after_w,
            classify_learn_log.signals;
END $$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_classify_learn IS
  '교정 신호를 어휘집에 반영합니다. **3회 이상 같은 방향일 때만**, '
  '점수 상한까지만 올립니다. 제한업종(X-)은 학습하지 않습니다.';

-- ── ⑥ 감시 ────────────────────────────────────────────────────────

/* 한 단어가 너무 강해지면 다른 단어가 무의미해집니다. */
CREATE OR REPLACE VIEW v_classify_overweight AS
SELECT category_code, term, weight
  FROM classify_vocab
 WHERE weight > (SELECT coalesce(value,'9')::int FROM site_settings
                  WHERE key='classify.learn.max_weight');

COMMENT ON VIEW v_classify_overweight IS
  '상한을 넘은 어휘. **0이어야 합니다** — 한 단어가 전부를 정하면 '
  '다른 단어가 무의미해집니다.';

/* 학습이 갑자기 몰리면 무언가 잘못된 것입니다. */
CREATE OR REPLACE VIEW v_classify_learn_burst AS
SELECT date_trunc('day', applied_at)::date AS d, count(*)::int AS n
  FROM classify_learn_log
 WHERE applied_at >= now() - interval '7 days'
   AND reverted_at IS NULL
 GROUP BY 1
HAVING count(*) > 50;

COMMENT ON VIEW v_classify_learn_burst IS
  '하루에 50개 넘게 학습된 날. **0이어야 합니다** — 정상이라면 '
  '하루 몇 개입니다. 몰렸다면 누가 일괄로 고쳤거나 오작동입니다.';

/* 제한업종이 학습돼 들어가면 INV-6 가 뚫립니다. */
CREATE OR REPLACE VIEW v_classify_blocked_learned AS
SELECT v.category_code, v.term
  FROM classify_vocab v
 WHERE v.category_code LIKE 'X-%'
   AND EXISTS (SELECT 1 FROM classify_learn_log l
                WHERE l.term = v.term AND l.category_code = v.category_code
                  AND l.reverted_at IS NULL);

COMMENT ON VIEW v_classify_blocked_learned IS
  '학습으로 제한업종에 들어간 어휘. **0이어야 합니다** — '
  '사람이 고쳤다고 대부·다단계를 열어 줄 수는 없습니다(INV-6).';

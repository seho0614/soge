-- ── C931_learn_fix · 함수 안 이름 충돌 ─────────────────────────────
--
-- ★ RETURNS TABLE(term ...) 의 term 과 컬럼 term 이 겹쳐
--   plpgsql 이 어느 쪽인지 모릅니다. 반환 이름에 out_ 를 붙입니다.

DROP FUNCTION IF EXISTS fn_classify_learn();

CREATE OR REPLACE FUNCTION fn_classify_learn() RETURNS TABLE(
  out_term text, out_code text, out_before int, out_after int, out_signals int
) AS $$
DECLARE
  v_on  text;
  v_min int;
  v_max int;
BEGIN
  SELECT value INTO v_on FROM site_settings WHERE key='classify.learn.enabled';
  IF coalesce(v_on,'off') <> 'on' THEN RETURN; END IF;

  SELECT coalesce(value,'3')::int INTO v_min
    FROM site_settings WHERE key='classify.learn.min_signals';
  SELECT coalesce(value,'9')::int INTO v_max
    FROM site_settings WHERE key='classify.learn.max_weight';

  RETURN QUERY
  WITH agg AS (
    SELECT s.term AS t, s.to_code AS code, count(*)::int AS n
      FROM classify_signals s
     WHERE s.created_at >= now() - interval '90 days'
       /* ★ 제한업종은 학습하지 않습니다(INV-6). */
       AND s.to_code NOT LIKE 'X-%'
     GROUP BY s.term, s.to_code
    HAVING count(*) >= v_min
  ),
  before AS (
    SELECT a.t, a.code, a.n, v.weight AS w0
      FROM agg a
      LEFT JOIN classify_vocab v ON v.term=a.t AND v.category_code=a.code
  ),
  upd AS (
    INSERT INTO classify_vocab (category_code, term, weight)
    SELECT b.code, b.t, least(b.n, v_max) FROM before b
    ON CONFLICT (category_code, term) DO UPDATE
      SET weight = least(classify_vocab.weight + 1, v_max)
    RETURNING category_code AS code, term AS t, weight AS w1
  ),
  logged AS (
    INSERT INTO classify_learn_log (term, category_code, before_w, after_w, signals)
    SELECT u.t, u.code, b.w0, u.w1, b.n
      FROM upd u JOIN before b ON b.t=u.t AND b.code=u.code
    RETURNING term, category_code, before_w, after_w, signals
  )
  SELECT l.term, l.category_code, l.before_w, l.after_w, l.signals FROM logged l;
END $$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_classify_learn IS
  '교정 신호를 어휘집에 반영합니다. **3회 이상 같은 방향일 때만**, '
  '점수 상한까지만 올립니다. 제한업종(X-)은 학습하지 않습니다.';

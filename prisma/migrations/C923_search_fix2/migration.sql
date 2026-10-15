-- ── C923_search_fix2 · 두 글자 오타 ────────────────────────────────
--
-- ★ C922 로 오작동은 막았는데 **두 글자 오타를 못 잡게** 됐습니다.
--     까패 → 카페     못 잡음
--     급쳐 → 급매     못 잡음
--
-- ── 실제로 무엇이 걸리는지 세어 보니 ───────────────────────────────
--     급매 ~ 급처 → 급매      ← 결과가 자기 자신. 무해합니다.
--     까패 ~ 까페 → 카페      ← 고쳐야 할 오타
--     점보 ~ 점포 → 상가      ← 고쳐야 할 오타
--     창고 ~ 창업 → 소개창업   ★ 잘못
--     창고 ~ 중고 → 소개몰     ★ 잘못
--     카페 ~ 까페 → 카페      ← 결과가 자기 자신. 무해합니다.
--
--   잘못된 둘은 **결과의 kind 가 GWAN** 입니다. 관 판정은
--   `fn_classify` 가 따로 하므로, 오타 교정에서는 관을 빼면 됩니다.
--
--   두 글자에서 관까지 추측하면 너무 멀리 갑니다 — "창고"를 보고
--   "이 사람은 소개창업을 찾는구나" 라고 할 수는 없습니다.

CREATE OR REPLACE FUNCTION fn_search_normalize(p_term text)
RETURNS TABLE(canonical text, kind text, how text) AS $$
  SELECT canonical, kind, how FROM (
    /* ① 정확히 맞는 동의어 */
    SELECT s.canonical, s.kind, '동의어'::text AS how,
           1 AS pri, s.weight
      FROM search_synonyms s
     WHERE lower(btrim(s.term)) = lower(btrim(p_term))
    UNION ALL
    /* ② 오타 — 거리 1 */
    SELECT s.canonical, s.kind, '오타 교정'::text,
           2 AS pri, s.weight
      FROM search_synonyms s
     WHERE length(p_term) BETWEEN 2 AND 12
       AND levenshtein(s.term, p_term) = 1
       /* 이미 우리 말이면 건드리지 않습니다 */
       AND NOT EXISTS (SELECT 1 FROM search_synonyms u
                        WHERE u.canonical = p_term)
       AND s.canonical <> p_term
       /* ★ 두 글자에서는 관(GWAN)을 추측하지 않습니다.
          "창고"를 보고 "소개창업을 찾는구나" 라고 할 수 없습니다.
          관 판정은 fn_classify 가 문장 전체를 보고 합니다. */
       AND NOT (length(p_term) <= 2 AND s.kind = 'GWAN')
  ) x
  ORDER BY pri, weight DESC
  LIMIT 1;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION fn_search_normalize IS
  '검색어를 우리 말로 바꿉니다. **두 글자에서는 관을 추측하지 '
  '않습니다** — "창고"가 "소개창업"으로 가던 것을 막습니다. '
  '관 판정은 fn_classify 가 문장 전체를 보고 합니다.';

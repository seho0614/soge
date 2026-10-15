-- ── C922_search_fix · 오타 교정 오작동 ─────────────────────────────
--
-- ★ 시험에서 **정상 단어가 오타로 바뀌었습니다.**
--
--     창고 → 소개창업   (levenshtein 1 — "창업"과 한 글자 차이)
--     카페 → 카페       (자기 자신을 오타로 봄)
--
--   원인 둘
--     ① 결과가 이미 우리 말이면 바꿀 이유가 없는데 그대로 통과
--     ② 짧은 말(2글자)은 거리 1 이 너무 관대합니다 —
--        두 글자 중 하나가 다르면 절반이 다른 것입니다.
--
--   **30건으로는 이것을 못 봅니다.** 사전에 40개를 넣고 나서야
--   "창고" 가 "소개창업" 으로 가는 것이 보였습니다.

CREATE OR REPLACE FUNCTION fn_search_normalize(p_term text)
RETURNS TABLE(canonical text, kind text, how text) AS $$
  SELECT canonical, kind, how FROM (
    /* ① 정확히 맞는 동의어 */
    SELECT s.canonical, s.kind, '동의어'::text AS how,
           1 AS pri, s.weight
      FROM search_synonyms s
     WHERE lower(btrim(s.term)) = lower(btrim(p_term))
    UNION ALL
    /* ② 오타 — 세 글자 이상만. 두 글자는 거리 1 이 절반입니다. */
    SELECT s.canonical, s.kind, '오타 교정'::text,
           2 AS pri, s.weight
      FROM search_synonyms s
     WHERE length(p_term) BETWEEN 3 AND 12
       AND levenshtein(s.term, p_term) = 1
       /* ★ 이미 우리 말이면 바꾸지 않습니다.
          "카페"가 "까페"와 거리 1 이라 자기 자신으로 갔습니다. */
       AND NOT EXISTS (SELECT 1 FROM search_synonyms u
                        WHERE u.canonical = p_term)
       /* 결과가 입력과 같으면 바꿀 이유가 없습니다. */
       AND s.canonical <> p_term
  ) x
  ORDER BY pri, weight DESC
  LIMIT 1;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION fn_search_normalize IS
  '검색어를 우리 말로 바꿉니다. **세 글자 이상만 오타로 봅니다** — '
  '두 글자는 거리 1 이 절반이라 "창고"가 "소개창업"으로 갑니다. '
  '이미 우리 말인 것도 건드리지 않습니다.';

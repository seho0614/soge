-- =====================================================================
-- C971_search_like · 부분 일치 패턴 이스케이프 (K4)
--
-- ★ 지금은 검색어를 '%' || q || '%' 로 그대로 잇습니다. 검색어에 % 나 _ 가
--   있으면 와일드카드로 읽혀 '%%' 한 번에 **전건**이 나옵니다.
--   이 함수가 % · _ · 역슬래시를 글자로 바꿉니다 (LIKE 기본 이스케이프 문자 = 역슬래시).
-- =====================================================================
CREATE OR REPLACE FUNCTION fn_search_like(p text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT '%' || replace(replace(replace(lower(btrim(coalesce(p,''))),
         '\', '\\'), '%', '\%'), '_', '\_') || '%'
$$;
COMMENT ON FUNCTION fn_search_like IS
  '부분 일치 패턴. % _ \ 를 글자로 취급합니다(K4). 소문자로 바꾸므로 lower(식) LIKE 와 짝입니다.';

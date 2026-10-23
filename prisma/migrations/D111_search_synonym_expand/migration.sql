-- =====================================================================
-- D111 — v10.83 검색 정리: 동의어 · 오타 교정을 실제 검색에 · 추천 검색어 숨기기 (2026-10-23 · docs/137)
--
--   대표 결정(2026-10-23 「검색 기능」 → 「전체 점검」 → 「승인」)
--
--   ① 동의어 사전(search_synonyms)과 오타 교정(fn_search_normalize)이 **검색어 통계에만** 쓰이고 실제 검색 결과에는
--      쓰이지 않았습니다(운영 화면은 「다음 검색부터 적용됩니다」라고 안내). → 검색어를 낱말마다 「원래 말|동의어|교정어」로
--      넓혀(fn_search_expand — 서버가 검색 한 번에 한 번 부름) 공용 판정 fn_search_match 가 그중 하나라도 있으면 맞다고 봅니다.
--      관(GWAN) 종류는 넓히지 않습니다(관 이름이 글 안에 있을 까닭이 없음 · 관 판정은 fn_classify).
--   ② fn_search_match · fn_search_head · fn_search_rank — 「|」 대안을 읽게(대안이 없는 검색어는 전과 똑같이 동작).
--      첫 낱말에 대안이 있으면 색인용 앞 거르기(fn_search_head)는 비웁니다(대안 중 무엇이 들었는지 LIKE 하나로 못 거름).
--   ③ search_term_stats.hidden — 운영 화면에서 추천 검색어를 숨김(시험 꼬리표 · 오픈 전 시험 기간 말). 지우지 않음.
--
--   자료를 지우지 않습니다. 재실행 안전(ADD COLUMN IF NOT EXISTS · CREATE OR REPLACE · 같은 이름 · 같은 인자).
-- =====================================================================

ALTER TABLE public.search_term_stats ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.search_term_stats.hidden IS
  '추천 검색어에서 숨김(D111 · 운영 화면 「검색 사전」 · 오픈 직전 open-prep.sh). 통계는 그대로 쌓입니다.';

/* 낱말 하나의 대안 — 원래 말을 맨 앞에. 두 글자 미만 · 띄어쓰기 · | 가 든 말은 대안으로 쓰지 않음 · 최대 8개 */
CREATE OR REPLACE FUNCTION public.fn_search_alts(p_word text) RETURNS text
  LANGUAGE sql STABLE AS $$
  WITH w AS (SELECT lower(btrim(coalesce(p_word, ''))) AS t),
  n AS (SELECT lower(btrim(x.canonical)) AS a FROM w, fn_search_normalize(w.t) x WHERE x.kind <> 'GWAN'),
  base AS (SELECT t AS a FROM w UNION SELECT a FROM n),
  more AS (SELECT lower(btrim(s.term)) AS a FROM search_synonyms s
            WHERE s.kind <> 'GWAN' AND lower(btrim(s.canonical)) IN (SELECT a FROM base)
           UNION
           SELECT lower(btrim(s.canonical)) FROM search_synonyms s
            WHERE s.kind <> 'GWAN' AND lower(btrim(s.term)) IN (SELECT a FROM base)),
  pick AS (SELECT a, (a = (SELECT t FROM w)) AS me FROM (SELECT a FROM base UNION SELECT a FROM more) u
            WHERE length(a) >= 2 AND position('|' in a) = 0 AND position(' ' in a) = 0
            ORDER BY (a = (SELECT t FROM w)) DESC, a LIMIT 8)
  SELECT CASE WHEN length((SELECT t FROM w)) < 2 THEN (SELECT t FROM w)
              ELSE (SELECT string_agg(a, '|' ORDER BY me DESC, a) FROM pick) END
$$;

/* 검색어 전체 — 낱말마다 대안. 서버가 검색 한 번에 한 번 부르고 결과를 fn_search_match 에 넘깁니다(줄마다 부르지 않게) */
CREATE OR REPLACE FUNCTION public.fn_search_expand(p_kw text) RETURNS text
  LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN coalesce(btrim(p_kw), '') = '' THEN NULL ELSE (
    SELECT string_agg(coalesce(fn_search_alts(w.t), lower(w.t)), ' ' ORDER BY w.i)
      FROM unnest(string_to_array(regexp_replace(btrim(replace(p_kw, '|', ' ')), '\s+', ' ', 'g'), ' ')) WITH ORDINALITY AS w(t, i)
     WHERE w.t <> '') END
$$;

CREATE OR REPLACE FUNCTION public.fn_search_match(p_title text, p_body text, p_kw text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE
    WHEN coalesce(btrim(p_kw), '') = '' THEN true
    ELSE NOT EXISTS (
      SELECT 1 FROM unnest(string_to_array(btrim(p_kw), ' ')) AS w(t)
       WHERE length(btrim(split_part(w.t, '|', 1))) >= 2               -- 원래 말이 두 글자 미만이면 건너뜀(전과 같음)
         AND NOT EXISTS (                                               -- D111 — 대안(|) 중 하나라도 들었으면 맞음
           SELECT 1 FROM unnest(string_to_array(btrim(w.t), '|')) AS a(x)
            WHERE length(btrim(a.x)) >= 2
              AND position(lower(btrim(a.x)) in lower(coalesce(p_title,'') || ' ' || coalesce(p_body,''))) > 0)
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.fn_search_head(p_kw text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE WHEN position('|' in split_part(btrim(coalesce(p_kw,'')), ' ', 1)) > 0 THEN ''   -- D111 — 대안이 있으면 앞 거르기 안 함
              ELSE lower(btrim(split_part(btrim(coalesce(p_kw,'')), ' ', 1))) END;
$$;

CREATE OR REPLACE FUNCTION public.fn_search_rank(p_title text, p_kw text) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE
    WHEN coalesce(btrim(p_kw), '') = '' THEN 0
    ELSE coalesce(
      (SELECT min(nullif(position(lower(btrim(a.x)) in lower(coalesce(p_title,''))), 0))
         FROM unnest(string_to_array(split_part(btrim(p_kw), ' ', 1), '|')) AS a(x)
        WHERE btrim(a.x) <> ''),
      9999)
  END;
$$;

COMMENT ON FUNCTION public.fn_search_expand(text) IS
  '검색어를 낱말마다 「원래 말|동의어|교정어」로 넓힘(D111). 서버가 검색 한 번에 한 번 부릅니다 — 줄마다 부르지 마십시오.';
COMMENT ON FUNCTION public.fn_search_match(text, text, text) IS
  '한글 부분 일치 검색 — 낱말이 **모두** 들어 있어야(두 글자 미만 낱말은 건너뜀) · 낱말 안의 | 는 대안(D111). pg_trgm 은 로케일 C 에서 한글을 못 쪼갬.';

-- =====================================================================
-- C970_search_bigm · 한글 검색 색인 (K2)
--
-- ★ 실측 (2026-09-25 · 5만 건 · PostgreSQL 16)
--   기존 trigram 색인은 한글 2글자 검색에서 **쓰이지 않습니다**
--     로케일 C       '%공장%'  Seq Scan  56ms   (show_trgm('상가임대') = {})
--     로케일 UTF-8   '%공장%'  Seq Scan 140ms   (4글자는 색인 사용)
--   pg_bigm 색인                Bitmap Index Scan 3.4ms
--
-- ★ 개발 DB(embedded-postgres)·CI(postgres:16 이미지)에는 pg_bigm 이
--   없습니다. 없으면 색인 없이 넘어갑니다 — 검색 SQL 은 그대로 동작하고
--   (순차 탐색) 운영에서만 색인을 탑니다.
--   운영 RDS 는 파라미터 그룹 shared_preload_libraries 에 pg_bigm 을
--   먼저 넣고, 마스터 계정으로 CREATE EXTENSION 한 뒤 이 파일을 적용합니다.
--   (순서가 바뀌면 색인 없이 기록됩니다 → 같은 내용의 새 파일로 다시)
--
-- ★ 색인 식은 검색 SQL 의 식과 글자 하나까지 같아야 탑니다.
--   trigram 색인은 영문·숫자 검색에 여전히 쓰이므로 지우지 않습니다.
-- =====================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_bigm') THEN
    CREATE EXTENSION IF NOT EXISTS pg_bigm;
    -- 목록·노출 엔진 (listing.repository.organic · exposure.engine)
    CREATE INDEX IF NOT EXISTS idx_listings_search_bigm ON listings
      USING gin (lower(coalesce(title,'') || ' ' || coalesce(body,'')) gin_bigm_ops);
    CREATE INDEX IF NOT EXISTS idx_requests_search_bigm ON requests
      USING gin (lower(coalesce(title,'') || ' ' || coalesce(body,'')) gin_bigm_ops);
    -- 통합 검색 (public.service.search)
    CREATE INDEX IF NOT EXISTS idx_listings_title_bigm ON listings USING gin (lower(title) gin_bigm_ops);
    CREATE INDEX IF NOT EXISTS idx_requests_title_bigm ON requests USING gin (lower(title) gin_bigm_ops);
  ELSE
    RAISE NOTICE 'C970: pg_bigm 없음 — 색인 없이 진행합니다(개발·CI). 운영은 v_search_bigm_status 확인';
  END IF;
END $$;

CREATE OR REPLACE VIEW v_search_bigm_status AS
SELECT (SELECT count(*) FROM pg_extension WHERE extname = 'pg_bigm')::int AS extension,
       (SELECT count(*) FROM pg_indexes WHERE indexname IN
          ('idx_listings_search_bigm','idx_requests_search_bigm',
           'idx_listings_title_bigm','idx_requests_title_bigm'))::int AS indexes;
COMMENT ON VIEW v_search_bigm_status IS
  '한글 검색 색인 상태. 운영은 extension=1 · indexes=4. 개발·CI 는 0/0 이 정상입니다.';

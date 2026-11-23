-- =====================================================================
-- D312 (v10.653 · docs/793 7절) 관 페이지 그림 — 편집 화면 안에서 바로 올림
--
--   대표 11/24 「편집 화면 안에서 바로 올리는 기능을 가지는 편집 화면」.
--   새 파일 용도 PAGE_IMAGE(올리기 ADMIN · SUPER · JPG · PNG 5MB) — 공개 주소 GET /api/v1/site/page-images/{파일 번호}(용도 PAGE_IMAGE · READY 만 · 서버가 봄)
--   ck_files_purpose 는 지금 목록을 읽어 PAGE_IMAGE 만 더함(D301 과 같은 방식 — 다른 묶음이 먼저 더한 용도를 지우지 않음)
--   지우는 문장 없음 · 다시 돌려도 같음 · RAISE 글자에 퍼센트 기호 없음
-- =====================================================================

DO $do$
DECLARE v_def text; v_list text[]; v_sql text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint WHERE conname = 'ck_files_purpose' AND conrelid = 'public.files'::regclass;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'PAGE_MIGRATE: ck_files_purpose 검사가 없습니다 — 마이그레이션 순서를 확인하십시오.';
  END IF;
  IF position('PAGE_IMAGE' IN v_def) = 0 THEN
    SELECT array_agg(DISTINCT m[1]) INTO v_list FROM regexp_matches(v_def, '''([A-Z_]+)''', 'g') AS m;
    IF coalesce(cardinality(v_list), 0) < 10 THEN
      RAISE EXCEPTION 'PAGE_MIGRATE: 파일 용도 목록을 읽지 못했습니다 — 손으로 확인하십시오.';
    END IF;
    v_list := v_list || 'PAGE_IMAGE'::text;
    SELECT 'ALTER TABLE public.files DROP CONSTRAINT ck_files_purpose, ADD CONSTRAINT ck_files_purpose CHECK (purpose = ANY (ARRAY['
           || string_agg(quote_literal(x), ',' ORDER BY x) || ']))' INTO v_sql FROM unnest(v_list) AS x;
    EXECUTE v_sql;
  END IF;
END $do$;
INSERT INTO public.file_policies (purpose, content_type, max_bytes, ext) VALUES
  ('PAGE_IMAGE', 'image/jpeg', 5242880, 'jpg'), ('PAGE_IMAGE', 'image/png', 5242880, 'png')
ON CONFLICT DO NOTHING;

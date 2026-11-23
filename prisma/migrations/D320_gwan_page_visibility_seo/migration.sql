-- =====================================================================
-- D320 (v10.691 · v10.692 · docs/801) 관 페이지 공개 범위 · 검색엔진 설정 직접 쓰기
--
--   대표 11/24 「다음개발 후보」 → 「모두개발」.
--   ② gwan_pages.visibility — ALL(누구나 · 처음 값) · MEMBER(로그인한 회원만 · 아니면 로그인 안내 · 사이트 지도 · 검색에서 빠짐) · 첫 화면(home)은 ALL 만(DB)
--   ③ gwan_pages.seo_description(160자) · seo_image(관 안 주소 /… 또는 https) · noindex(검색엔진에 안 나오게) — 비우면 전처럼 블록에서 자동
--      게시와 상관없이 바로 반영(페이지 머리 정보 · 사이트 지도)
--   ⑤ 설정 ops.gwan_weekly(관별 주간 보고 · 처음 on) · 지우는 문장 없음 · 다시 돌려도 같음 · RAISE 글자에 퍼센트 없음
-- =====================================================================

ALTER TABLE public.gwan_pages ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'ALL';
ALTER TABLE public.gwan_pages ADD COLUMN IF NOT EXISTS seo_description text;
ALTER TABLE public.gwan_pages ADD COLUMN IF NOT EXISTS seo_image text;
ALTER TABLE public.gwan_pages ADD COLUMN IF NOT EXISTS noindex boolean NOT NULL DEFAULT false;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gwan_pages_visibility_check') THEN
    ALTER TABLE public.gwan_pages ADD CONSTRAINT gwan_pages_visibility_check CHECK (visibility IN ('ALL', 'MEMBER') AND (slug <> 'home' OR visibility = 'ALL'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gwan_pages_seo_check') THEN
    ALTER TABLE public.gwan_pages ADD CONSTRAINT gwan_pages_seo_check CHECK (
      (seo_description IS NULL OR char_length(seo_description) <= 160)
      AND (seo_image IS NULL OR (char_length(seo_image) <= 300 AND (seo_image ~ '^/[^/]' OR seo_image ~ '^https://'))));
  END IF;
END $$;
COMMENT ON COLUMN public.gwan_pages.visibility IS 'v10.691 (D320) ALL 누구나 · MEMBER 로그인한 회원만(첫 화면은 ALL 만)';
COMMENT ON COLUMN public.gwan_pages.noindex IS 'v10.692 (D320) 검색엔진에 안 나오게(robots noindex · 사이트 지도에서 뺌)';

-- v10.694 (docs/801) 관별 주간 보고 스위치 — 처음 on(담당자가 없으면 아무것도 안 함 · 알림 · 메일만)
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('ops.gwan_weekly', 'on', 'ADMIN', '관별 주간 보고(v10.694 · docs/801) — 월요일 아침 대표 할 일 주간 작업에 이어 관 담당자마다 맡은 관의 지난 7일 숫자(운영 알림 GWAN_WEEKLY · 메일이 준비됐으면 담당자 메일) · 담당자가 없으면 아무것도 안 함 · off 면 안 보냄', false, '^(on|off)$', 'on')
ON CONFLICT (key) DO NOTHING;

-- =====================================================================
-- D313 (v10.657 · docs/794) 관 페이지 언어판 — 영어 등 다른 언어 화면에 그 언어 페이지
--
--   대표 11/24 「모두개발」 ② 관 페이지 번역. 블록 글이 칸마다 흩어져 번역 검수 화면 대신 페이지마다 언어판을 둠:
--     gwan_pages.lang(처음 값 ko) · 같은 관 · 주소에 언어마다 한 페이지(UNIQUE (gwan_code, slug, lang)) · 언어판은 한국어판이 먼저(DB)
--     언어판은 한국어판 초안을 복사해 만들고 번역해 게시(서버) · 사용자 웹은 화면 언어 판이 게시돼 있으면 그것, 없으면 한국어판
--   칸 하나 더함 · 고유 조건을 (관 · 주소) → (관 · 주소 · 언어)로 바꿈 · fn_gwan_page_guard 에 언어 잠금 · 한국어판 먼저(나머지는 D311 그대로)
--   지우는 문장 없음(고유 조건을 바꾸는 ALTER 만) · 다시 돌려도 같음 · RAISE 글자에 퍼센트 기호 없음
-- =====================================================================

ALTER TABLE public.gwan_pages ADD COLUMN IF NOT EXISTS lang text NOT NULL DEFAULT 'ko';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gwan_pages_lang_fmt') THEN
    ALTER TABLE public.gwan_pages ADD CONSTRAINT gwan_pages_lang_fmt CHECK (lang ~ '^[a-z]{2}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gwan_pages_slug_lang_uniq') THEN
    ALTER TABLE public.gwan_pages ADD CONSTRAINT gwan_pages_slug_lang_uniq UNIQUE (gwan_code, slug, lang);
  END IF;
END $$;
ALTER TABLE public.gwan_pages DROP CONSTRAINT IF EXISTS gwan_pages_slug_uniq;
COMMENT ON COLUMN public.gwan_pages.lang IS 'v10.657 (D313) 페이지 언어 — ko 한국어판(처음) · 그 밖은 언어판(한국어판을 복사해 번역 · 만든 뒤 바꾸지 않음)';

CREATE OR REPLACE FUNCTION public.fn_gwan_page_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  v_hub boolean; v_new boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.gwan_code IS DISTINCT FROM OLD.gwan_code OR NEW.slug IS DISTINCT FROM OLD.slug OR NEW.lang IS DISTINCT FROM OLD.lang) THEN
    RAISE EXCEPTION 'GWAN_PAGE_LOCKED: 페이지의 관 · 주소 · 언어는 만든 뒤 바꿀 수 없습니다 — 새 페이지를 만드십시오.';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT coalesce(is_hub, false), intro_target IS NOT NULL INTO v_hub, v_new FROM public.gwans WHERE code = NEW.gwan_code;
    IF v_hub THEN
      RAISE EXCEPTION 'GWAN_PAGE_HUB: 허브 관에는 페이지를 두지 않습니다 — 하위 관에 만드십시오.';
    END IF;
    IF NEW.slug = 'home' AND NOT coalesce(v_new, false) THEN
      RAISE EXCEPTION 'GWAN_PAGE_HOME: 첫 화면 편집은 운영 화면에서 만든 새 관만 됩니다 — 처음 관은 따로 꾸민 첫 화면을 씁니다.';
    END IF;
    /* v10.657 (D313) 언어판 — 한국어판(ko)이 먼저 있어야 함 */
    IF NEW.lang <> 'ko' AND NOT EXISTS (SELECT 1 FROM public.gwan_pages k WHERE k.gwan_code = NEW.gwan_code AND k.slug = NEW.slug AND k.lang = 'ko') THEN
      RAISE EXCEPTION 'GWAN_PAGE_LANG_KO: 한국어판을 먼저 만드십시오 — 언어판은 한국어판을 복사해 번역합니다.';
    END IF;
  END IF;
  IF NEW.status = 'PUBLISHED' AND NEW.published_version IS NULL THEN
    RAISE EXCEPTION 'GWAN_PAGE_NOT_PUBLISHED: 게시된 판이 없어 게시 상태로 둘 수 없습니다.';
  END IF;
  RETURN NEW;
END $fn$;

-- 권한 주소 표 — v10.659 안 쓰는 페이지 그림(보기 · 정리)
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/gwan-pages/images/unused', 'gwan-ux', 'VIEW'),
  ('GET', '/admin/gwan-pages/images/unused', 'gwans', 'VIEW'),
  ('POST', '/admin/gwan-pages/images/purge', 'gwan-ux', 'EDIT')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

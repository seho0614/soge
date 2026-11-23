-- =====================================================================
-- D311 (v10.650 · docs/793) 관 페이지 — 새 관 첫 화면 블록 편집 · 관 안 페이지 등록(초안 → 게시 · 판 기록)
--
--   대표 11/24 「새로운 관 생성시 페이지 등록기능 · 페이지 편집기능 추가」 → 「둘 다 · ADMIN 작성 · SUPER 게시」 → 「모두 적용」:
--     ① 첫 화면(slug = home)은 운영 화면에서 만든 새 관(gwans.intro_target 있음)만 — 처음 관은 따로 꾸민 첫 화면이 있음
--     ② 관 안 페이지(slug = 주소 조각)는 모든 관(허브 관 빼고 — 허브는 사용자 웹 주소가 없음)
--     ③ 초안은 ADMIN · SUPER 가 고치고, 게시는 SUPER 만(서버) · SUPER 혼자 고치고 바로 게시해도 됨(두 사람 확인 없음)
--   gwan_pages(페이지 · 초안) · gwan_page_versions(게시된 판 · 쌓기만 — 고치기 · 지우기 막음)
--   블록은 jsonb 배열(30개까지 · 종류 HERO · TEXT · BUTTONS · IMAGE · LISTINGS · CATEGORIES · NOTICES · FAQ — 안쪽 칸 검사는 서버)
--   표 2 · 함수 2 · 트리거 2 · 지우는 문장 없음 · 다시 돌려도 같음 · RAISE 글자에 퍼센트 기호 없음
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.gwan_pages (
  id                 bigserial PRIMARY KEY,
  gwan_code          text NOT NULL REFERENCES public.gwans(code),
  slug               text NOT NULL CHECK (slug ~ '^(home|[a-z0-9][a-z0-9-]{1,39})$'),
  title              text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 60),
  show_in_menu       boolean NOT NULL DEFAULT true,
  sort_order         int NOT NULL DEFAULT 0,
  status             text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'HIDDEN')),
  draft              jsonb NOT NULL DEFAULT '[]'::jsonb,
  draft_updated_by   uuid REFERENCES public.accounts(id),
  draft_updated_at   timestamptz NOT NULL DEFAULT now(),
  published_version  int,
  published_at       timestamptz,
  published_by       uuid REFERENCES public.accounts(id),
  created_by         uuid REFERENCES public.accounts(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gwan_pages_slug_uniq UNIQUE (gwan_code, slug),
  CONSTRAINT gwan_pages_draft_arr CHECK (jsonb_typeof(draft) = 'array' AND jsonb_array_length(draft) <= 30)
);
COMMENT ON TABLE public.gwan_pages IS 'v10.650 (D311 · docs/793) 관 페이지 — slug home = 새 관 첫 화면(intro_target 있는 관만) · 그 밖은 /g/<관>/info/<slug> 또는 처음 관 /<경로>/info/<slug> · 초안(draft) · 게시된 판 번호(published_version)';

CREATE TABLE IF NOT EXISTS public.gwan_page_versions (
  id            bigserial PRIMARY KEY,
  page_id       bigint NOT NULL REFERENCES public.gwan_pages(id),
  version       int NOT NULL,
  title         text NOT NULL,
  blocks        jsonb NOT NULL CHECK (jsonb_typeof(blocks) = 'array'),
  published_by  uuid REFERENCES public.accounts(id),
  published_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gwan_page_versions_uniq UNIQUE (page_id, version)
);
COMMENT ON TABLE public.gwan_page_versions IS 'v10.650 (D311) 관 페이지 게시 판 — 쌓기만(고치기 · 지우기 막음) · 예전 판은 「이 판으로 초안 만들기」';

CREATE OR REPLACE FUNCTION public.fn_gwan_page_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  v_hub boolean; v_new boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.gwan_code IS DISTINCT FROM OLD.gwan_code OR NEW.slug IS DISTINCT FROM OLD.slug) THEN
    RAISE EXCEPTION 'GWAN_PAGE_LOCKED: 페이지의 관과 주소는 만든 뒤 바꿀 수 없습니다 — 새 페이지를 만드십시오.';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT coalesce(is_hub, false), intro_target IS NOT NULL INTO v_hub, v_new FROM public.gwans WHERE code = NEW.gwan_code;
    IF v_hub THEN
      RAISE EXCEPTION 'GWAN_PAGE_HUB: 허브 관에는 페이지를 두지 않습니다 — 하위 관에 만드십시오.';
    END IF;
    IF NEW.slug = 'home' AND NOT coalesce(v_new, false) THEN
      RAISE EXCEPTION 'GWAN_PAGE_HOME: 첫 화면 편집은 운영 화면에서 만든 새 관만 됩니다 — 처음 관은 따로 꾸민 첫 화면을 씁니다.';
    END IF;
  END IF;
  IF NEW.status = 'PUBLISHED' AND NEW.published_version IS NULL THEN
    RAISE EXCEPTION 'GWAN_PAGE_NOT_PUBLISHED: 게시된 판이 없어 게시 상태로 둘 수 없습니다.';
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_gwan_page_guard ON public.gwan_pages;
CREATE TRIGGER trg_gwan_page_guard BEFORE INSERT OR UPDATE ON public.gwan_pages
  FOR EACH ROW EXECUTE FUNCTION public.fn_gwan_page_guard();

CREATE OR REPLACE FUNCTION public.fn_gwan_page_ver_ro() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'GWAN_PAGE_VERSION_RO: 게시된 판은 고치거나 지울 수 없습니다 — 새 판을 게시하십시오.';
END $fn$;
DROP TRIGGER IF EXISTS trg_gwan_page_ver_ro ON public.gwan_page_versions;
CREATE TRIGGER trg_gwan_page_ver_ro BEFORE UPDATE OR DELETE ON public.gwan_page_versions
  FOR EACH ROW EXECUTE FUNCTION public.fn_gwan_page_ver_ro();

-- 권한 주소 표(perm_route_map) — 관 관리 작업(gwan-ux · gwans)
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/gwans/{code}/pages', 'gwan-ux', 'VIEW'),
  ('GET', '/admin/gwans/{code}/pages', 'gwans', 'VIEW'),
  ('POST', '/admin/gwans/{code}/pages', 'gwan-ux', 'EDIT'),
  ('GET', '/admin/gwan-pages/{id}', 'gwan-ux', 'VIEW'),
  ('GET', '/admin/gwan-pages/{id}', 'gwans', 'VIEW'),
  ('PATCH', '/admin/gwan-pages/{id}', 'gwan-ux', 'EDIT'),
  ('POST', '/admin/gwan-pages/{id}/publish', 'gwan-ux', 'EDIT'),
  ('POST', '/admin/gwan-pages/{id}/restore', 'gwan-ux', 'EDIT'),
  ('POST', '/admin/gwan-pages/{id}/hide', 'gwan-ux', 'EDIT'),
  ('GET', '/admin/gwan-pages/{id}/versions/{version}', 'gwan-ux', 'VIEW'),
  ('GET', '/admin/gwan-pages/{id}/versions/{version}', 'gwans', 'VIEW')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

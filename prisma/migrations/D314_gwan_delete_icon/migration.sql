-- =====================================================================
-- D314 (v10.660 · v10.663 · docs/795) 준비중 관 지우기 · 소개 대상 바꾸기 · 관 아이콘 · 대표 색
--
--   대표 11/24 「다음개발 목록 전체」 → 8개 모두.
--   ① 운영 화면에서 만든 관(intro_target 있음)이 한 번도 열린 적 없으면(opened_at 없음 · 준비중 · 허브 아님) 지울 수 있음 — 처음 관 6개는 DB 가 막음
--      관을 지울 때만(세션 설정 app.gwan_delete = on) 그 관 페이지의 게시 판도 함께 지울 수 있게 fn_gwan_page_ver_ro 를 고침(D311 판 + 그 한 줄)
--   ② 소개 대상은 준비중(한 번도 안 연 관)일 때만 바꿈 · 처음 관(NULL)에 소개 대상을 넣지 못함(넣으면 하나씩 열기 조건 v_after 가 처음 관에도 걸림 · CE-01)
--   ④ gwans.icon · gwans.color — 정해 둔 이름만(아이콘 12 · 색은 디자인 시트 관 색 7 · sgb-tokens.css)
--   권한 주소 표: DELETE /admin/gwans/{code}
--   지우는 문장은 트리거 · 함수 다시 만들기(DROP TRIGGER IF EXISTS)뿐 · 다시 돌려도 같음 · RAISE 글자에 퍼센트 기호 없음
-- =====================================================================

ALTER TABLE public.gwans ADD COLUMN IF NOT EXISTS icon text;
ALTER TABLE public.gwans ADD COLUMN IF NOT EXISTS color text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gwans_icon_check') THEN
    ALTER TABLE public.gwans ADD CONSTRAINT gwans_icon_check CHECK (icon IS NULL OR icon IN
      ('book', 'home', 'briefcase', 'heart', 'car', 'tool', 'leaf', 'star', 'cart', 'people', 'gift', 'map'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gwans_color_check') THEN
    ALTER TABLE public.gwans ADD CONSTRAINT gwans_color_check CHECK (color IS NULL OR color IN
      ('money', 'mall', 'biz', 'shop', 'plaza', 'navy', 'link'));
  END IF;
END $$;
COMMENT ON COLUMN public.gwans.icon IS 'v10.663 (D314) 관 아이콘 — 정해 둔 이름 12개 · 사용자 웹 머리줄 · 허브 카드 · 없으면 기본 모양';
COMMENT ON COLUMN public.gwans.color IS 'v10.663 (D314) 관 대표 색 — 디자인 시트 관 색 이름(sgb-tokens.css --sgb-<이름>) · 없으면 기본 색';

-- ① ② 지우기 · 소개 대상 잠금
CREATE OR REPLACE FUNCTION public.fn_gwan_draft_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.intro_target IS NULL OR OLD.opened_at IS NOT NULL OR OLD.is_active OR coalesce(OLD.is_hub, false) THEN
      RAISE EXCEPTION 'GWAN_DELETE: 운영 화면에서 만들고 한 번도 열지 않은 준비중 관만 지울 수 있습니다.';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.intro_target IS DISTINCT FROM OLD.intro_target THEN
    IF OLD.intro_target IS NULL OR NEW.intro_target IS NULL THEN
      RAISE EXCEPTION 'GWAN_INTRO_TARGET: 처음 관의 소개 대상은 정하지 않습니다 · 새 관은 비울 수 없습니다.';
    END IF;
    IF OLD.opened_at IS NOT NULL OR OLD.is_active THEN
      RAISE EXCEPTION 'GWAN_INTRO_TARGET: 한 번 연 관의 소개 대상은 바꿀 수 없습니다.';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_gwan_draft_guard ON public.gwans;
CREATE TRIGGER trg_gwan_draft_guard BEFORE UPDATE OR DELETE ON public.gwans
  FOR EACH ROW EXECUTE FUNCTION public.fn_gwan_draft_guard();
COMMENT ON FUNCTION public.fn_gwan_draft_guard() IS 'v10.660 (D314) 관 지우기는 운영 화면에서 만들고 한 번도 안 연 준비중 관만 · 소개 대상은 그런 관만 바꿈(처음 관은 NULL 그대로 · CE-01)';

-- 관을 지울 때만 그 관 페이지의 게시 판을 함께 지움(D311 판 그대로 + 첫 줄)
CREATE OR REPLACE FUNCTION public.fn_gwan_page_ver_ro() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' AND coalesce(current_setting('app.gwan_delete', true), '') = 'on' THEN
    RETURN OLD;   -- v10.660 (D314) 준비중 관 지우기(서버 거래 안에서만 켬)
  END IF;
  RAISE EXCEPTION 'GWAN_PAGE_VERSION_RO: 게시된 판은 고치거나 지울 수 없습니다 — 새 판을 게시하십시오.';
END $fn$;

INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('DELETE', '/admin/gwans/{code}', 'gwans', 'EDIT')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

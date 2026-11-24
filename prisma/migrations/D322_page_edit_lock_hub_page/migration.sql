-- =====================================================================
-- D322 (v10.701 · v10.702 · docs/809 · 810) 페이지 수정 가능 스위치 · 허브(소개하고 벌기) 사용자 웹 페이지
--
--   대표 11/24 「페이지 목록에서 슈퍼유저가 수정 가능 여부를 지정하고, 수정 가능 시 수정할 수 있다 · 엔진 기능은 수정 불가 · 디자인적인 부분은 변경 가능 ·
--     관이 열려 있는 상태에서 변경 불가 · 관을 닫고 수정 가능」 → 관 열림 규칙 「말씀대로 — 열려 있으면 편집 불가」 · 메인은 「스위치만 따름」
--   ① site_layouts.editable — 처음 false(수정 불가) · SUPER 만 바꿈(서버) · 꾸밀 페이지의 초안 저장 · 게시 · 예약 · 되돌리기는 수정 가능일 때만
--      관 메인(MNY · MAL · BIZ · LED · HLT · EARN)은 그 관이 닫혀 있을 때(gwans.is_active = false)만 — 메인(HOME)은 스위치만(서버)
--   ② gwan_pages.editable — 처음 true(지금까지처럼 고칠 수 있음 · 이미 쓰는 관 안 페이지가 갑자기 막히지 않게) · SUPER 가 끄면 그 페이지는 못 고침(서버)
--   ③ 허브 페이지 열쇠 EARN(v10.702 · 사용자 웹 /earn) — 열쇠 CHECK 를 바꾸고 한 줄 더함
--   권한 주소 표 2줄 × 작업 2 · 지우는 문장 없음(옛 CHECK 를 바꾸는 ALTER 만) · 다시 돌려도 같음 · RAISE 없음
-- =====================================================================

ALTER TABLE public.site_layouts ADD COLUMN IF NOT EXISTS editable boolean NOT NULL DEFAULT false;
ALTER TABLE public.site_layouts ADD COLUMN IF NOT EXISTS editable_by uuid REFERENCES public.accounts(id);
ALTER TABLE public.site_layouts ADD COLUMN IF NOT EXISTS editable_at timestamptz;
COMMENT ON COLUMN public.site_layouts.editable IS 'v10.701 (D322) 수정 가능 — 처음 false · SUPER 만 바꿈 · 관 메인은 관이 닫혀 있어야 고침(서버)';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'site_layouts_key_check' AND pg_get_constraintdef(oid) NOT LIKE '%EARN%') THEN
    ALTER TABLE public.site_layouts DROP CONSTRAINT site_layouts_key_check;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'site_layouts_key_check') THEN
    ALTER TABLE public.site_layouts ADD CONSTRAINT site_layouts_key_check CHECK (key IN ('HOME', 'MNY', 'MAL', 'BIZ', 'LED', 'HLT', 'EARN'));
  END IF;
END $$;
INSERT INTO public.site_layouts (key) VALUES ('EARN') ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.gwan_pages ADD COLUMN IF NOT EXISTS editable boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.gwan_pages.editable IS 'v10.701 (D322) 수정 가능 — 처음 true(지금까지처럼) · SUPER 가 끄면 그 페이지는 초안 · 게시 · 예약 · 되돌리기 막음(서버)';

INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('POST', '/admin/site-layouts/{key}/editable', 'gwan-ux', 'EDIT'),
  ('POST', '/admin/site-layouts/{key}/editable', 'gwans', 'EDIT'),
  ('POST', '/admin/gwan-pages/{id}/editable', 'gwan-ux', 'EDIT'),
  ('POST', '/admin/gwan-pages/{id}/editable', 'gwans', 'EDIT')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

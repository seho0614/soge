-- =====================================================================
-- D317 (v10.675 ~ 679 · docs/798) 조각 쓰는 페이지 한꺼번에 다시 게시 · 메인 새 관 카드 고르기 · 예약 게시 판 바로잡기 · 판 바로 되돌리기
--
--   대표 11/24 「다음개발 목록」 → 5개 모두.
--   ④ 예약할 때 펼치기 전 초안도 떠 둠(scheduled_source) → 예약 게시 판의 source 로 넣음(조각이 든 페이지도 「게시 안 된 초안」이 켜지지 않음)
--   ② 설정 site.new_gwan_cards — 메인 「지금, 어떤 소개가 필요하세요?」에 보일 새 관 카드 코드(쉼표 · 3개까지 · 순서대로) · 비우면 전처럼 앞에서부터 3개(처음 값 '')
--   권한 주소 표 2줄(조각 다시 게시 · 판 되돌리기) · 지우는 문장 없음 · 다시 돌려도 같음 · RAISE 없음
-- =====================================================================

ALTER TABLE public.gwan_pages ADD COLUMN IF NOT EXISTS scheduled_source jsonb;
COMMENT ON COLUMN public.gwan_pages.scheduled_source IS 'v10.678 (D317) 예약할 때의 초안(조각을 펼치기 전) — 예약 게시 판의 source';

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('site.new_gwan_cards', '', 'GLOBAL', '메인 「지금, 어떤 소개가 필요하세요?」에 보일 새 관 카드(v10.676 · docs/798) — 운영 화면에서 만든 관 코드를 쉼표로 3개까지 · 적은 순서대로 · 켠 관만 보임 · 비우면 앞에서부터 3개(관 순서) · 관 관리 › 관 목록 › 「메인 새 관 카드」에서 고름', false, '^$|^[A-Z]{3,4}(,[A-Z]{3,4}){0,2}$', 'EDU,PET')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('POST', '/admin/gwan-fragments/{id}/republish', 'gwan-ux', 'EDIT'),
  ('POST', '/admin/gwan-pages/{id}/rollback', 'gwan-ux', 'EDIT')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

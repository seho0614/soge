-- =====================================================================
-- D326 (v10.734 ~ 743 · docs/842 ~ 851) 페이지 · 관 운영 더하기 10
--
--   대표 11/24 「다음개발 후보 전체」 → 「모두개발」.
--   ① 운영자 게시판 자동 글 종류 PAGES — 페이지 게시 · 되돌림 · 예약 게시 · 관 점검 시작 · 끝 · 못 엶 · 게시 요청(v10.734) · 스위치 ops.board_pages(처음 on)
--   ② page_publish_requests.reminded_at — 게시 요청이 하루 넘게 대기면 하루 한 번 다시 알림(v10.737)
--   ③ 권한 주소 표 — 예약 달력 · 의견 CSV · 판 내려받기 · 올리기 · 글자 AI 초안 · 관 안 페이지 복사 · 페이지 목록 CSV
--   지우는 문장 없음(옛 CHECK 를 바꾸는 ALTER 만) · 다시 돌려도 같음 · RAISE 없음
-- =====================================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ops_board_posts_kind_check' AND pg_get_constraintdef(oid) NOT LIKE '%PAGES%') THEN
    ALTER TABLE public.ops_board_posts DROP CONSTRAINT ops_board_posts_kind_check;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ops_board_posts_kind_check') THEN
    ALTER TABLE public.ops_board_posts ADD CONSTRAINT ops_board_posts_kind_check CHECK (kind IN ('DAILY_DIGEST', 'URGENT', 'OWNER_TODO', 'TEST', 'STAFF', 'PAGES'));
  END IF;
END $$;
COMMENT ON COLUMN public.ops_board_posts.kind IS 'v10.286 (D213) 글 종류 · v10.734 (D326) PAGES 페이지 게시 · 관 점검 · 게시 요청 자동 글';

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('ops.board_pages', 'on', 'ADMIN', '운영자 게시판 페이지 자동 글(v10.734 · docs/842) — 페이지 게시 · 되돌림 · 예약 게시 · 관 점검 시작 · 끝 · 다시 열지 못함 · 게시 요청 · off 면 안 올림(운영 알림은 그대로)', false, '^(on|off)$', 'on')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.opx_switch_docs (key, initial_value, cond, doc_ref, who) VALUES
  ('ops.board_pages', 'on', '처음부터 켜짐(선행 조건 없음) — 운영자 게시판(위험감지 › 운영자 게시판)에 페이지 · 점검 글이 올라옴', 'docs/842', 'ADMIN')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.page_publish_requests ADD COLUMN IF NOT EXISTS reminded_at timestamptz;
COMMENT ON COLUMN public.page_publish_requests.reminded_at IS 'v10.737 (D326) 하루 넘게 대기 다시 알림 — 마지막으로 다시 알린 때(하루 한 번)';

INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/site-schedules', 'gwan-ux', 'VIEW'), ('GET', '/admin/site-schedules', 'gwans', 'VIEW'),
  ('GET', '/admin/page-feedback.csv', 'gwan-ux', 'VIEW'), ('GET', '/admin/page-feedback.csv', 'gwans', 'VIEW'),
  ('GET', '/admin/site-layouts/{key}/export', 'gwan-ux', 'VIEW'), ('GET', '/admin/site-layouts/{key}/export', 'gwans', 'VIEW'),
  ('POST', '/admin/site-layouts/{key}/import', 'gwan-ux', 'EDIT'), ('POST', '/admin/site-layouts/{key}/import', 'gwans', 'EDIT'),
  ('POST', '/admin/site-layouts/{key}/suggest', 'gwan-ux', 'EDIT'), ('POST', '/admin/site-layouts/{key}/suggest', 'gwans', 'EDIT'),
  ('POST', '/admin/gwan-pages/{id}/copy', 'gwan-ux', 'EDIT'), ('POST', '/admin/gwan-pages/{id}/copy', 'gwans', 'EDIT'),
  ('GET', '/admin/site-pages.csv', 'gwan-ux', 'VIEW'), ('GET', '/admin/site-pages.csv', 'gwans', 'VIEW')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

-- =====================================================================
-- D319 (v10.685 · docs/800) 내 담당 관 — 권한 주소 표 1줄(GET /admin/my-gwans · 읽기만)
--
--   대표 11/24 「다음개발목록 전체」 → 후보 전체 개발. 업종 CSV(v10.686) · FAQ 불러오기(v10.687) · 문의 수(v10.688) · 금칙어 바로 가기(v10.689)는
--   있는 주소(POST /admin/categories · GET /admin/faqs · GET /admin/gwans/{code}/stats)를 그대로 써서 표를 더하지 않음
--   지우는 문장 없음 · 다시 돌려도 같음
-- =====================================================================

INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/my-gwans', 'gwan-ux', 'VIEW'),
  ('GET', '/admin/my-gwans', 'gwans', 'VIEW')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

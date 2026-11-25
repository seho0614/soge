-- e3.1 (docs/010) 손으로 쓴 svc 조회 — tools/erp-svc.sh 가 svc 를 가져온 뒤 실행(svc-views.sql 다음)
--   erp_site_settings: 옮겨 온 코드의 `FROM site_settings`(key · value 만 읽음 · 61곳)를 이 조회로(tools/port-from-core.py R2)
--     ERP 자기 설정(erp_settings — acct.* · hr.* 등 옮겨 온 것) 먼저 · 없으면 소개뱅크 설정(svc.site_settings — 회사 이름 · 공휴일 설정 등)
SET search_path = public;
CREATE OR REPLACE VIEW public.erp_site_settings AS
  SELECT e.key, e.value FROM erp_settings e
  UNION ALL
  SELECT s.key, s.value FROM svc.site_settings s WHERE NOT EXISTS (SELECT 1 FROM erp_settings e2 WHERE e2.key = s.key);
COMMENT ON VIEW public.erp_site_settings IS 'e3.1 ERP 설정 먼저 · 없으면 소개뱅크 설정(읽기만)';

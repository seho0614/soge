-- =====================================================================
-- D098 — v10.42 (2026-10-15 옛 도메인 정리)
--
--   운영 도메인은 sogaebank.com(가비아 등록 · AWS 사용)입니다. 문서에 있던 sogaebaenk.co.kr 은 오타였습니다.
--   B900 · C870 이 옛 도메인을 넣었지만, 이미 적용된 파일은 고치지 않습니다(schema_migrations 체크섬).
--   대신 여기서 바꿉니다.
--
--     site.domain        값이 옛 도메인일 때만  → sogaebank.com
--     site.base_url      값이 옛 주소일 때만    → https://sogaebank.com
--     value_example      옛 도메인이 들어간 예시 값 → sogaebank.com (site.domain · site.base_url · site.partner_subdomain)
--
--   운영자가 이미 다른 값으로 고친 경우는 건드리지 않습니다.
--   재실행 안전.
-- =====================================================================

UPDATE public.site_settings SET value = 'sogaebank.com', updated_at = now()
 WHERE key = 'site.domain' AND value = 'sogaebaenk.co.kr';

UPDATE public.site_settings SET value = 'https://sogaebank.com', updated_at = now()
 WHERE key = 'site.base_url' AND value IN ('https://sogaebaenk.co.kr', 'https://sogaebaenk.co.kr/');

UPDATE public.site_settings SET value_example = replace(value_example, 'sogaebaenk.co.kr', 'sogaebank.com')
 WHERE value_example LIKE '%sogaebaenk.co.kr%';

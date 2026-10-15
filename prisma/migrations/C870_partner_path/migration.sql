-- ── 파트너센터 경로 (C870) ─────────────────────────────────────────
--
-- ── 사장님 결정 (2026-09-22) ────────────────────────────────────────
--   ② 파트너센터는 그대로 두되 **운영 메뉴에서도 들어갑니다.**
--   ③ 별도 서브도메인이 아니라 **같은 도메인**에 둡니다.
--
-- ── 서브도메인을 안 쓰는 이유 ───────────────────────────────────────
--   partners.sogaebaenk.co.kr 로 나누면
--     · SSL 인증서를 따로 받아야 합니다
--     · 로그인 세션이 도메인을 넘지 못해 다시 로그인해야 합니다
--     · 운영이 파트너 화면을 보려면 창을 새로 열어야 합니다
--
--   같은 도메인이면 이 셋이 전부 없어집니다.
--   나중에 파트너가 많아지면 그때 나누면 됩니다 — 지금은 이릅니다.

INSERT INTO site_settings (key, value, scope, description, value_example, value_pattern)
VALUES
 ('site.partner_path', '/partners', 'GLOBAL',
  '파트너센터 경로. **같은 도메인 안의 경로**입니다 — 서브도메인을 쓰지 '
  '않습니다. 로그인 세션이 그대로 이어지고, 운영이 파트너 화면을 바로 '
  '열어 볼 수 있습니다.',
  '/partners', '^/[a-z0-9/-]*$'),
 ('site.partner_subdomain', '', 'GLOBAL',
  '파트너센터 서브도메인. 비워 두면 site.partner_path 를 씁니다. '
  '파트너가 많아져 분리가 필요해지면 그때 채우십시오 — SSL 인증서와 '
  '세션 처리를 함께 손봐야 합니다.',
  'partners.sogaebaenk.co.kr', NULL)
ON CONFLICT (key) DO NOTHING;

/* ★ 둘을 동시에 쓰면 어느 쪽이 진짜인지 모릅니다. */
CREATE OR REPLACE VIEW v_partner_path_conflict AS
SELECT 'site.partner_path 와 site.partner_subdomain 이 모두 설정돼 있습니다'::text AS note
 WHERE (SELECT coalesce(btrim(value),'') FROM site_settings WHERE key='site.partner_path') <> ''
   AND (SELECT coalesce(btrim(value),'') FROM site_settings WHERE key='site.partner_subdomain') <> '';

COMMENT ON VIEW v_partner_path_conflict IS
  '파트너센터 경로가 둘 다 설정된 상태. **0이어야 합니다** — 어느 '
  '쪽이 진짜인지 모르면 링크가 엉뚱한 곳을 가리킵니다.';

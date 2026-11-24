-- =====================================================================
-- D321 (v10.696 · docs/804) 꾸밀 페이지(구역 편집) — 메인 · 관 메인(소개장터 · 안심소개 · 소개창업 · 소개리드) · 소개몰 메인
--
--   대표 11/24 「수정 가능한 페이지: hero · 각 관의 메인 페이지 · 소개몰(메인 및 구성 수정 가능) · 페이지 목록 관리」 → 「구역 편집(권장)」 · 「한 화면에 모두」 → 승인.
--   지금 디자인은 그대로 두고 구역마다 보이기 · 순서 · 글자 · 그림 · (소개몰) 고른 상품 · 구역 사이 블록(관 페이지 블록)을 고침.
--   초안(draft)은 ADMIN · SUPER · 게시 · 예약 · 되돌리기는 SUPER(서버) · 게시하면 site_layout_versions 에 판이 쌓임(고치기 · 지우기 막음 · DB)
--   예약은 그때의 초안을 떠 둠(scheduled_layout) — 예약 뒤 초안을 고쳐도 SUPER 확인 없이 나가지 않음 · 게시는 공개 · 관리 화면을 읽을 때 서버가 함
--   미리보기 링크 — 로그인 없이 24시간(최대 72시간) · 초안을 보여 줌 · 페이지마다 열린 링크 5개까지(서버)
--   게시된 판이 없으면 사용자 웹은 지금과 같음(코드에 있는 처음 배치)
--   권한 주소 표 · 지우는 문장 없음 · 다시 돌려도 같음 · RAISE 글자에 퍼센트 기호 없음
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.site_layouts (
  key                text PRIMARY KEY CHECK (key IN ('HOME', 'MNY', 'MAL', 'BIZ', 'LED', 'HLT')),
  draft              jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(draft) = 'object'),
  draft_updated_at   timestamptz NOT NULL DEFAULT now(),
  draft_updated_by   uuid REFERENCES public.accounts(id),
  published          jsonb CHECK (published IS NULL OR jsonb_typeof(published) = 'object'),
  published_version  int,
  published_at       timestamptz,
  published_by       uuid REFERENCES public.accounts(id),
  scheduled_at       timestamptz,
  scheduled_by       uuid REFERENCES public.accounts(id),
  scheduled_layout   jsonb,
  CONSTRAINT site_layouts_pub_check CHECK ((published IS NULL) = (published_version IS NULL)),
  CONSTRAINT site_layouts_schedule_check CHECK (
    (scheduled_at IS NULL AND scheduled_by IS NULL AND scheduled_layout IS NULL)
    OR (scheduled_at IS NOT NULL AND scheduled_by IS NOT NULL AND jsonb_typeof(scheduled_layout) = 'object'))
);
COMMENT ON TABLE public.site_layouts IS 'v10.696 (D321) 꾸밀 페이지 — HOME 메인 · MNY · MAL · BIZ · LED 관 메인 · HLT 소개몰 메인. draft 초안 · published 게시된 판(없으면 코드의 처음 배치)';
INSERT INTO public.site_layouts (key) VALUES ('HOME'), ('MNY'), ('MAL'), ('BIZ'), ('LED'), ('HLT') ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.site_layout_versions (
  id            bigserial PRIMARY KEY,
  key           text NOT NULL REFERENCES public.site_layouts(key),
  version       int NOT NULL CHECK (version >= 1),
  layout        jsonb NOT NULL CHECK (jsonb_typeof(layout) = 'object'),
  published_at  timestamptz NOT NULL DEFAULT now(),
  published_by  uuid REFERENCES public.accounts(id),
  how           text NOT NULL DEFAULT 'PUBLISH' CHECK (how IN ('PUBLISH', 'SCHEDULE', 'ROLLBACK')),
  reason        text CHECK (reason IS NULL OR char_length(reason) <= 300),
  UNIQUE (key, version)
);
COMMENT ON TABLE public.site_layout_versions IS 'v10.696 (D321) 꾸밀 페이지 게시 판 — 쌓기만(고치기 · 지우기 막음)';

CREATE OR REPLACE FUNCTION public.fn_site_layout_ver_ro() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'SITE_LAYOUT_VERSION_RO: 게시된 판은 고치거나 지울 수 없습니다 — 새 판을 게시하십시오.';
END $fn$;
DROP TRIGGER IF EXISTS trg_site_layout_ver_ro ON public.site_layout_versions;
CREATE TRIGGER trg_site_layout_ver_ro BEFORE UPDATE OR DELETE ON public.site_layout_versions
  FOR EACH ROW EXECUTE FUNCTION public.fn_site_layout_ver_ro();

CREATE TABLE IF NOT EXISTS public.site_layout_previews (
  token       text PRIMARY KEY CHECK (token ~ '^[0-9a-f]{40}$'),
  key         text NOT NULL REFERENCES public.site_layouts(key),
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES public.accounts(id),
  revoked_at  timestamptz,
  CONSTRAINT site_layout_previews_ttl CHECK (expires_at <= created_at + interval '72 hours')
);
CREATE INDEX IF NOT EXISTS site_layout_previews_key_idx ON public.site_layout_previews (key);
COMMENT ON TABLE public.site_layout_previews IS 'v10.696 (D321) 꾸밀 페이지 미리보기 링크 — 로그인 없이 초안을 봄 · 72시간까지 · 끊기';

-- 권한 주소 표(perm_route_map) — 관 관리 작업(gwan-ux · gwans) · 페이지 목록(v10.700)도 같은 작업
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/site-layouts', 'gwan-ux', 'VIEW'),
  ('GET', '/admin/site-layouts', 'gwans', 'VIEW'),
  ('GET', '/admin/site-layouts/{key}', 'gwan-ux', 'VIEW'),
  ('GET', '/admin/site-layouts/{key}', 'gwans', 'VIEW'),
  ('PATCH', '/admin/site-layouts/{key}', 'gwan-ux', 'EDIT'),
  ('PATCH', '/admin/site-layouts/{key}', 'gwans', 'EDIT'),
  ('POST', '/admin/site-layouts/{key}/publish', 'gwan-ux', 'EDIT'),
  ('POST', '/admin/site-layouts/{key}/publish', 'gwans', 'EDIT'),
  ('POST', '/admin/site-layouts/{key}/schedule', 'gwan-ux', 'EDIT'),
  ('POST', '/admin/site-layouts/{key}/schedule', 'gwans', 'EDIT'),
  ('POST', '/admin/site-layouts/{key}/restore', 'gwan-ux', 'EDIT'),
  ('POST', '/admin/site-layouts/{key}/restore', 'gwans', 'EDIT'),
  ('POST', '/admin/site-layouts/{key}/rollback', 'gwan-ux', 'EDIT'),
  ('POST', '/admin/site-layouts/{key}/rollback', 'gwans', 'EDIT'),
  ('POST', '/admin/site-layouts/{key}/previews', 'gwan-ux', 'EDIT'),
  ('POST', '/admin/site-layouts/{key}/previews', 'gwans', 'EDIT'),
  ('DELETE', '/admin/site-layouts/{key}/previews/{token}', 'gwan-ux', 'EDIT'),
  ('DELETE', '/admin/site-layouts/{key}/previews/{token}', 'gwans', 'EDIT'),
  ('GET', '/admin/site-pages', 'gwan-ux', 'VIEW'),
  ('GET', '/admin/site-pages', 'gwans', 'VIEW')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

-- hdx_ · v10.700 (docs/808) 운영 화면 「?」 도움말에 새 탭 「페이지 목록 [site-pages]」 절 — D305 와 같은 방식(지금 판 끝에 붙인 새 판 · 쌓기만 · 4만 자 안 · 이미 있으면 건너뜀) · 탭 → 절 잇기
WITH add_rows(ord, grp, tab_key, heading, body) AS (VALUES
  (1, '17. 관 관리 — 꾸밀 페이지(v10.696 ~ 700)', 'site-pages', '페이지 목록 [site-pages]', $hdx$- 메인 hero · 관 메인(소개장터 · 안심소개 · 소개창업 · 소개리드) · 소개몰 메인의 구역 보이기 · 순서 · 글자 · 그림 · (소개몰) 고른 상품 · 구역 사이 블록을 고치고, 관 안 페이지 · 새 관 첫 화면까지 한 표로 봅니다.
- 초안 저장은 ADMIN · SUPER, 게시 · 예약 · 바로 되돌리기는 SUPER 만 — 게시 전에는 사용자 웹이 그대로이고 미리보기 링크로 초안을 봅니다.
- 보는 역할: ADMIN · SUPER.$hdx$)
),
cur AS (
  SELECT version, title, body FROM public.v_help_doc_current WHERE code = 'ADMIN_GUIDE'
),
fit AS (
  SELECT a.* FROM add_rows a, cur c
   WHERE position('[' || a.tab_key || ']' IN c.body) = 0
     AND char_length(rtrim(c.body, E'\n')) + char_length(a.grp) + char_length(a.heading) + char_length(a.body) + 20 <= 40000
),
add_text AS (
  SELECT string_agg('## ' || grp || E'\n\n### ' || heading || E'\n' || body, E'\n\n' ORDER BY ord) AS t FROM fit
)
INSERT INTO public.help_docs (code, version, title, body, note)
SELECT 'ADMIN_GUIDE', (SELECT max(version) + 1 FROM public.help_docs WHERE code = 'ADMIN_GUIDE'), c.title,
       rtrim(c.body, E'\n') || E'\n\n' || a.t || E'\n', '페이지 목록 탭 설명 더함(v10.700 · docs/808)'
  FROM cur c, add_text a
 WHERE a.t IS NOT NULL;

INSERT INTO public.sec2_tab_help (tab_key, doc_code, heading)
SELECT DISTINCT ON (x.k) x.k, 'ADMIN_GUIDE', x.h
  FROM (
    SELECT l.n, (regexp_match(l.line, '^###\s+(.*\[([a-z][a-z0-9-]{1,39})\])\s*$'))[1] AS h,
                (regexp_match(l.line, '^###\s+(.*\[([a-z][a-z0-9-]{1,39})\])\s*$'))[2] AS k
      FROM public.v_help_doc_current c,
           LATERAL regexp_split_to_table(c.body, E'\n') WITH ORDINALITY AS l(line, n)
     WHERE c.code = 'ADMIN_GUIDE'
  ) x
 WHERE x.k = 'site-pages' AND char_length(x.h) <= 120
 ORDER BY x.k, x.n
ON CONFLICT (tab_key) DO NOTHING;

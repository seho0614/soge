-- =====================================================================
-- D325 (v10.714 ~ 733 · docs/822 ~ 841) 페이지 · 관 운영 묶음 20 — 표가 필요한 것만
--
--   대표 11/24 「다음 개발 목록 20개」 → 「모두 개발」.
--   ① gwan_maint_repeats — 점검 시간 반복(요일 · 한국 시각 · 길이 · 안내 글 · 미리 알림) → 정기 작업 gwan_maint 가 7일 앞까지 점검을 만들어 둠(v10.721)
--   ② site_layout_views — 꾸밀 페이지 방문 수(열쇠 · 날마다 · 개인 정보 없음 · v10.722)
--   ③ gwan_open_log — 관 열기 · 닫기 기록(누가 · 언제 · 운영 화면 ADMIN · 점검 MAINT · 쌓기만 · v10.727)
--   ④ page_feedback — 손님 한 줄 의견 블록(페이지 · 도움됨 여부 · 한 줄 · 기기 지문 해시 · 쌓기만 · v10.729)
--   ⑤ 설정 — 관별 페이지 편집 권한(site.page_edit_managers_only · 처음 off · v10.726) · 점검 · 없는 페이지 화면 글(v10.728) · hero 추천 칩 영어(v10.724)
--   권한 주소 표 · 지우는 문장 없음 · 다시 돌려도 같음 · RAISE 글자에 퍼센트 기호 없음
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.gwan_maint_repeats (
  id          bigserial PRIMARY KEY,
  gwan_code   text NOT NULL REFERENCES public.gwans(code),
  dow         smallint NOT NULL CHECK (dow BETWEEN 0 AND 6),
  at_kst      time NOT NULL,
  minutes     smallint NOT NULL CHECK (minutes IN (15, 30, 60, 90, 120)),
  note        text CHECK (note IS NULL OR char_length(note) <= 200),
  announce    boolean NOT NULL DEFAULT false,
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES public.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.gwan_maint_repeats IS 'v10.721 (D325) 점검 시간 반복 — 요일(0 일요일) · 한국 시각 · 길이 · 정기 작업 gwan_maint 가 7일 앞까지 점검을 만들어 둠(겹치면 건너뜀)';
ALTER TABLE public.gwan_maintenances ADD COLUMN IF NOT EXISTS repeat_id bigint REFERENCES public.gwan_maint_repeats(id);
CREATE UNIQUE INDEX IF NOT EXISTS gwan_maint_repeat_slot_uq ON public.gwan_maintenances (repeat_id, starts_at) WHERE repeat_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.site_layout_views (
  key    text NOT NULL REFERENCES public.site_layouts(key),
  day    date NOT NULL,
  views  integer NOT NULL DEFAULT 0 CHECK (views >= 0),
  PRIMARY KEY (key, day)
);
COMMENT ON TABLE public.site_layout_views IS 'v10.722 (D325) 꾸밀 페이지 방문 수 — 열쇠 · 날(서울)마다 한 줄 · 개인 정보 없음 · 같은 기기 같은 날 한 번(서버 기억)';

CREATE TABLE IF NOT EXISTS public.gwan_open_log (
  id         bigserial PRIMARY KEY,
  gwan_code  text NOT NULL REFERENCES public.gwans(code),
  opened     boolean NOT NULL,
  source     text NOT NULL CHECK (source IN ('ADMIN', 'MAINT')),
  by         uuid REFERENCES public.accounts(id),
  maint_id   bigint REFERENCES public.gwan_maintenances(id),
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gwan_open_log_at_idx ON public.gwan_open_log (at DESC);
COMMENT ON TABLE public.gwan_open_log IS 'v10.727 (D325) 관 열기 · 닫기 기록 — 운영 화면(ADMIN) · 점검(MAINT) · 쌓기만';
CREATE OR REPLACE FUNCTION public.fn_gwan_open_log_ro() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'GWAN_OPEN_LOG_RO: 관 열기 · 닫기 기록은 고치거나 지울 수 없습니다.';
END $fn$;
DROP TRIGGER IF EXISTS trg_gwan_open_log_ro ON public.gwan_open_log;
CREATE TRIGGER trg_gwan_open_log_ro BEFORE UPDATE OR DELETE ON public.gwan_open_log FOR EACH ROW EXECUTE FUNCTION public.fn_gwan_open_log_ro();

CREATE TABLE IF NOT EXISTS public.page_feedback (
  id         bigserial PRIMARY KEY,
  page_kind  text NOT NULL CHECK (page_kind IN ('LAYOUT', 'PAGE')),
  page_ref   text NOT NULL CHECK (char_length(page_ref) BETWEEN 1 AND 40),
  helpful    boolean NOT NULL,
  comment    text CHECK (comment IS NULL OR char_length(comment) <= 200),
  dev_hash   text NOT NULL CHECK (dev_hash ~ '^[0-9a-f]{16}$'),
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS page_feedback_ref_idx ON public.page_feedback (page_kind, page_ref, at DESC);
COMMENT ON TABLE public.page_feedback IS 'v10.729 (D325) 손님 한 줄 의견 — 「도움이 됐나요?」 · 한 줄(200자) · 기기 지문은 해시 16자(IP · 브라우저 글자 · 날) · 개인 정보 없음';

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('site.page_edit_managers_only', 'off', 'SUPER', '관별 페이지 편집 권한(v10.726 · docs/834) — on 이면 운영자(ADMIN)는 자기가 담당자인 관의 페이지 · 관 메인만 고침(SUPER 는 모두) · 메인(HOME)은 SUPER 만', false, '^(on|off)$', 'off'),
  ('site.maint_title', '', 'GLOBAL', '점검 안내 화면 제목(v10.728 · docs/836) — 비우면 「잠시 점검 중입니다」', false, '^.{0,40}$', '잠시 쉬어 갑니다'),
  ('site.maint_body', '', 'GLOBAL', '점검 안내 화면 글(v10.728) — 관 점검 시간의 안내 글 앞에 나옴 · 비우면 없음', false, '^.{0,200}$', '더 좋은 화면으로 곧 돌아오겠습니다.'),
  ('site.notfound_title', '', 'GLOBAL', '없는 페이지(404) 제목(v10.728) — 비우면 사전 글', false, '^.{0,40}$', '찾는 페이지가 없습니다'),
  ('site.notfound_body', '', 'GLOBAL', '없는 페이지(404) 글(v10.728) — 비우면 사전 글', false, '^.{0,200}$', '주소를 다시 확인하시거나 처음 화면에서 찾아 주세요.'),
  ('home.hero_chips_en', '', 'ADMIN', '메인 검색 추천 칩 영어(v10.724 · docs/832) — 쉼표로 4개까지 · 영어 화면에서만 · 비우면 인기 검색어(영어 화면은 사전 칩)', false, '^$|^[^,]{1,20}(,[^,]{1,20}){0,3}$', 'cleaning,used car,startup,interior')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.opx_switch_docs (key, initial_value, cond, doc_ref, who) VALUES
  ('site.page_edit_managers_only', 'off', '관 담당자(관 설정 › 기본 정보 › 관 담당자)를 먼저 정한 뒤 켬 — 켜면 담당자가 아닌 운영자는 그 관 페이지를 못 고침', 'docs/834', 'SUPER')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/gwan-maint-repeats', 'gwan-ux', 'VIEW'), ('GET', '/admin/gwan-maint-repeats', 'gwans', 'VIEW'),
  ('POST', '/admin/gwan-maint-repeats', 'gwan-ux', 'EDIT'), ('POST', '/admin/gwan-maint-repeats', 'gwans', 'EDIT'),
  ('POST', '/admin/gwan-maint-repeats/{id}/stop', 'gwan-ux', 'EDIT'), ('POST', '/admin/gwan-maint-repeats/{id}/stop', 'gwans', 'EDIT'),
  ('GET', '/admin/gwan-open-log', 'gwan-ux', 'VIEW'), ('GET', '/admin/gwan-open-log', 'gwans', 'VIEW'),
  ('GET', '/admin/page-feedback', 'gwan-ux', 'VIEW'), ('GET', '/admin/page-feedback', 'gwans', 'VIEW'),
  ('POST', '/admin/site-layouts/schedule-batch', 'gwan-ux', 'EDIT'), ('POST', '/admin/site-layouts/schedule-batch', 'gwans', 'EDIT'),
  ('GET', '/admin/site-layouts/{key}/versions/{version}', 'gwan-ux', 'VIEW'), ('GET', '/admin/site-layouts/{key}/versions/{version}', 'gwans', 'VIEW'),
  ('POST', '/admin/site-layouts/{key}/copy-from', 'gwan-ux', 'EDIT'), ('POST', '/admin/site-layouts/{key}/copy-from', 'gwans', 'EDIT'),
  ('POST', '/admin/gwans/{code}/pages/order', 'gwan-ux', 'EDIT'), ('POST', '/admin/gwans/{code}/pages/order', 'gwans', 'EDIT')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

-- =====================================================================
-- D323 (v10.706 · v10.707 · v10.709 · docs/814 · 815 · 817) 관 점검 시간 예약 · 닫힌 관 손님 안내 · 꾸밀 페이지 초안 고친 기록
--
--   대표 11/24 「다음개발 목록」 → 4개 모두(관 점검 시간 예약 · 닫힌 관 손님 안내 화면 · 꾸밀 페이지 언어별 글자 · 초안 고친 기록).
--   ① gwan_maintenances — SUPER 가 관마다 점검 시간(시작 · 끝 · 최대 2시간 · 손님 안내 글)을 예약 → 정기 작업 gwan_maint(1분마다)가
--      시작 시각에 관을 닫고(열려 있던 관만 · was_open) → 그 사이 시각이 된 예약 게시를 내보내고 → 끝 시각에 다시 엶(열려 있던 관만)
--      같은 관에 겹치는 점검은 DB 가 막음(btree_gist 없이 트리거) · 시작 전 취소 · 도중 「지금 끝내기」(ends_at 을 지금으로)
--   ② 손님 안내(v10.707) — 공개 GET /gwans/{code}/maintenance(지금 점검 중이면 끝 시각 · 글) · 표를 더하지 않음
--   ③ site_layout_draft_log — 꾸밀 페이지 초안 저장마다 한 줄(누가 · 언제 · 바뀐 곳 요약) · 쌓기만
--   ④ 언어별 글자(v10.708)는 꾸밀 페이지 배치 JSON 안(i18n) — 표를 더하지 않음
--   권한 주소 표 · 정기 작업 줄 · 지우는 문장 없음 · 다시 돌려도 같음 · RAISE 글자에 퍼센트 기호 없음
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.gwan_maintenances (
  id            bigserial PRIMARY KEY,
  gwan_code     text NOT NULL REFERENCES public.gwans(code),
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  note          text CHECK (note IS NULL OR char_length(note) <= 200),
  created_by    uuid REFERENCES public.accounts(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  was_open      boolean,
  closed_at     timestamptz,
  reopened_at   timestamptz,
  reopen_error  text CHECK (reopen_error IS NULL OR char_length(reopen_error) <= 300),
  canceled_at   timestamptz,
  canceled_by   uuid REFERENCES public.accounts(id),
  CONSTRAINT gwan_maint_span CHECK (ends_at > starts_at AND ends_at <= starts_at + interval '2 hours'),
  CONSTRAINT gwan_maint_cancel CHECK (canceled_at IS NULL OR closed_at IS NULL)
);
CREATE INDEX IF NOT EXISTS gwan_maint_due_idx ON public.gwan_maintenances (starts_at) WHERE canceled_at IS NULL AND reopened_at IS NULL;
COMMENT ON TABLE public.gwan_maintenances IS 'v10.706 (D323) 관 점검 시간 — 시작에 관을 닫고(열려 있던 관만) 끝에 다시 엶 · 정기 작업 gwan_maint(1분마다) · 최대 2시간 · 겹침 막음';

CREATE OR REPLACE FUNCTION public.fn_gwan_maint_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.canceled_at IS NULL AND NEW.reopened_at IS NULL AND EXISTS (
       SELECT 1 FROM public.gwan_maintenances m
        WHERE m.gwan_code = NEW.gwan_code AND m.id <> NEW.id AND m.canceled_at IS NULL AND m.reopened_at IS NULL
          AND tstzrange(m.starts_at, m.ends_at) && tstzrange(NEW.starts_at, NEW.ends_at)) THEN
    RAISE EXCEPTION 'GWAN_MAINT_OVERLAP: 같은 관에 겹치는 점검 시간이 있습니다.';
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_gwan_maint_guard ON public.gwan_maintenances;
CREATE TRIGGER trg_gwan_maint_guard BEFORE INSERT OR UPDATE ON public.gwan_maintenances
  FOR EACH ROW EXECUTE FUNCTION public.fn_gwan_maint_guard();

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('gwan_maint', 1, NULL, NULL, NULL, true, '관 점검 시간 — 시작 시각에 관을 닫고 · 그 사이 예약 게시를 내보내고 · 끝 시각에 다시 엶(열려 있던 관만) · 운영 알림 GWAN_MAINT_START · END · REOPEN_FAIL · D323 · v10.706')
ON CONFLICT (job) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.site_layout_draft_log (
  id       bigserial PRIMARY KEY,
  key      text NOT NULL REFERENCES public.site_layouts(key),
  at       timestamptz NOT NULL DEFAULT now(),
  by       uuid REFERENCES public.accounts(id),
  changes  jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(changes) = 'array')
);
CREATE INDEX IF NOT EXISTS site_layout_draft_log_key_idx ON public.site_layout_draft_log (key, at DESC);
COMMENT ON TABLE public.site_layout_draft_log IS 'v10.709 (D323) 꾸밀 페이지 초안 고친 기록 — 저장마다 바뀐 곳 요약(구역 · 글자 · 블록 자리 · 상품 · 언어) · 쌓기만';

INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/gwan-maintenances', 'gwan-ux', 'VIEW'),
  ('GET', '/admin/gwan-maintenances', 'gwans', 'VIEW'),
  ('POST', '/admin/gwan-maintenances', 'gwan-ux', 'EDIT'),
  ('POST', '/admin/gwan-maintenances', 'gwans', 'EDIT'),
  ('POST', '/admin/gwan-maintenances/{id}/cancel', 'gwan-ux', 'EDIT'),
  ('POST', '/admin/gwan-maintenances/{id}/cancel', 'gwans', 'EDIT'),
  ('POST', '/admin/gwan-maintenances/{id}/end', 'gwan-ux', 'EDIT'),
  ('POST', '/admin/gwan-maintenances/{id}/end', 'gwans', 'EDIT'),
  ('GET', '/admin/site-layouts/{key}/draft-log', 'gwan-ux', 'VIEW'),
  ('GET', '/admin/site-layouts/{key}/draft-log', 'gwans', 'VIEW'),
  ('POST', '/admin/site-layouts/{key}/translate', 'gwan-ux', 'EDIT'),
  ('POST', '/admin/site-layouts/{key}/translate', 'gwans', 'EDIT')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

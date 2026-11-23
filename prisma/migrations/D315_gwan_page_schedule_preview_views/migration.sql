-- =====================================================================
-- D315 (v10.661 · v10.666 · v10.667 · docs/795) 관 페이지 예약 게시 · 미리보기 링크 · 방문 수
--
--   대표 11/24 「다음개발 목록 전체」 → 8개 모두.
--   ② 예약 게시 — SUPER 가 예약할 때의 초안 · 제목을 떠 둠(scheduled_blocks · scheduled_title) → 그 시각이 지나면 그 내용이 새 판으로 게시
--      (예약 뒤 ADMIN 이 초안을 고쳐도 SUPER 확인 없이 나가지 않음) · 게시는 공개 페이지 · 관리 목록을 읽을 때 서버가 함(배치 줄 더하지 않음)
--   ⑧ 미리보기 링크 — 로그인 없이 24시간(최대 72시간) · 초안을 보여 줌 · 같은 페이지 열린 링크 5개까지(서버) · 끊기 가능
--   ⑥ 방문 수 — 페이지 · 날마다 한 줄(쌓기만 · 개인 정보 없음 · 같은 기기 같은 날 한 번은 서버 기억으로 거름)
--   페이지를 지우면(준비중 관 지우기 D314) 미리보기 · 방문 수도 함께 지움(ON DELETE CASCADE)
--   권한 주소 표 6줄(예약 · 번역 초안 · 미리보기 만들기 · 끊기 · 방문 수) · 지우는 문장 없음 · 다시 돌려도 같음 · RAISE 글자에 퍼센트 기호 없음
-- =====================================================================

ALTER TABLE public.gwan_pages ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;
ALTER TABLE public.gwan_pages ADD COLUMN IF NOT EXISTS scheduled_by uuid REFERENCES public.accounts(id);
ALTER TABLE public.gwan_pages ADD COLUMN IF NOT EXISTS scheduled_title text;
ALTER TABLE public.gwan_pages ADD COLUMN IF NOT EXISTS scheduled_blocks jsonb;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gwan_pages_schedule_check') THEN
    ALTER TABLE public.gwan_pages ADD CONSTRAINT gwan_pages_schedule_check CHECK (
      (scheduled_at IS NULL AND scheduled_blocks IS NULL AND scheduled_title IS NULL)
      OR (scheduled_at IS NOT NULL AND scheduled_by IS NOT NULL AND scheduled_title IS NOT NULL
          AND jsonb_typeof(scheduled_blocks) = 'array' AND jsonb_array_length(scheduled_blocks) BETWEEN 1 AND 30));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS gwan_pages_scheduled_idx ON public.gwan_pages (scheduled_at) WHERE scheduled_at IS NOT NULL;
COMMENT ON COLUMN public.gwan_pages.scheduled_at IS 'v10.661 (D315) 예약 게시 시각 — 그때의 내용은 scheduled_title · scheduled_blocks(SUPER 가 예약할 때 뜬 초안)';

CREATE TABLE IF NOT EXISTS public.gwan_page_previews (
  token       text PRIMARY KEY CHECK (token ~ '^[0-9a-f]{40}$'),
  page_id     bigint NOT NULL REFERENCES public.gwan_pages(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  created_by  uuid REFERENCES public.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '72 hours')
);
CREATE INDEX IF NOT EXISTS gwan_page_previews_page_idx ON public.gwan_page_previews (page_id);
COMMENT ON TABLE public.gwan_page_previews IS 'v10.666 (D315) 관 페이지 미리보기 링크 — 로그인 없이 초안 보기 · 24시간(최대 72) · 끊으면 revoked_at';

CREATE TABLE IF NOT EXISTS public.gwan_page_views (
  page_id  bigint NOT NULL REFERENCES public.gwan_pages(id) ON DELETE CASCADE,
  day      date NOT NULL,
  views    integer NOT NULL DEFAULT 0 CHECK (views >= 0),
  PRIMARY KEY (page_id, day)
);
COMMENT ON TABLE public.gwan_page_views IS 'v10.667 (D315) 관 페이지 방문 수 — 페이지 · 날(서울)마다 한 줄 · 개인 정보 없음';

INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('POST', '/admin/gwan-pages/{id}/schedule', 'gwan-ux', 'EDIT'),
  ('POST', '/admin/gwan-pages/{id}/translate', 'gwan-ux', 'EDIT'),
  ('POST', '/admin/gwan-pages/{id}/previews', 'gwan-ux', 'EDIT'),
  ('DELETE', '/admin/gwan-pages/{id}/previews/{token}', 'gwan-ux', 'EDIT'),
  ('GET', '/admin/gwan-pages/{id}/views', 'gwan-ux', 'VIEW'),
  ('GET', '/admin/gwan-pages/{id}/views', 'gwans', 'VIEW')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

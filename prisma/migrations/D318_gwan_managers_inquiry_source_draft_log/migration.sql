-- =====================================================================
-- D318 (v10.680 · 681 · 684 · docs/799) 관 담당자 · 문의 블록(1:1 문의 출처) · 관 페이지 초안 고친 기록
--
--   대표 11/24 「다음개발목록」 → 5개 모두.
--   ① gwan_managers — 관마다 맡은 운영자(운영 역할 ADMIN · SUPER 계정만 · 서버) · 첫째 담당자는 그 관 페이지 문의의 처음 담당 · 7일 초안 알림에 이름
--   ② inquiries.source_gwan · source_page — 관 페이지 「문의 받기」 블록에서 온 1:1 문의(관 코드 · 페이지 주소 · 운영 답변함에 표시)
--   ⑤ gwan_page_draft_log — 초안 저장마다 한 줄(누가 · 언제 · 블록 수 · 바뀐 블록 수 · 제목 바뀜) · 쌓기만 · 페이지를 지우면 함께
--   권한 주소 표 3줄 · 지우는 문장 없음 · 다시 돌려도 같음 · RAISE 없음
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.gwan_managers (
  gwan_code   text NOT NULL REFERENCES public.gwans(code) ON DELETE CASCADE,
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  sort_order  integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 99),
  created_by  uuid REFERENCES public.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gwan_code, account_id)
);
COMMENT ON TABLE public.gwan_managers IS 'v10.680 (D318) 관 담당 운영자 — sort_order 가장 작은 사람이 첫째(그 관 페이지 문의의 처음 담당)';

ALTER TABLE public.inquiries ADD COLUMN IF NOT EXISTS source_gwan text;
ALTER TABLE public.inquiries ADD COLUMN IF NOT EXISTS source_page text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inquiries_source_fmt') THEN
    ALTER TABLE public.inquiries ADD CONSTRAINT inquiries_source_fmt CHECK (
      (source_gwan IS NULL OR source_gwan ~ '^[A-Z]{3,4}$') AND (source_page IS NULL OR (source_gwan IS NOT NULL AND source_page ~ '^(home|[a-z0-9][a-z0-9-]{1,39})$')));
  END IF;
END $$;
COMMENT ON COLUMN public.inquiries.source_gwan IS 'v10.681 (D318) 관 페이지 「문의 받기」 블록에서 온 문의의 관 코드';

CREATE TABLE IF NOT EXISTS public.gwan_page_draft_log (
  id             bigserial PRIMARY KEY,
  page_id        bigint NOT NULL REFERENCES public.gwan_pages(id) ON DELETE CASCADE,
  at             timestamptz NOT NULL DEFAULT now(),
  by             uuid REFERENCES public.accounts(id),
  blocks         integer NOT NULL CHECK (blocks BETWEEN 0 AND 30),
  changed        integer NOT NULL CHECK (changed >= 0),
  title_changed  boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS gwan_page_draft_log_page_idx ON public.gwan_page_draft_log (page_id, at DESC);
COMMENT ON TABLE public.gwan_page_draft_log IS 'v10.684 (D318) 관 페이지 초안 저장 기록 — 바뀐 블록 수는 자리마다 비교(더함 · 뺌 포함)';

INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/gwans/{code}/managers', 'gwans', 'VIEW'),
  ('PUT', '/admin/gwans/{code}/managers', 'gwans', 'EDIT'),
  ('GET', '/admin/gwan-pages/{id}/draft-log', 'gwan-ux', 'VIEW')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

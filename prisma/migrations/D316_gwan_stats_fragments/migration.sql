-- =====================================================================
-- D316 (v10.672 · v10.674 · docs/797) 관 현황판 권한 주소 · 관 페이지 공통 조각
--
--   대표 11/24 「다음개발」 → 4개 모두.
--   ① 관 현황판 — GET /admin/gwans/{code}/stats(SUPER · 읽기만 · 표 더하지 않음)
--   ③ 공통 조각 — 여러 페이지에 넣는 블록 묶음(1 ~ 10개). 페이지 초안에는 「조각 블록」(FRAGMENT · 조각 번호)만 두고,
--      게시 · 예약 · 미리보기 · 번역 때 서버가 그때의 조각 블록으로 펼침(게시된 판은 펼친 블록 그대로 — 조각을 고쳐도 다시 게시 전까지 화면은 그대로)
--      조각을 쓰는 페이지가 있으면 지우지 못함(서버 422 · 초안 jsonb 안 번호를 봄)
--   게시 판에 펼치기 전 초안(source) 칸 · 권한 주소 표 7줄 · 지우는 문장 없음 · 다시 돌려도 같음 · RAISE 없음
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.gwan_page_fragments (
  id          bigserial PRIMARY KEY,
  name        text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
  blocks      jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(blocks) = 'array' AND jsonb_array_length(blocks) <= 10),
  created_by  uuid REFERENCES public.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES public.accounts(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS gwan_page_fragments_name_uniq ON public.gwan_page_fragments (lower(btrim(name)));
COMMENT ON TABLE public.gwan_page_fragments IS 'v10.674 (D316) 관 페이지 공통 조각 — 블록 1 ~ 10 · 페이지 초안의 FRAGMENT 블록이 가리킴 · 게시 때 펼침';

INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/gwans/{code}/stats', 'gwans', 'VIEW'),
  ('GET', '/admin/gwan-fragments', 'gwan-ux', 'VIEW'),
  ('POST', '/admin/gwan-fragments', 'gwan-ux', 'EDIT'),
  ('GET', '/admin/gwan-fragments/{id}', 'gwan-ux', 'VIEW'),
  ('PATCH', '/admin/gwan-fragments/{id}', 'gwan-ux', 'EDIT'),
  ('DELETE', '/admin/gwan-fragments/{id}', 'gwan-ux', 'EDIT'),
  ('GET', '/admin/gwan-fragments', 'gwans', 'VIEW')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

-- 게시 판에 「펼치기 전 초안」을 함께 둠 — 조각이 든 페이지도 「초안이 게시 판과 다름」을 바르게 셈(없으면 blocks 와 비교)
ALTER TABLE public.gwan_page_versions ADD COLUMN IF NOT EXISTS source jsonb;
COMMENT ON COLUMN public.gwan_page_versions.source IS 'v10.674 (D316) 게시할 때의 초안(조각 블록을 펼치기 전) — 초안이 바뀌었는지 비교용 · 화면은 blocks';

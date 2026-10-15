-- v10.31 (w1 · 10/10 시안 기준 지시) — 후기 작성(SB-HOM-RVW-010) 시안 칸: 「무엇이 좋았습니까」 칩 5개(복수) · 수정 시각.
--   시안 안내 「후기는 수정할 수 있지만 삭제되지 않습니다」 → 같은 거래에 다시 쓰면 고칩니다(updated_at). 삭제 경로는 만들지 않습니다.
--   빈 후기(별점만 · 내용 없음)는 받지 않습니다 — 칩 1개 이상 또는 내용 10자 이상(서버 검사 · 결함 중).
ALTER TABLE public.deal_reviews
  ADD COLUMN IF NOT EXISTS tags       text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

DO $$ BEGIN
  ALTER TABLE public.deal_reviews ADD CONSTRAINT deal_reviews_tags_check
    CHECK (tags <@ ARRAY['연락이 빨랐습니다','조건을 정확히 알려줬습니다','현장을 잘 압니다','무리한 권유가 없었습니다','사후 확인까지 해줬습니다']::text[]);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON COLUMN public.deal_reviews.tags IS '시안 「무엇이 좋았습니까」 칩(고정 5종 · 복수).';

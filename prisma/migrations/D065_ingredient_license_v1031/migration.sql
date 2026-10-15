-- v10.31 (10/10 시안 기준 · 묶음 w3 · SB-HLT-CAT-030/040) — 시안 성분 카드 · 성분 상세의 「자격 필요」 꼬리표.
--   건강기능식품의 기능성 원료(시안 ING reg:1)는 팔려면 건강기능식품 판매업 신고 등 자격이 필요합니다 — 성분마다 표시합니다.
--   값은 시안의 성분 표(reg) 그대로입니다. 운영이 바꿀 수 있습니다(새 성분은 기본 false).
ALTER TABLE public.ingredients ADD COLUMN IF NOT EXISTS needs_license boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.ingredients.needs_license IS '건강기능식품 기능성 원료 — 팔려면 자격(건강기능식품 판매업 신고 등) 필요 · 시안 「자격 필요」 꼬리표 · v10.31';
UPDATE public.ingredients SET needs_license = true
 WHERE code IN ('VITC','VITD','CALC','OMEGA3','LUTEIN','PROBIO','MULTI','MAGNE','MILK','MSM','SAWPAL','COLLA','GARCI','THEAN','PS','MELA','REDGIN')
   AND NOT needs_license;

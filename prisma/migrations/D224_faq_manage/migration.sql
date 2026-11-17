-- v10.332 (docs/463) — 고객센터 홈 · 운영 화면 「자주 묻는 질문」 관리
--   대표 11/17 「고객센터 링크 추가 · 보통의 고객센터 기능(당근 · 네이버 참조)」 → 「기본 + 운영 화면 FAQ 관리」.
--   faqs 에 칸 두 개를 더합니다(지우는 문장 없음 · 다시 돌려도 같음):
--     topic   고객센터 분야 탭 — ACCOUNT 회원 · 가입 / DEAL 소개 · 거래 / MONEY 수수료 · 정산 · 포인트 / MALL 소개몰 / ADS 광고 · 구독 / SAFETY 안전 · 신고 · 분쟁 / ETC 기타
--   is_top  「많이 찾는 질문」에 올림(운영자가 고름 · 10개까지 화면에 나감)
--   지금 있는 질문은 category(한글 분류)로 분야를 처음 한 번 채웁니다. 운영 화면에서 바꿀 수 있습니다.
ALTER TABLE public.faqs
  ADD COLUMN IF NOT EXISTS topic  text    NOT NULL DEFAULT 'ETC',
  ADD COLUMN IF NOT EXISTS is_top boolean NOT NULL DEFAULT false;
DO $$ BEGIN
  ALTER TABLE public.faqs ADD CONSTRAINT faqs_topic_check CHECK (topic IN ('ACCOUNT','DEAL','MONEY','MALL','ADS','SAFETY','ETC'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON COLUMN public.faqs.topic IS 'v10.332 (D224) 고객센터 분야 탭 — ACCOUNT · DEAL · MONEY · MALL · ADS · SAFETY · ETC';
COMMENT ON COLUMN public.faqs.is_top IS 'v10.332 (D224) 고객센터 「많이 찾는 질문」에 올림(10개까지 · sort_order 순)';

UPDATE public.faqs SET topic = CASE
    WHEN category IN ('가입', '등급', '자격') THEN 'ACCOUNT'
    WHEN category IN ('이용', '검수', '귀속', '계약', '부담', '부동산', '신뢰') THEN 'DEAL'
    WHEN category IN ('수수료', '수익', '세금', '대금', '정산', '포인트') THEN 'MONEY'
    WHEN category IN ('구독', '광고') THEN 'ADS'
    WHEN category IN ('소개몰', '주문', '배송', '반품') THEN 'MALL'
    WHEN category IN ('분쟁', '신고', '안전') THEN 'SAFETY'
    ELSE 'ETC' END
 WHERE topic = 'ETC';

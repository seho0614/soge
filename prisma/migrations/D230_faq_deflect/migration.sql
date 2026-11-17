-- v10.340 (docs/473) — 고객센터 문의하기 폼 「혹시 이 질문인가요?」 → 「이걸로 해결됨」 셈
--   대표 11/17 「다음개발」 → ① 문의 전 비슷한 질문 · ② 답변 만족도 · ③ 리드관 운영 알림 · ④ 회원용 이용 흐름 「모두」 · 「승인 + 통과하면 병합」. 지우는 문장 없음 · 다시 돌려도 같음.
ALTER TABLE public.faq_daily ADD COLUMN IF NOT EXISTS deflect integer NOT NULL DEFAULT 0 CHECK (deflect >= 0);
COMMENT ON COLUMN public.faq_daily.deflect IS 'v10.340 (D230) 문의하기 폼에서 이 질문을 보고 「이걸로 해결됨」을 누른 수(사람 정보 없음) — 문의 전 해결';

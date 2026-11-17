-- v10.336 (docs/469) — 고객센터 찾기에서 「못 찾은 낱말」 → 자주 묻는 질문 후보
--   대표 11/17 「다음개발」 → ① 못 찾은 질문 → FAQ 후보 · 「승인 + 통과하면 병합」. 지우는 문장 없음 · 다시 돌려도 같음.
--   사람 정보는 남기지 않습니다(낱말 · 날짜 · 횟수만). 숫자 4자리 이상 · @ · 주소 모양은 서버가 받지 않습니다.

CREATE TABLE IF NOT EXISTS public.faq_search_misses (
  word text NOT NULL CHECK (char_length(word) BETWEEN 2 AND 40),
  day  date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Seoul')::date,
  hits integer NOT NULL DEFAULT 0 CHECK (hits >= 0),
  PRIMARY KEY (word, day)
);
COMMENT ON TABLE public.faq_search_misses IS 'v10.336 (D228) 고객센터 찾기 결과 0건 낱말 하루 셈 — 사람 정보 없음 · 운영 화면 「자주 묻는 질문」 「못 찾은 낱말 30일」';

CREATE TABLE IF NOT EXISTS public.faq_search_miss_done (
  word    text PRIMARY KEY CHECK (char_length(word) BETWEEN 2 AND 40),
  done_by uuid REFERENCES public.accounts(id),
  done_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.faq_search_miss_done IS 'v10.336 (D228) 운영자가 「다룸」으로 표시한 못 찾은 낱말 — 다룬 뒤 다시 찾으면 목록에 다시 나옴';

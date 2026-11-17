-- v10.334 (docs/465) — 고객센터 질문 「도움이 되었나요?」 · 조회 수 · 질문 초안(숨김) · 1:1 문의 답변 틀
--   대표 11/17 「남은 개발후보 모두 개발」 → v10.334 ① ② ③ 묶음 · 「승인 + 통과하면 병합」. 지우는 문장 없음 · 다시 돌려도 같음.

-- ① 질문별 하루 셈(펼침 · 도움 됨 · 도움 안 됨) — 「많이 찾는 질문 후보」는 최근 30일 펼침 순
CREATE TABLE IF NOT EXISTS public.faq_daily (
  faq_id uuid NOT NULL REFERENCES public.faqs(id),
  day    date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Seoul')::date,
  views  integer NOT NULL DEFAULT 0 CHECK (views >= 0),
  yes    integer NOT NULL DEFAULT 0 CHECK (yes >= 0),
  no     integer NOT NULL DEFAULT 0 CHECK (no >= 0),
  PRIMARY KEY (faq_id, day)
);
COMMENT ON TABLE public.faq_daily IS 'v10.334 (D226) 고객센터 질문 하루 셈 — 펼침(views) · 「도움이 되었나요?」 예(yes) · 아니오(no). 사람 정보 없음(같은 브라우저 하루 한 번은 화면이 막음)';

-- ③ 1:1 문의 답변 틀 — 운영 화면 「1:1 문의」에서 골라 답변 칸에 채움(보내기 전 고칠 수 있음)
CREATE TABLE IF NOT EXISTS public.inquiry_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title      text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 40),
  body       text NOT NULL CHECK (char_length(body) BETWEEN 2 AND 4000),
  sort_order integer NOT NULL DEFAULT 100 CHECK (sort_order BETWEEN 0 AND 9999),
  is_active  boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES public.accounts(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.inquiry_templates IS 'v10.334 (D226) 1:1 문의 답변 틀 — 지우기 없음(숨기기) · ADMIN · SUPER 가 운영 화면에서 고침';

INSERT INTO public.inquiry_templates (title, body, sort_order)
SELECT v.t, v.b, v.o FROM (VALUES
  ('접수 확인', E'안녕하세요, 소개뱅크 고객센터입니다.\n문의 주신 내용을 확인하고 있습니다. 확인이 끝나는 대로 이 문의로 다시 답변드리겠습니다.\n감사합니다.', 10),
  ('정산 일정 안내', E'안녕하세요, 소개뱅크 고객센터입니다.\n소개비는 계약서에 양측이 서명해 성사가 확정되면 정산이 신청되고, 승인 뒤 매주 수요일에 지급됩니다.\n진행 상황은 나의공간 › 정산 내역에서 보실 수 있습니다.\n감사합니다.', 20),
  ('본인인증 안내', E'안녕하세요, 소개뱅크 고객센터입니다.\n소개비를 받으시려면 본인인증이 필요합니다. 나의공간 › 내 정보에서 본인인증을 마쳐 주십시오.\n사업자로 받으시려면 사업자 인증을 함께 진행해 주십시오.\n감사합니다.', 30),
  ('분쟁은 분쟁 접수로', E'안녕하세요, 소개뱅크 고객센터입니다.\n거래와 관련된 분쟁은 1:1 문의가 아니라 고객센터 › 분쟁 접수에서 신청해 주셔야 그 거래의 정산이 보류되고 조정이 시작됩니다.\n번거로우시겠지만 분쟁 접수로 다시 신청해 주십시오.\n감사합니다.', 40),
  ('처리 완료', E'안녕하세요, 소개뱅크 고객센터입니다.\n요청하신 내용을 처리했습니다. 같은 문제가 다시 생기면 이 문의에 이어 알려 주십시오.\n이용해 주셔서 감사합니다.', 50)
) AS v(t, b, o)
WHERE NOT EXISTS (SELECT 1 FROM public.inquiry_templates);

-- ② 고객센터 질문 초안 — 질문이 적은 분야를 채움. **모두 숨김(is_active false)** — 대표 확인 뒤 운영 화면 「자주 묻는 질문」에서 「보이기」
INSERT INTO public.faqs (category, question, answer, topic, channels, keywords, sort_order, is_active)
SELECT v.c, v.q, v.a, v.t, ARRAY['FAQ','CS']::text[], v.k, v.o, false FROM (VALUES
  ('소개몰', '소개몰 배송비는 얼마인가요?', '소개몰 상품은 모두 배송비 무료입니다.', 'MALL', ARRAY['배송비','무료'], 300),
  ('소개몰', '단순 변심으로 반품하면 비용이 드나요?', '단순 변심 반품은 왕복 배송비 6,000원을 빼고 환불합니다. 발송 전 취소와 파손 · 오배송 · 표시와 다름 · 배송 지연처럼 판매자 사정이면 전액 환불합니다.', 'MALL', ARRAY['반품','변심','배송비'], 301),
  ('소개몰', '환불은 언제 되나요?', '반품 상품을 받은 날부터 영업일 3일 안에 환불합니다.', 'MALL', ARRAY['환불','언제'], 302),
  ('소개몰', '교환하려면 어떻게 하나요?', '나의공간에서 교환을 신청합니다. 회원 사정의 교환은 신청할 때 교환 배송비 6,000원을 결제합니다. 교환할 상품이 품절이면 14일 동안 입고를 기다리고, 그 뒤에는 반품으로 바뀌며 이때는 배송비를 빼지 않습니다.', 'MALL', ARRAY['교환','품절'], 303),
  ('소개몰', '주문 일부만 반품할 수 있나요?', '반품은 주문 전체 단위로만 받습니다. 일부 품목이나 수량만 고르는 반품은 없습니다.', 'MALL', ARRAY['일부','부분 반품'], 304),
  ('소개몰', '개봉한 상품도 반품할 수 있나요?', '판매 약관의 반품 조건에 따릅니다. 식품 · 화장품은 개봉하면 다시 팔 수 없어 재고로 돌리지 않습니다. 자세한 조건은 판매 약관과 고객센터 문의로 확인해 주십시오.', 'MALL', ARRAY['개봉','반품'], 305),
  ('광고', '광고는 어디에 나가나요?', '광고를 신청할 때 고른 광고 자리에 나가고, 광고라는 표시가 함께 붙습니다. 자리별 안내는 광고 신청 화면에서 볼 수 있습니다.', 'ADS', ARRAY['광고 자리','노출'], 310),
  ('구독', '구독 요금제는 어떻게 바꾸나요?', '나의공간 › 구독에서 요금제를 바꿀 수 있습니다. 금액과 한도는 요금제 화면에 나온 값을 따릅니다.', 'ADS', ARRAY['요금제','변경'], 312),
  ('신고', '사기가 의심되면 어떻게 하나요?', '거래를 멈추고 그 글이나 회원을 신고해 주십시오. 안전 거래 수칙과 피해 사례는 고객센터 › 사기 · 신고 안내에서 볼 수 있습니다. 돈을 이미 보냈다면 경찰(112)에도 바로 신고하십시오.', 'SAFETY', ARRAY['사기','의심','신고'], 320),
  ('분쟁', '분쟁 접수와 1:1 문의는 무엇이 다른가요?', '거래와 관련된 다툼은 분쟁 접수로 신청해야 그 거래의 정산이 보류되고 조정이 시작됩니다. 1:1 문의는 이용 방법 · 계정 같은 일반 문의 창구입니다.', 'SAFETY', ARRAY['분쟁','문의 차이'], 321),
  ('신고', '신고한 결과는 어디서 보나요?', '나의공간 › 신고 내역에서 처리 상태를 볼 수 있습니다.', 'SAFETY', ARRAY['신고 결과','신고 내역'], 322),
  ('가입', '비밀번호를 잊어버렸어요.', '로그인 화면의 「비밀번호 찾기」에서 가입한 이메일로 재설정 링크를 받을 수 있습니다.', 'ACCOUNT', ARRAY['비밀번호','잊어'], 330),
  ('가입', '회원 탈퇴는 어떻게 하나요?', '나의공간 › 내 정보에서 탈퇴를 신청할 수 있습니다. 법령에 따라 보관해야 하는 거래 기록은 정해진 기간 동안 남습니다.', 'ACCOUNT', ARRAY['탈퇴'], 331),
  ('가입', '로그인한 기기를 모두 로그아웃하고 싶어요.', '나의공간 › 내 정보의 로그인 기록에서 「모든 기기 로그아웃」을 누르면 다른 기기의 로그인이 모두 끊깁니다.', 'ACCOUNT', ARRAY['로그아웃','기기'], 332)
) AS v(c, q, a, t, k, o)
WHERE NOT EXISTS (SELECT 1 FROM public.faqs f WHERE f.question = v.q);

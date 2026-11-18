-- v10.347 (docs/481) — 사용자 웹 이용 흐름(/guide/flows)을 운영 화면에서 고치기
--   대표 11/18 「다음개발」 → ③ 이용 흐름 운영에서 고치기 · 「승인 + 통과하면 병합」.
--   글은 판으로 쌓습니다(고치기 · 지우기 없음 — 고치면 새 판 · v10.339 업무 안내와 같은 방식). 고치기는 SUPER.
--   처음 판은 v10.343 사전(policy.flows) 글 그대로(한 · 영). 지우는 문장 없음 · 다시 돌려도 같음.

CREATE TABLE IF NOT EXISTS public.guide_flows (
  id         bigserial PRIMARY KEY,
  code       text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{1,19}$'),
  version    integer NOT NULL CHECK (version > 0),
  title_ko   text NOT NULL CHECK (char_length(title_ko) BETWEEN 2 AND 60),
  who_ko     text NOT NULL CHECK (char_length(who_ko) BETWEEN 2 AND 60),
  steps_ko   jsonb NOT NULL CHECK (jsonb_typeof(steps_ko) = 'array' AND jsonb_array_length(steps_ko) BETWEEN 1 AND 10),
  title_en   text CHECK (title_en IS NULL OR char_length(title_en) BETWEEN 2 AND 100),
  who_en     text CHECK (who_en IS NULL OR char_length(who_en) BETWEEN 2 AND 100),
  steps_en   jsonb CHECK (steps_en IS NULL OR (jsonb_typeof(steps_en) = 'array' AND jsonb_array_length(steps_en) BETWEEN 1 AND 10)),
  href       text NOT NULL CHECK (href ~ '^/[A-Za-z0-9/_?=&.-]{0,120}$'),
  sort_order integer NOT NULL DEFAULT 100 CHECK (sort_order BETWEEN 0 AND 9999),
  is_active  boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, version)
);
COMMENT ON TABLE public.guide_flows IS 'v10.347 (D233) 사용자 웹 이용 흐름 — 흐름마다 판을 쌓음(고치면 새 판 · 지우기 없음) · steps = 글 배열 · 영어 칸이 비면 사용자 웹은 사전 영어 글 · 고치기 SUPER';

CREATE OR REPLACE FUNCTION public.fn_guide_flows_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'GUIDE_FLOW: 이용 흐름은 고치거나 지우지 않고 새 판을 더합니다.';
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_guide_flows_guard' AND tgrelid = 'public.guide_flows'::regclass) THEN
    CREATE TRIGGER trg_guide_flows_guard BEFORE UPDATE OR DELETE ON public.guide_flows FOR EACH ROW EXECUTE FUNCTION public.fn_guide_flows_guard();
  END IF;
END $$;

CREATE OR REPLACE VIEW public.v_guide_flow_current AS
SELECT DISTINCT ON (code) * FROM public.guide_flows ORDER BY code, version DESC;
COMMENT ON VIEW public.v_guide_flow_current IS 'v10.347 (D233) 흐름마다 가장 높은 판';

INSERT INTO public.guide_flows (code, title_ko, who_ko, steps_ko, title_en, who_en, steps_en, href, sort_order, version)
SELECT v.code, v.tk, v.wk, v.sk, v.te, v.we, v.se, v.href, v.ord, 1 FROM (VALUES
  ('join', '가입', '누구나', '["이메일 · 비밀번호를 적고 약관에 동의합니다(필수 · 선택 따로).", "추천 코드가 있으면 적습니다(선택).", "소개비를 받거나 매물을 올릴 때 본인인증을 합니다.", "나의공간에서 알림 · 정산 · 추천 관계도를 봅니다."]'::jsonb, 'Sign up', 'Anyone', '["Enter your email and password and agree to the terms (required and optional separately).", "Enter a referral code if you have one (optional).", "Verify your identity when you receive referral fees or post listings.", "See notifications, settlements and your referral tree in My Space."]'::jsonb, '/signup', 10),
  ('earn', '소개하고 소개비 받기', '회원(개인 포함)', '["업종을 골라 매물이나 요청을 등록합니다.", "운영 검수를 통과하면 목록에 나옵니다.", "매물마다 소개코드를 받아 아는 사람에게 전합니다.", "거래 · 계약이 성사됩니다.", "받을 계좌 확인을 마치면 소개비가 지급됩니다."]'::jsonb, 'Refer and earn fees', 'Members (individuals too)', '["Choose a category and register a listing or request.", "It appears in the list after review.", "Get a referral code for each listing and share it with people you know.", "The deal and contract are completed.", "After your payout account is confirmed, the referral fee is paid."]'::jsonb, '/money', 20),
  ('consult', '생활 · 금융 상담 신청', '회원이 아니어도', '["업종(보험 · 의료 · 렌탈 · 청소 등)을 고릅니다.", "신청 내용을 적고 제3자 제공에 동의한 뒤 휴대폰 확인을 합니다.", "자격을 확인받은 인증 업체 한 곳에 전달됩니다(6개월 보관 뒤 파기).", "업체가 연락해 상담합니다."]'::jsonb, 'Request a life & finance consultation', 'Non-members too', '["Choose a field (insurance, medical, rental, cleaning and more).", "Write your request, agree to third-party sharing and verify your phone.", "It is shared with one certified provider qualified in that field (kept 6 months, then deleted).", "The provider contacts you."]'::jsonb, '/mall?axis=consult', 30),
  ('buy', '소개몰 구매 · 반품', '회원', '["상품을 골라 장바구니에 담고 주문 · 결제합니다.", "배송을 받습니다.", "반품은 주문 내역에서 신청합니다(화면에 나온 배송비 · 환불 규칙을 따름)."]'::jsonb, 'Buy and return at Sogae Mall', 'Members', '["Pick products, add them to the cart, then order and pay.", "Receive the delivery.", "Request a return from your order history (shipping and refund rules shown on screen apply)."]'::jsonb, '/health', 40),
  ('support', '고객센터 이용', '누구나', '["고객센터에서 질문을 찾거나 많이 찾는 질문을 봅니다.", "문의하기 폼에 제목을 적으면 비슷한 질문이 먼저 나옵니다.", "그래도 안 풀리면 문의를 보냅니다.", "내 문의 내역에서 답을 보고 「해결됨 / 아직 해결 안 됨」을 남깁니다."]'::jsonb, 'Use the customer center', 'Anyone', '["Search questions or browse popular questions in the customer center.", "When you type a title in the inquiry form, similar questions appear first.", "If that does not help, send the inquiry.", "See the answer in My inquiries and mark it Solved or Not solved yet."]'::jsonb, '/support/new', 50),
  ('partner', '상담 업체로 입점', '업체 회원', '["입점 신청에 업종 · 받을 지역 · 서류를 올립니다.", "운영 자격 심사를 기다립니다.", "소개캐시를 충전합니다(환불 · 세금계산서 있음).", "파트너센터에서 상담 신청(리드)을 받아 연락하고, 잘못 온 건은 72시간 안에 반려합니다.", "성과 · 정산을 확인합니다."]'::jsonb, 'Join as a consultation provider', 'Business members', '["Apply with your field, service area and documents.", "Wait for the qualification review.", "Top up Sogae Cash (refunds and tax invoices available).", "Receive consultation requests (leads) in the Partner Center, contact them, and reject wrong ones within 72 hours.", "Check performance and settlements."]'::jsonb, '/partner/apply', 60),
  ('affiliate', '제휴 파트너', '제휴 회원', '["제휴를 신청하고 승인을 받습니다.", "링크 · 자료를 받아 소개합니다.", "주문 · 수익 · 정산을 확인합니다.", "추천 관계도에서 내 아래 회원을 봅니다(이름은 가림)."]'::jsonb, 'Affiliate partner', 'Affiliate members', '["Apply for affiliation and get approved.", "Get links and materials and share them.", "Check orders, earnings and settlements.", "See members below you in the referral tree (names masked)."]'::jsonb, '/partners', 70)
) AS v(code, tk, wk, sk, te, we, se, href, ord)
WHERE NOT EXISTS (SELECT 1 FROM public.guide_flows g WHERE g.code = v.code);

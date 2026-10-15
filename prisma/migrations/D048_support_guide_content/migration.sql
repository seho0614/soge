-- v10.31 (w1 · 10/10 시안 기준 지시) — 고객센터 · 챗봇 · 이용안내 글(시안 D.content.bot · guide.faq · scCs FAQ)을 서버 자료(faqs)로.
--   시안은 글을 화면에 박았습니다 — 실제 웹은 FAQ 를 서버에서 받습니다(운영이 바꿈). 칸을 더합니다:
--     channels  어디에 보이나: FAQ(고객센터 기존) · CS(시안 고객센터 화면 FAQ) · GUIDE(이용안내 「자주 묻는 것」) · BOT(1:1 문의 챗봇 답)
--     keywords  챗봇이 질문을 고르는 낱말(시안 botMatch 의 k)
--     link_href · link_label   답 아래 「…에서 보기」 단추(시안 go) · handoff  사람이 판단할 일 — 상담원 연결 단추(시안 hand)
--   시안 글을 그대로 옮기되, 개발에 이미 있는 기능(개인 회원 가입 · 개인 정산)과 어긋나는 문장은 빼고 옮겼습니다(결정 기록 w1_decisions.md).
ALTER TABLE public.faqs
  ADD COLUMN IF NOT EXISTS channels   text[] NOT NULL DEFAULT ARRAY['FAQ'],
  ADD COLUMN IF NOT EXISTS keywords   text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS link_href  text,
  ADD COLUMN IF NOT EXISTS link_label text,
  ADD COLUMN IF NOT EXISTS handoff    boolean NOT NULL DEFAULT false;
DO $$ BEGIN
  ALTER TABLE public.faqs ADD CONSTRAINT faqs_channels_check CHECK (channels <@ ARRAY['FAQ','CS','GUIDE','BOT']::text[] AND cardinality(channels) >= 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.faqs ADD CONSTRAINT faqs_link_check CHECK (link_href IS NULL OR (link_href LIKE '/%' AND link_href NOT LIKE '//%'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 기존 FAQ 8건은 고객센터(FAQ) · 챗봇(BOT) 둘 다에 — 챗봇이 서버 정본 글로도 답하게 낱말을 붙입니다
UPDATE public.faqs SET channels = ARRAY['FAQ','BOT'],
       keywords = CASE question
         WHEN '소개비는 언제 받나요?' THEN ARRAY['소개비 언제','받나요']
         WHEN '플랫폼이 소개비에서 수수료를 떼나요?' THEN ARRAY['떼나','수수료','공제']
         WHEN '개인도 소개비를 받을 수 있나요?' THEN ARRAY['개인','받을 수']
         WHEN '등록한 매물이 왜 검수 중인가요?' THEN ARRAY['검수 중','왜 검수']
         WHEN '매물을 수정하면 어떻게 되나요?' THEN ARRAY['수정','고치']
         WHEN '분쟁을 접수하면 정산은 어떻게 되나요?' THEN ARRAY['분쟁','보류']
         WHEN '구독을 해지하면 어떻게 되나요?' THEN ARRAY['해지']
         WHEN '소개 이력은 어떻게 기록되나요?' THEN ARRAY['이력','기록']
         ELSE keywords END
 WHERE channels = ARRAY['FAQ'];

INSERT INTO public.faqs (category, question, answer, sort_order, is_active, channels, keywords, link_href, link_label, handoff)
SELECT '이용', '소개비는 얼마인가요?', '요율표가 없습니다. 소개비는 당사자끼리 협의해서 정합니다 (A-12). 플랫폼은 금액에 관여하지 않고, 정한 금액에서 한 푼도 떼지 않습니다 (INV-9).', 101, true, ARRAY['GUIDE','BOT']::text[], ARRAY['소개비','수수료','얼마']::text[], '/guide', '이용안내에서 보기', false
 WHERE NOT EXISTS (SELECT 1 FROM public.faqs WHERE question = '소개비는 얼마인가요?');
INSERT INTO public.faqs (category, question, answer, sort_order, is_active, channels, keywords, link_href, link_label, handoff)
SELECT '수익', '소개뱅크는 무엇으로 돈을 버나요?', '월 구독료와 초과 소개코드 발급비 두 가지입니다. 거래금액에 연동되는 수수료는 없습니다 (B-13R).', 102, true, ARRAY['GUIDE']::text[], ARRAY['수익','돈을 버','구독료']::text[], NULL, NULL, false
 WHERE NOT EXISTS (SELECT 1 FROM public.faqs WHERE question = '소개뱅크는 무엇으로 돈을 버나요?');
INSERT INTO public.faqs (category, question, answer, sort_order, is_active, channels, keywords, link_href, link_label, handoff)
SELECT '세금', '소개비에서 세금을 떼나요?', '떼지 않습니다. 플랫폼은 소개비에서 아무것도 공제하지 않습니다 (INV-9). 사업자 소개자는 세금계산서를 직접 발행합니다 (B-03).', 103, true, ARRAY['GUIDE']::text[], ARRAY['세금','원천','세금계산서']::text[], NULL, NULL, false
 WHERE NOT EXISTS (SELECT 1 FROM public.faqs WHERE question = '소개비에서 세금을 떼나요?');
INSERT INTO public.faqs (category, question, answer, sort_order, is_active, channels, keywords, link_href, link_label, handoff)
SELECT '대금', '에스크로는 언제 쓰나요?', '지금은 쓰지 않습니다. 소개뱅크는 거래 대금을 보관하지 않으며(INV-11), 제3자 예치는 별도 계약이 끝난 뒤에나 검토합니다. 대금은 당사자끼리 직접 주고받습니다.', 104, true, ARRAY['GUIDE','BOT']::text[], ARRAY['에스크로','안전거래','보관','대금']::text[], '/safety', '사고예방에서 보기', false
 WHERE NOT EXISTS (SELECT 1 FROM public.faqs WHERE question = '에스크로는 언제 쓰나요?');
INSERT INTO public.faqs (category, question, answer, sort_order, is_active, channels, keywords, link_href, link_label, handoff)
SELECT '가입', '개인도 가입할 수 있나요?', '가입하실 수 있습니다. 요청 등록과 소개 참여는 개인회원도 가능합니다. 다만 상품·서비스 판매 등록과 소개 캠페인은 인증 사업자만 할 수 있습니다.', 105, true, ARRAY['GUIDE','BOT']::text[], ARRAY['개인','일반인','가입']::text[], '/signup', '가입하기', false
 WHERE NOT EXISTS (SELECT 1 FROM public.faqs WHERE question = '개인도 가입할 수 있나요?');
INSERT INTO public.faqs (category, question, answer, sort_order, is_active, channels, keywords, link_href, link_label, handoff)
SELECT '등급', '등급은 어떻게 정해지나요?', '등록자가 카테고리를 고르면 카테고리가 등급을 결정합니다. 등급을 직접 고르는 것이 아니고, 최종 확정은 운영자 검수입니다 (A-11).', 106, true, ARRAY['GUIDE','BOT']::text[], ARRAY['등급','골든','실버','브론즈','카테고리']::text[], '/guide', '이용안내에서 보기', false
 WHERE NOT EXISTS (SELECT 1 FROM public.faqs WHERE question = '등급은 어떻게 정해지나요?');
INSERT INTO public.faqs (category, question, answer, sort_order, is_active, channels, keywords, link_href, link_label, handoff)
SELECT '부담', '소개비는 누가 내나요?', '관마다 다릅니다. 소개장터는 공급 기업, 안심소개는 양도인 · 매도인, 소개창업은 양도인 · 본사가 부담합니다. 리스팅 상세에 부담 주체가 표시되므로 문의 전에 확인해 주세요.', 201, true, ARRAY['CS']::text[], ARRAY['누가 내','부담']::text[], NULL, NULL, false
 WHERE NOT EXISTS (SELECT 1 FROM public.faqs WHERE question = '소개비는 누가 내나요?');
INSERT INTO public.faqs (category, question, answer, sort_order, is_active, channels, keywords, link_href, link_label, handoff)
SELECT '가입', '가입 승인은 얼마나 걸리나요?', '영업일 기준 1일 이내입니다. 사업자등록 상태조회는 자동으로 처리되고, 운영자 확인만 남습니다.', 202, true, ARRAY['CS']::text[], ARRAY['가입 승인','승인']::text[], NULL, NULL, false
 WHERE NOT EXISTS (SELECT 1 FROM public.faqs WHERE question = '가입 승인은 얼마나 걸리나요?');
INSERT INTO public.faqs (category, question, answer, sort_order, is_active, channels, keywords, link_href, link_label, handoff)
SELECT '검수', '등록한 소개가 왜 안 보이나요?', '검수 승인 전에는 어떤 경로로도 노출되지 않습니다. 검수는 24시간 이내에 끝납니다.', 203, true, ARRAY['CS']::text[], ARRAY['안 보','노출']::text[], NULL, NULL, false
 WHERE NOT EXISTS (SELECT 1 FROM public.faqs WHERE question = '등록한 소개가 왜 안 보이나요?');
INSERT INTO public.faqs (category, question, answer, sort_order, is_active, channels, keywords, link_href, link_label, handoff)
SELECT '귀속', '소개코드로 들어왔는데 다른 사람에게 소개비가 갔습니다', '처음 유입된 소개코드에 90일간 귀속됩니다. 그 뒤에 다른 코드로 들어와도 최초 코드가 유지됩니다.', 204, true, ARRAY['CS']::text[], ARRAY['다른 사람','소개코드']::text[], NULL, NULL, false
 WHERE NOT EXISTS (SELECT 1 FROM public.faqs WHERE question = '소개코드로 들어왔는데 다른 사람에게 소개비가 갔습니다');
INSERT INTO public.faqs (category, question, answer, sort_order, is_active, channels, keywords, link_href, link_label, handoff)
SELECT '부동산', '부동산도 소개할 수 있나요?', '사업용 부동산은 제휴 공인중개사만 등록할 수 있습니다. 중개는 공인중개사가 하고, 소개뱅크는 중개보수를 받지 않습니다.', 205, true, ARRAY['CS']::text[], ARRAY['부동산','중개']::text[], NULL, NULL, false
 WHERE NOT EXISTS (SELECT 1 FROM public.faqs WHERE question = '부동산도 소개할 수 있나요?');
INSERT INTO public.faqs (category, question, answer, sort_order, is_active, channels, keywords, link_href, link_label, handoff)
SELECT '정산', '정산은 언제 받나요', '양측이 성사를 확인해야 정산을 신청할 수 있습니다 (INV-3). 신청 → 관리자 승인 → 지급 순서이고, 소개비 전액이 그대로 들어옵니다 — 공제는 없습니다.', 301, true, ARRAY['BOT']::text[], ARRAY['정산','지급','입금','언제']::text[], '/my/settlement', '정산 신청 화면으로', false
 WHERE NOT EXISTS (SELECT 1 FROM public.faqs WHERE question = '정산은 언제 받나요');
INSERT INTO public.faqs (category, question, answer, sort_order, is_active, channels, keywords, link_href, link_label, handoff)
SELECT '검수', '검수가 며칠째 안 끝나요', '검수 기준은 영업일 24시간입니다(SLA). 24시간을 넘기면 자동 안내가 나갑니다. 오래 머물러 있으면 상담원이 직접 확인합니다.', 302, true, ARRAY['BOT']::text[], ARRAY['검수','심사','며칠']::text[], NULL, NULL, true
 WHERE NOT EXISTS (SELECT 1 FROM public.faqs WHERE question = '검수가 며칠째 안 끝나요');
INSERT INTO public.faqs (category, question, answer, sort_order, is_active, channels, keywords, link_href, link_label, handoff)
SELECT '귀속', '소개코드가 언제 귀속되나요', '1:1 대화가 시작되는 순간 발급되고 그때부터 귀속됩니다 (INV-2 · 첫 접촉 90일). 소개받기는 예외로, 요청자가 제안을 수락한 시점입니다. 전화나 외부 연락으로만 진행하면 귀속되지 않습니다.', 303, true, ARRAY['BOT']::text[], ARRAY['소개코드','귀속','코드']::text[], '/my/deals', '내 소개 내역 보기', false
 WHERE NOT EXISTS (SELECT 1 FROM public.faqs WHERE question = '소개코드가 언제 귀속되나요');
INSERT INTO public.faqs (category, question, answer, sort_order, is_active, channels, keywords, link_href, link_label, handoff)
SELECT '구독', '구독료와 소개코드', '베이직 0원 · 스탠다드 49,000원(코드 월 3건) · 프로 149,000원(코드 월 15건)입니다. 한도를 넘겨 코드를 더 뽑으면 건당 30,000원 정액이고, 거래금액과는 무관합니다.', 304, true, ARRAY['BOT']::text[], ARRAY['구독','요금','코드 발급','베이직','스탠다드','프로']::text[], '/my/subscription', '구독 화면으로', false
 WHERE NOT EXISTS (SELECT 1 FROM public.faqs WHERE question = '구독료와 소개코드');
INSERT INTO public.faqs (category, question, answer, sort_order, is_active, channels, keywords, link_href, link_label, handoff)
SELECT '계약', '계약은 어떻게 진행하나요', '1:1 대화에서 조건을 맞추신 뒤 계약서를 요청하십시오. 조건 합의 → 양측 서명 → 양측 이행 확인 순서이며, 각 단계는 양측이 각각 눌러야 넘어갑니다. 한쪽이 혼자 진행할 수 없습니다.', 305, true, ARRAY['BOT']::text[], ARRAY['계약','계약서','서명','체결']::text[], '/my/contracts', '계약 진행에서 보기', false
 WHERE NOT EXISTS (SELECT 1 FROM public.faqs WHERE question = '계약은 어떻게 진행하나요');
INSERT INTO public.faqs (category, question, answer, sort_order, is_active, channels, keywords, link_href, link_label, handoff)
SELECT '계약', '계약서 조건을 바꾸면 어떻게 되나요', '상대의 합의가 무효가 되고 다시 받아야 합니다. 그러지 않으면 한쪽이 금액을 고쳐도 상대 동의가 남아 있게 됩니다. 서명한 뒤에는 아예 바꿀 수 없습니다 — 파기하고 다시 맺으셔야 합니다.', 306, true, ARRAY['BOT']::text[], ARRAY['조건 변경','금액 수정','조건 바꾸']::text[], '/my/contracts', '계약 진행에서 보기', false
 WHERE NOT EXISTS (SELECT 1 FROM public.faqs WHERE question = '계약서 조건을 바꾸면 어떻게 되나요');
INSERT INTO public.faqs (category, question, answer, sort_order, is_active, channels, keywords, link_href, link_label, handoff)
SELECT '신뢰', '소개 신뢰도가 무엇인가요', '인증 · 초대 동의율 · 성사 기록으로 매기는 0~99 점수입니다. 시작은 36.5점이라 신규도 불리하지 않고, 표본이 적으면 점수가 크게 움직이지 않습니다. 인정된 신고만 점수를 깎습니다 — 신고만으로는 깎이지 않습니다.', 307, true, ARRAY['BOT']::text[], ARRAY['신뢰도','점수','매너']::text[], NULL, NULL, false
 WHERE NOT EXISTS (SELECT 1 FROM public.faqs WHERE question = '소개 신뢰도가 무엇인가요');
INSERT INTO public.faqs (category, question, answer, sort_order, is_active, channels, keywords, link_href, link_label, handoff)
SELECT '신고', '신고하면 바로 내려가나요', '바로 내려가지 않고 검수 큐에 올라갑니다. 자동으로 내리면 여럿이 짜고 남의 등록을 내릴 수 있기 때문입니다. 처리 결과는 신고하신 분께 사유와 함께 알려 드립니다.', 308, true, ARRAY['BOT']::text[], ARRAY['신고','허위','가짜']::text[], NULL, NULL, false
 WHERE NOT EXISTS (SELECT 1 FROM public.faqs WHERE question = '신고하면 바로 내려가나요');
INSERT INTO public.faqs (category, question, answer, sort_order, is_active, channels, keywords, link_href, link_label, handoff)
SELECT '소개몰', '소개몰은 무엇을 파나요', '건강식품 · 건강기능식품 · 운동 재활 용품 · 위생 용품을 올리실 수 있습니다. 의약품과 의료 서비스는 올리실 수 없고, 의료기기는 광고만 가능합니다. 효능을 단정하는 표현(완치 · 암 예방 · 의사 추천)은 식품표시광고법 위반이라 등록되지 않습니다.', 309, true, ARRAY['BOT']::text[], ARRAY['건강','건강기능식품','홍삼','의약품']::text[], NULL, NULL, false
 WHERE NOT EXISTS (SELECT 1 FROM public.faqs WHERE question = '소개몰은 무엇을 파나요');
INSERT INTO public.faqs (category, question, answer, sort_order, is_active, channels, keywords, link_href, link_label, handoff)
SELECT '광고', '광고는 어디에 나가나요', '슬롯 7종이 있습니다 — 메인 상단 · 진입 · 플로팅 · 추천 상단 · 목록 인피드 · 관 랜딩 · 상세 하단. 인피드는 목록 8건마다 들어가며 반드시 ''광고''로 표기되고 추천 점수에는 넣지 않습니다. 단가는 정액(기간)입니다.', 310, true, ARRAY['BOT']::text[], ARRAY['광고','노출','배너','슬롯']::text[], NULL, NULL, false
 WHERE NOT EXISTS (SELECT 1 FROM public.faqs WHERE question = '광고는 어디에 나가나요');

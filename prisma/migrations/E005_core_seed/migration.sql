-- E005 소개뱅크 마이그레이션이 넣은 처음 자료(tools/gen-erp-schema.py · 회원 자료 아님 · docs/006)
-- 트리거(쌓기만 · 소개뱅크 표 확인)를 건너뛰려고 replica — RDS 는 마스터 사용자로(확인 필요)
SET session_replication_role = replica;
SET search_path = public;
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('CASH', '보통예금', 'ASSET', '103', '보통예금', 10, '계좌 입금 · 출금(광고 입금 · 정액 노출 입금 · 포인트 출금 실지급)', NULL, '2026-11-25 13:41:34.940762+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('PG_RECV', 'PG 정산 받을 돈', 'ASSET', '120', '미수금', 20, '카드 · PG 결제 승인 뒤 PG 사가 넣어 줄 돈(구독 · 소개코드 · 소개몰 직판 · 리드 캐시 충전)', NULL, '2026-11-25 13:41:34.940762+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('AR', '외상매출금', 'ASSET', '108', '외상매출금', 30, '광고 청구서 · 입점 수수료(받기 전)', NULL, '2026-11-25 13:41:34.940762+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('ADV', '선수금', 'LIABILITY', '259', '선수금', 40, '지금 쓰지 않음 — 리드 캐시는 충전 때 매출(11/19 대표)', NULL, '2026-11-25 13:41:34.940762+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('VAT_OUT', '부가세예수금', 'LIABILITY', '255', '부가세예수금', 50, '매출 부가세', NULL, '2026-11-25 13:41:34.940762+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('WHT', '예수금(원천세)', 'LIABILITY', '254', '예수금', 60, '포인트 출금 원천징수(소득세 · 지방소득세)', NULL, '2026-11-25 13:41:34.940762+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('REV_SUB', '구독 매출', 'REVENUE', '404', '용역매출', 100, '요금제 구독', NULL, '2026-11-25 13:41:34.940762+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('REV_REFCODE', '소개코드 매출', 'REVENUE', '404', '용역매출', 110, '소개코드 묶음 결제', NULL, '2026-11-25 13:41:34.940762+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('REV_AD', '광고 매출', 'REVENUE', '404', '용역매출', 120, '광고 청구서(공급가)', NULL, '2026-11-25 13:41:34.940762+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('REV_LEAD', '리드 매출', 'REVENUE', '404', '용역매출', 130, '리드 캐시 충전 때(11/19 대표 「충전 때 매출」 · 보너스 캐시는 매출 아님) · 환급은 반대', NULL, '2026-11-25 13:41:34.940762+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('REV_DIRECTORY', '정액 노출 매출', 'REVENUE', '404', '용역매출', 140, '상담 디렉터리 정액 노출', NULL, '2026-11-25 13:41:34.940762+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('REV_COMMISSION', '입점 수수료 매출', 'REVENUE', '411', '수수료수익', 150, '소개몰 입점 판매자 정산 수수료(판매 대금은 판매자 돈 · 우리 장부에 넣지 않음)', NULL, '2026-11-25 13:41:34.940762+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('REV_MALL', '상품 매출(과세)', 'REVENUE', '401', '상품매출', 160, '소개몰 직판 · 과세 상품 · 배송비', NULL, '2026-11-25 13:41:34.940762+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('REV_MALL_EXEMPT', '상품 매출(면세)', 'REVENUE', '401', '상품매출', 170, '소개몰 직판 · 면세 상품', NULL, '2026-11-25 13:41:34.940762+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('VAT_IN', '부가세대급금', 'ASSET', '135', '부가세대급금', 55, '매입 부가세(공제되는 것) — v10.392', NULL, '2026-11-25 13:41:35.140637+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('INVENTORY', '상품', 'ASSET', '146', '상품', 25, '소개몰 직판 재고(이동평균) — v10.395', NULL, '2026-11-25 13:41:35.140637+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('AP', '미지급금', 'LIABILITY', '253', '미지급금', 45, '매입 · 경비 청구(주기 전) — v10.392 · 393', NULL, '2026-11-25 13:41:35.140637+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('CARD_AP', '미지급금(법인카드)', 'LIABILITY', '253', '미지급금', 46, '법인카드 사용(카드 대금 내기 전) — v10.393', NULL, '2026-11-25 13:41:35.140637+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('COGS', '상품매출원가', 'EXPENSE', '451', '상품매출원가', 190, '직판 출고 원가(이동평균) — v10.395', NULL, '2026-11-25 13:41:35.140637+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('EXP_SALARY', '직원급여', 'EXPENSE', '802', '직원급여', 210, '급여 — v10.403 에서 씀', NULL, '2026-11-25 13:41:35.140637+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('EXP_WELFARE', '복리후생비', 'EXPENSE', '811', '복리후생비', 220, '식대 · 경조사 등', NULL, '2026-11-25 13:41:35.140637+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('EXP_TRAVEL', '여비교통비', 'EXPENSE', '812', '여비교통비', 230, '교통 · 출장', NULL, '2026-11-25 13:41:35.140637+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('EXP_ENTERTAIN', '기업업무추진비', 'EXPENSE', '813', '기업업무추진비', 240, '옛 접대비 — 매입 부가세 공제 안 됨', NULL, '2026-11-25 13:41:35.140637+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('EXP_COMM', '통신비', 'EXPENSE', '814', '통신비', 250, '전화 · 인터넷', NULL, '2026-11-25 13:41:35.140637+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('EXP_TAXES', '세금과공과', 'EXPENSE', '817', '세금과공과', 260, '면허세 · 협회비 등', NULL, '2026-11-25 13:41:35.140637+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('EXP_RENT', '지급임차료', 'EXPENSE', '819', '지급임차료', 270, '사무실 임대료', NULL, '2026-11-25 13:41:35.140637+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('EXP_SUPPLIES', '소모품비', 'EXPENSE', '830', '소모품비', 280, '사무용품', NULL, '2026-11-25 13:41:35.140637+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('EXP_FEE', '지급수수료', 'EXPENSE', '831', '지급수수료', 290, 'PG 수수료 · 세무 · 법무 · 서버(클라우드) 등', NULL, '2026-11-25 13:41:35.140637+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('EXP_AD', '광고선전비', 'EXPENSE', '833', '광고선전비', 300, '외부 광고', NULL, '2026-11-25 13:41:35.140637+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('EXP_ETC', '잡비', 'EXPENSE', '848', '잡비', 390, '그 밖의 비용', NULL, '2026-11-25 13:41:35.140637+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('EXP_PROMO', '추천 수당', 'EXPENSE', '831', '지급수수료', 200, '추천 보상 포인트 현금 출금 = 수당(11/19 대표) · 총액(원천세 포함) · 사업소득 3.3% · 계정 코드는 코드표를 받으면 채움 · v10.392 코드 초안 831(지급수수료)', NULL, '2026-11-25 13:41:34.940762+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('FIXED_ASSET', '비품', 'ASSET', '212', '비품', 35, '고정자산(컴퓨터 · 가구 등) — v10.398', NULL, '2026-11-25 13:41:35.34123+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('ACC_DEPR', '감가상각누계액', 'ASSET', '213', '감가상각누계액', 36, '고정자산 차감(대변 잔액) — v10.398', NULL, '2026-11-25 13:41:35.34123+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('EQUITY_CAPITAL', '자본금', 'EQUITY', '331', '자본금', 80, '기초 잔액에서 넣음 — v10.396', NULL, '2026-11-25 13:41:35.34123+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('RETAINED', '이월이익잉여금', 'EQUITY', '375', '이월이익잉여금', 85, '해 마감 때 손익을 옮김(v10.402) · 기초 잔액', NULL, '2026-11-25 13:41:35.34123+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('GAIN_DISPOSAL', '유형자산처분이익', 'REVENUE', '914', '유형자산처분이익', 180, '고정자산 처분 이익 — v10.398', NULL, '2026-11-25 13:41:35.34123+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('EXP_DEPR', '감가상각비', 'EXPENSE', '818', '감가상각비', 305, '고정자산 달 상각 — v10.398', NULL, '2026-11-25 13:41:35.34123+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('LOSS_DISPOSAL', '유형자산처분손실', 'EXPENSE', '970', '유형자산처분손실', 395, '고정자산 처분 손실 — v10.398', NULL, '2026-11-25 13:41:35.34123+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('INS_PAYABLE', '예수금(4대보험)', 'LIABILITY', '254', '예수금', 62, '급여에서 뗀 4대보험(본인 몫) + 회사 몫 — 내기 전 · v10.403', NULL, '2026-11-25 13:41:35.454212+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('EXP_INSURANCE', '보험료(4대보험 회사 몫)', 'EXPENSE', '821', '보험료', 215, '4대보험 회사 부담분 — v10.403 · 계정은 세무사 확인(복리후생비 · 세금과공과로 나누기도 함)', NULL, '2026-11-25 13:41:35.454212+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('SEVERANCE_RES', '퇴직급여충당부채', 'LIABILITY', '295', '퇴직급여충당부채', 70, '퇴직금 추계액(v10.406) — 달마다 추계액과 장부 잔액 차이만 전표', NULL, '2026-11-25 13:41:35.583251+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('EXP_SEVERANCE', '퇴직급여', 'EXPENSE', '806', '퇴직급여', 215, '퇴직금 충당 · 실지급(v10.406)', NULL, '2026-11-25 13:41:35.583251+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('REV_EXPORT', '수출 매출(영세율)', 'REVENUE', '401', '상품매출', 165, '수출 선적 기준 매출 · 부가세 0%(영세율) — v10.428', NULL, '2026-11-25 13:41:36.117485+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('FX_GAIN', '외환차익', 'REVENUE', '907', '외환차익', 920, '외화 매출채권 회수 때 환율 차이(이익) — v10.428', NULL, '2026-11-25 13:41:36.117485+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('FX_LOSS', '외환차손', 'EXPENSE', '952', '외환차손', 960, '외화 매출채권 회수 때 환율 차이(손실) — v10.428', NULL, '2026-11-25 13:41:36.117485+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('REV_SALES', '매출(견적 · 거래명세서)', 'REVENUE', '404', '용역매출', 175, '거래명세서 확정 매출 — v10.433(종류에 따라 문서에서 다른 매출 계정 고름)', NULL, '2026-11-25 13:41:36.245986+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('CASH_HAND', '현금(시재)', 'ASSET', '101', '현금', 9, '사무실 시재 현금 — 현금출납장(v10.450) · 수동 전표로 들고 남', NULL, '2026-11-25 13:41:36.908638+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('FX_REVAL_GAIN', '외화환산이익', 'REVENUE', '910', '외화환산이익', 925, '결산 때 외화 받을 돈을 기말 환율로 평가한 이익 — 다음 달 첫날 되돌림(v10.452)', NULL, '2026-11-25 13:41:36.908638+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('FX_REVAL_LOSS', '외화환산손실', 'EXPENSE', '955', '외화환산손실', 965, '결산 때 외화 받을 돈을 기말 환율로 평가한 손실 — 다음 달 첫날 되돌림(v10.452)', NULL, '2026-11-25 13:41:36.908638+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('SALES_DISC', '매출할인(소개몰 쿠폰)', 'REVENUE', '403', '매출할인', 175, '소개몰 직판 쿠폰 할인 — 매출에서 빼는 계정(차변) · v10.469 · 계정 코드 · 부가세 처리(에누리 · 공급가액에서 뺌) 세무사 확인', NULL, '2026-11-25 13:41:37.467893+00', false, true);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('GIFT_ADV', '선수금(소개몰 상품권)', 'LIABILITY', '259', '선수금', 42, '소개몰 상품권 판매 · 판촉 발행 — 쓰면 매출로 · 소멸이면 잡이익 · v10.482 · 판촉 발행을 선수금으로 둘지(충당부채) 세무사 확인', NULL, '2026-11-25 13:41:37.919361+00', false, true);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('MALL_POINT_LIAB', '적립금 충당부채(소개몰)', 'LIABILITY', NULL, '충당부채', 66, '소개몰 구매확정 적립금 — 쓰면 줄고 · 소멸 · 회수면 환입 · v10.479 · 계정 코드 · 충당부채 · 이연수익(K-IFRS 1115) 중 무엇으로 둘지 세무사 확인', NULL, '2026-11-25 13:41:37.919361+00', false, true);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('EXP_MALL_PROMO', '판매촉진비(소개몰 적립금 · 판촉 상품권)', 'EXPENSE', NULL, '판매촉진비', 205, '소개몰 적립금 적립 · 판촉 상품권 발행 — 소멸 · 회수는 환입(대변) · v10.479 · 계정 코드 세무사 확인', NULL, '2026-11-25 13:41:37.919361+00', false, true);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('INC_GIFT_LAPSE', '잡이익(소개몰 상품권 소멸)', 'REVENUE', '930', '잡이익', 185, '판매한 상품권 유효 기간 지남 · 잔액 소멸 — v10.482 · 소멸 시효 · 잔액 환불 기준(법무) · 계정 세무사 확인', NULL, '2026-11-25 13:41:37.919361+00', false, true);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('PREPAID_EXP', '선급비용', 'ASSET', '133', '선급비용', 135, '미리 낸 보험료 등 — 기간에 걸쳐 비용으로 넘김(v10.489 회사 보험 · 일반 원칙 · 세무사 확인)', NULL, '2026-11-25 13:41:38.357582+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('EXP_INS_POLICY', '보험료(회사 보험)', 'EXPENSE', '821', '보험료', 216, '화재 · 배상책임 · 생산물 · 사이버 · 임원 배상 등 회사 보험료(4대보험 회사 몫 EXP_INSURANCE 와 따로 · v10.489)', NULL, '2026-11-25 13:41:38.357582+00', false, false);
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, updated_by, updated_at, custom, draft) VALUES ('REV_BUMP', '끌어올리기 매출', 'REVENUE', '404', '용역매출', 115, 'v10.515 (D276) 매물 끌어올리기 유료 결제(PAID 방식) · 부가세 별도(D243) · 환불은 반대 · 계정은 초안 — 세무사 확인', NULL, '2026-11-25 13:41:39.608524+00', false, true);





























































































INSERT INTO public.acct_depts (id, code, name, active, sort, created_at) VALUES (1, 'HQ', '본사 공통', true, 0, '2026-11-25 13:41:36.245986+00');









INSERT INTO public.acct_dunning_templates (stage, days, subject, body, updated_by, updated_at) VALUES (1, 30, '[{company}] 대금 결제 안내', '{party} 담당자님께

{oldest} 부터 남아 있는 대금 {amount}원이 아직 확인되지 않았습니다.
이미 보내셨다면 이 메일은 무시해 주십시오.

문의: {phone}
{company}', NULL, '2026-11-25 13:41:36.245986+00');
INSERT INTO public.acct_dunning_templates (stage, days, subject, body, updated_by, updated_at) VALUES (2, 60, '[{company}] 미결제 대금 독촉', '{party} 담당자님께

{oldest} 부터 {days}일이 지난 대금 {amount}원이 남아 있습니다.
결제 예정일을 회신해 주시면 감사하겠습니다.

문의: {phone}
{company}', NULL, '2026-11-25 13:41:36.245986+00');
INSERT INTO public.acct_dunning_templates (stage, days, subject, body, updated_by, updated_at) VALUES (3, 90, '[{company}] 미결제 대금 최종 안내', '{party} 담당자님께

{oldest} 부터 {days}일이 지난 대금 {amount}원이 남아 있어 마지막으로 안내드립니다.
회신이 없으면 거래 조건을 다시 협의해야 할 수 있습니다.

문의: {phone}
{company}', NULL, '2026-11-25 13:41:36.245986+00');


















INSERT INTO public.acct_export_formats (id, name, columns, date_style, dc_style, dc_debit, dc_credit, header, is_default, updated_by, updated_at) VALUES (1, '일반 양식', '[{"field": "date", "title": "일자"}, {"field": "no", "title": "전표번호"}, {"field": "line", "title": "줄"}, {"field": "code", "title": "계정코드"}, {"field": "name", "title": "계정명"}, {"field": "debit", "title": "차변"}, {"field": "credit", "title": "대변"}, {"field": "party", "title": "거래처"}, {"field": "memo", "title": "적요"}, {"field": "evidence", "title": "증빙"}, {"field": "src", "title": "근거"}]', 'YYYY-MM-DD', 'SPLIT', '차변', '대변', true, false, NULL, '2026-11-25 13:41:35.0448+00');
INSERT INTO public.acct_export_formats (id, name, columns, date_style, dc_style, dc_debit, dc_credit, header, is_default, updated_by, updated_at) VALUES (2, '세무사랑 일반전표', '[{"field": "month", "title": "월"}, {"field": "day", "title": "일"}, {"field": "dc", "title": "구분"}, {"field": "code", "title": "계정코드"}, {"field": "name", "title": "계정과목"}, {"field": "blank", "title": "거래처코드"}, {"field": "party", "title": "거래처명"}, {"field": "memo", "title": "적요"}, {"field": "debit", "title": "차변"}, {"field": "credit", "title": "대변"}]', 'YYYY-MM-DD', 'SPLIT', '3', '4', true, true, NULL, '2026-11-25 13:41:35.140637+00');
















































INSERT INTO public.acct_payroll_rates (year, key, value, draft, updated_by, updated_at) VALUES (2026, 'ia_company_rate', 0.7, false, NULL, '2026-11-25 13:41:35.985915+00');
INSERT INTO public.acct_payroll_rates (year, key, value, draft, updated_by, updated_at) VALUES (2026, 'np_rate', 4.75, false, NULL, '2026-11-25 13:41:35.454212+00');
INSERT INTO public.acct_payroll_rates (year, key, value, draft, updated_by, updated_at) VALUES (2026, 'np_base_min', 400000, false, NULL, '2026-11-25 13:41:35.454212+00');
INSERT INTO public.acct_payroll_rates (year, key, value, draft, updated_by, updated_at) VALUES (2026, 'np_base_max', 6370000, false, NULL, '2026-11-25 13:41:35.454212+00');
INSERT INTO public.acct_payroll_rates (year, key, value, draft, updated_by, updated_at) VALUES (2026, 'hi_rate', 3.595, false, NULL, '2026-11-25 13:41:35.454212+00');
INSERT INTO public.acct_payroll_rates (year, key, value, draft, updated_by, updated_at) VALUES (2026, 'ltc_rate', 13.14, false, NULL, '2026-11-25 13:41:35.454212+00');
INSERT INTO public.acct_payroll_rates (year, key, value, draft, updated_by, updated_at) VALUES (2026, 'ei_rate', 0.9, false, NULL, '2026-11-25 13:41:35.454212+00');
INSERT INTO public.acct_payroll_rates (year, key, value, draft, updated_by, updated_at) VALUES (2026, 'ei_company_rate', 1.15, false, NULL, '2026-11-25 13:41:35.454212+00');

























































INSERT INTO public.acct_warehouses (id, code, name, address, is_main, active, created_at) VALUES (1, 'MAIN', '본 창고', NULL, true, true, '2026-11-25 13:41:36.245986+00');





































































INSERT INTO public.hr_contract_templates (id, code, version, name, kind, body, active, created_by, created_at) VALUES (1, 'STANDARD', 1, '표준 근로계약서(기간의 정함이 없는 경우)', 'REGULAR', '근로계약서

{{company}}(이하 「회사」)와 {{name}}(이하 「근로자」)은 다음과 같이 근로계약을 맺는다.

1. 근로 시작일: {{startOn}}부터 (계약 끝: {{endOn}})
2. 일하는 곳: {{place}}
3. 하는 일: {{duties}}
4. 소정근로시간: {{workTime}} (휴게시간 {{breakTime}})
5. 근무일 · 휴일: {{workDays}} 근무 · 주휴일 {{holiday}}
6. 임금
   - {{wageType}} {{wage}}원
   - 지급일: 매월 {{payDay}}일(휴일이면 전날)
   - 지급 방법: {{payMethod}}
7. 연차유급휴가: 근로기준법에서 정하는 바에 따라 준다.
8. 사회보험: 고용보험 · 산재보험 · 국민연금 · 건강보험에 가입한다.
9. 근로계약서 교부: 회사는 계약을 맺는 즉시 이 계약서를 근로자에게 준다(전자 문서로 줄 수 있음).
10. 그 밖의 사항은 근로기준법 · 취업규칙에 따른다.

{{signedOn}}
회사: {{company}}
근로자: {{name}}', true, NULL, '2026-11-25 13:41:37.105726+00');


















INSERT INTO public.hr_training_kinds (code, name, basis, cycle_months, min_hours, active, sort, updated_by, updated_at, created_at) VALUES ('SEXUAL_HARASSMENT', '직장 내 성희롱 예방교육', '남녀고용평등법 제13조 · 시행령 제3조 — 연 1회 이상(일반 원칙 · 확인 필요)', 12, 1.0, true, 10, NULL, '2026-11-25 13:41:37.105726+00', '2026-11-25 13:41:37.105726+00');
INSERT INTO public.hr_training_kinds (code, name, basis, cycle_months, min_hours, active, sort, updated_by, updated_at, created_at) VALUES ('PRIVACY', '개인정보보호 교육', '개인정보 보호법 제28조(개인정보취급자 교육) · 내부 관리계획 — 연 1회 이상(일반 원칙 · 확인 필요)', 12, 1.0, true, 20, NULL, '2026-11-25 13:41:37.105726+00', '2026-11-25 13:41:37.105726+00');
INSERT INTO public.hr_training_kinds (code, name, basis, cycle_months, min_hours, active, sort, updated_by, updated_at, created_at) VALUES ('DISABILITY_AWARENESS', '직장 내 장애인 인식 개선 교육', '장애인고용촉진법 제5조의2 · 시행령 — 연 1회 이상 · 1시간 이상(일반 원칙 · 확인 필요)', 12, 1.0, true, 30, NULL, '2026-11-25 13:41:37.105726+00', '2026-11-25 13:41:37.105726+00');
INSERT INTO public.hr_training_kinds (code, name, basis, cycle_months, min_hours, active, sort, updated_by, updated_at, created_at) VALUES ('SAFETY', '산업안전보건 정기교육', '산업안전보건법 제29조 · 시행규칙 별표4 — 사무직 매 반기 6시간 이상(업종 · 규모별 적용 확인 필요)', 6, 6.0, true, 40, NULL, '2026-11-25 13:41:37.105726+00', '2026-11-25 13:41:37.105726+00');






INSERT INTO public.hra_bank_formats (id, name, columns, header, date_style, is_default, note, updated_by, updated_at) VALUES (1, '기본(은행 코드 · 계좌 · 금액 · 예금주 · 적요)', '[{"field": "bank", "title": "은행코드"}, {"field": "acct", "title": "계좌번호"}, {"field": "amount", "title": "금액"}, {"field": "holder", "title": "예금주"}, {"field": "memo", "title": "받는분통장표시"}]', true, 'YYYYMMDD', true, '처음 양식 — 쓰는 은행의 대량 이체 양식(칸 순서 · 이름 · 머리줄)에 맞춰 SUPER 가 고칩니다.', NULL, '2026-11-25 13:41:41.574842+00');



INSERT INTO public.hra_close_items (key, label, kind, where_ko, sort, active, updated_by, updated_at) VALUES ('journal', '자동 전표 실패 없음', 'AUTO', '회계 › 전표', 10, true, NULL, '2026-11-25 13:41:41.574842+00');
INSERT INTO public.hra_close_items (key, label, kind, where_ko, sort, active, updated_by, updated_at) VALUES ('bank', '통장 줄 모두 맞춤', 'AUTO', '회계 › 은행 맞추기', 20, true, NULL, '2026-11-25 13:41:41.574842+00');
INSERT INTO public.hra_close_items (key, label, kind, where_ko, sort, active, updated_by, updated_at) VALUES ('invoices', '세금계산서 발행 끝', 'AUTO', '회계 › 신고 자료', 30, true, NULL, '2026-11-25 13:41:41.574842+00');
INSERT INTO public.hra_close_items (key, label, kind, where_ko, sort, active, updated_by, updated_at) VALUES ('purchase', '매입 — 받은 세금계산서 · 법인카드 정리', 'AUTO', '회계 › 세금계산서 받기 · 경비 청구', 40, true, NULL, '2026-11-25 13:41:41.574842+00');
INSERT INTO public.hra_close_items (key, label, kind, where_ko, sort, active, updated_by, updated_at) VALUES ('expense', '경비 청구 — 승인 뒤 미지급 없음', 'AUTO', '회계 › 경비 청구', 50, true, NULL, '2026-11-25 13:41:41.574842+00');
INSERT INTO public.hra_close_items (key, label, kind, where_ko, sort, active, updated_by, updated_at) VALUES ('payroll', '급여 확정', 'AUTO', '회계 › 급여', 60, true, NULL, '2026-11-25 13:41:41.574842+00');
INSERT INTO public.hra_close_items (key, label, kind, where_ko, sort, active, updated_by, updated_at) VALUES ('depreciation', '감가상각 그 달 줄', 'AUTO', '회계 › 고정자산', 70, true, NULL, '2026-11-25 13:41:41.574842+00');
INSERT INTO public.hra_close_items (key, label, kind, where_ko, sort, active, updated_by, updated_at) VALUES ('receivable', '미수금 — 90일 넘은 받을 돈 확인', 'AUTO', '회계 › 기간 분석 · 미수금 독촉', 80, true, NULL, '2026-11-25 13:41:41.574842+00');
INSERT INTO public.hra_close_items (key, label, kind, where_ko, sort, active, updated_by, updated_at) VALUES ('cash_count', '현금 시재 · 법인카드 영수증 맞춤', 'MANUAL', '회계 › 자금 흐름', 110, true, NULL, '2026-11-25 13:41:41.574842+00');
INSERT INTO public.hra_close_items (key, label, kind, where_ko, sort, active, updated_by, updated_at) VALUES ('accountant', '세무사에게 그 달 자료 공유', 'MANUAL', '회계 › 세무사', 120, true, NULL, '2026-11-25 13:41:41.574842+00');







































INSERT INTO public.hrx_shift_types (code, name, kind, start_hm, end_hm, break_min, active, sort, updated_by, updated_at, created_at) VALUES ('DAY', '주간', 'WORK', '09:00', '18:00', 60, true, 10, NULL, '2026-11-25 13:41:37.626853+00', '2026-11-25 13:41:37.626853+00');
INSERT INTO public.hrx_shift_types (code, name, kind, start_hm, end_hm, break_min, active, sort, updated_by, updated_at, created_at) VALUES ('EARLY', '조출', 'WORK', '07:00', '16:00', 60, true, 20, NULL, '2026-11-25 13:41:37.626853+00', '2026-11-25 13:41:37.626853+00');
INSERT INTO public.hrx_shift_types (code, name, kind, start_hm, end_hm, break_min, active, sort, updated_by, updated_at, created_at) VALUES ('LATE', '오후', 'WORK', '13:00', '22:00', 60, true, 30, NULL, '2026-11-25 13:41:37.626853+00', '2026-11-25 13:41:37.626853+00');
INSERT INTO public.hrx_shift_types (code, name, kind, start_hm, end_hm, break_min, active, sort, updated_by, updated_at, created_at) VALUES ('NIGHT', '야간', 'WORK', '22:00', '07:00', 60, true, 40, NULL, '2026-11-25 13:41:37.626853+00', '2026-11-25 13:41:37.626853+00');
INSERT INTO public.hrx_shift_types (code, name, kind, start_hm, end_hm, break_min, active, sort, updated_by, updated_at, created_at) VALUES ('OFF', '휴무', 'OFF', NULL, NULL, 0, true, 90, NULL, '2026-11-25 13:41:37.626853+00', '2026-11-25 13:41:37.626853+00');

























































INSERT INTO public.lgl_license_kinds (code, name, authority, cycle_months, basis, active, sort, updated_by, updated_at, created_at) VALUES ('MAIL_ORDER', '통신판매업 신고', '관할 시 · 군 · 구청', 12, '전자상거래법 제12조 — 신고 자체는 갱신 없음 · 변경 사항 15일 안 변경 신고 · 등록면허세 매년 1월 정기분 납부(일반 원칙 · 법무 확인)', true, 10, NULL, '2026-11-25 13:41:38.357582+00', '2026-11-25 13:41:38.357582+00');
INSERT INTO public.lgl_license_kinds (code, name, authority, cycle_months, basis, active, sort, updated_by, updated_at, created_at) VALUES ('HFOOD_SALES', '건강기능식품 일반판매업 영업신고', '관할 시 · 군 · 구청', 12, '건강기능식품법 제6조 — 신고 갱신 없음 · 영업자 위생교육 매년(시행규칙 · 일반 원칙 · 법무 확인)', true, 20, NULL, '2026-11-25 13:41:38.357582+00', '2026-11-25 13:41:38.357582+00');
INSERT INTO public.lgl_license_kinds (code, name, authority, cycle_months, basis, active, sort, updated_by, updated_at, created_at) VALUES ('TELECOM_VAS', '부가통신사업 신고', '과학기술정보통신부(중앙전파관리소)', NULL, '전기통신사업법 제22조 — 갱신 없음 · 변경 · 휴지 · 폐지 신고(일반 원칙 · 법무 확인)', true, 30, NULL, '2026-11-25 13:41:38.357582+00', '2026-11-25 13:41:38.357582+00');
INSERT INTO public.lgl_license_kinds (code, name, authority, cycle_months, basis, active, sort, updated_by, updated_at, created_at) VALUES ('LOCATION_BIZ', '위치기반서비스사업 신고', '방송통신위원회', NULL, '위치정보법 제9조 — 갱신 없음 · 변경 신고(일반 원칙 · 법무 확인)', true, 40, NULL, '2026-11-25 13:41:38.357582+00', '2026-11-25 13:41:38.357582+00');
INSERT INTO public.lgl_license_kinds (code, name, authority, cycle_months, basis, active, sort, updated_by, updated_at, created_at) VALUES ('BIZ_REG', '사업자등록', '관할 세무서', NULL, '부가가치세법 제8조 — 갱신 없음 · 정정 신고(일반 원칙 · 법무 확인)', true, 50, NULL, '2026-11-25 13:41:38.357582+00', '2026-11-25 13:41:38.357582+00');
INSERT INTO public.lgl_license_kinds (code, name, authority, cycle_months, basis, active, sort, updated_by, updated_at, created_at) VALUES ('ETC', '그 밖 인허가 · 신고', NULL, NULL, '직접 적음', true, 90, NULL, '2026-11-25 13:41:38.357582+00', '2026-11-25 13:41:38.357582+00');




















































































SELECT pg_catalog.setval('public.acct_accountant_access_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_accountant_notes_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_accountant_replies_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_approval_line_changes_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_approval_lines_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_approval_steps_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_archives_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_assets_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_attendance_fixes_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_attendance_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_bank_feed_accounts_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_bank_feed_runs_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_bank_txns_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_bank_uploads_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_budget_changes_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_card_limit_changes_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_card_txns_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_card_uploads_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_cash_balances_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_cash_plans_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_contract_accruals_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_contract_changes_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_contracts_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_depreciations_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_depts_id_seq', 1, true);



SELECT pg_catalog.setval('public.acct_dunning_sends_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_employees_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_entries_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_entry_reversals_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_expense_claims_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_export_formats_id_seq', 2, true);



SELECT pg_catalog.setval('public.acct_export_lines_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_exports_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_fx_revals_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_import_lines_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_imports_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_insurance_done_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_leave_grants_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_leave_requests_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_leave_uses_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_lines_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_manual_entries_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_opening_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_opening_sets_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_parties_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_payroll_lines_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_payroll_rate_log_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_payroll_runs_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_payslip_mails_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_pg_txns_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_pg_uploads_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_po_lines_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_pos_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_projects_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_purchases_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_receipt_promises_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_receipt_reads_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_reorder_draft_lines_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_reorder_drafts_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_requisitions_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_rule_changes_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_sales_doc_lines_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_sales_targets_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_severance_runs_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_stock_moves_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_stock_transfers_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_tag_changes_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_target_changes_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_tax_inbox_fetches_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_tax_inbox_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_transfer_batches_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_transfer_items_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_vehicle_costs_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_vehicle_trips_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_vehicles_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_warehouses_id_seq', 1, true);



SELECT pg_catalog.setval('public.acct_year_closings_id_seq', 1, false);



SELECT pg_catalog.setval('public.acct_yearend_checks_id_seq', 1, false);



SELECT pg_catalog.setval('public.corp_doc_versions_id_seq', 1, false);



SELECT pg_catalog.setval('public.corp_docs_id_seq', 1, false);



SELECT pg_catalog.setval('public.hr_applicant_purges_id_seq', 1, false);



SELECT pg_catalog.setval('public.hr_applicants_id_seq', 1, false);



SELECT pg_catalog.setval('public.hr_contract_templates_id_seq', 1, true);



SELECT pg_catalog.setval('public.hr_contracts_id_seq', 1, false);



SELECT pg_catalog.setval('public.hr_interviews_id_seq', 1, false);



SELECT pg_catalog.setval('public.hr_job_postings_id_seq', 1, false);



SELECT pg_catalog.setval('public.hr_review_cycles_id_seq', 1, false);



SELECT pg_catalog.setval('public.hr_review_goals_id_seq', 1, false);



SELECT pg_catalog.setval('public.hr_training_records_id_seq', 1, false);



SELECT pg_catalog.setval('public.hra_bank_formats_id_seq', 1, true);



SELECT pg_catalog.setval('public.hra_close_marks_id_seq', 1, false);



SELECT pg_catalog.setval('public.hra_leave_promos_id_seq', 1, false);



SELECT pg_catalog.setval('public.hra_lib_posts_id_seq', 1, false);



SELECT pg_catalog.setval('public.hra_lib_revisions_id_seq', 1, false);



SELECT pg_catalog.setval('public.hra_pay_bank_changes_id_seq', 1, false);



SELECT pg_catalog.setval('public.hra_payfile_logs_id_seq', 1, false);



SELECT pg_catalog.setval('public.hrx_bookings_id_seq', 1, false);



SELECT pg_catalog.setval('public.hrx_ot_pay_links_id_seq', 1, false);



SELECT pg_catalog.setval('public.hrx_ot_requests_id_seq', 1, false);



SELECT pg_catalog.setval('public.hrx_resources_id_seq', 1, false);



SELECT pg_catalog.setval('public.hrx_shifts_id_seq', 1, false);



SELECT pg_catalog.setval('public.hrx_stocktake_lines_id_seq', 1, false);



SELECT pg_catalog.setval('public.hrx_stocktakes_id_seq', 1, false);



SELECT pg_catalog.setval('public.its_assets_id_seq', 1, false);



SELECT pg_catalog.setval('public.its_key_events_id_seq', 1, false);



SELECT pg_catalog.setval('public.its_suggestion_log_id_seq', 1, false);



SELECT pg_catalog.setval('public.its_survey_questions_id_seq', 1, false);



SELECT pg_catalog.setval('public.its_surveys_id_seq', 1, false);



SELECT pg_catalog.setval('public.lgl_case_costs_id_seq', 1, false);



SELECT pg_catalog.setval('public.lgl_case_hearings_id_seq', 1, false);



SELECT pg_catalog.setval('public.lgl_cases_id_seq', 1, false);



SELECT pg_catalog.setval('public.lgl_contract_reviews_id_seq', 1, false);



SELECT pg_catalog.setval('public.lgl_insurance_policies_id_seq', 1, false);



SELECT pg_catalog.setval('public.lgl_insurance_postings_id_seq', 1, false);



SELECT pg_catalog.setval('public.lgl_license_renewals_id_seq', 1, false);



SELECT pg_catalog.setval('public.lgl_licenses_id_seq', 1, false);



SELECT pg_catalog.setval('public.lgl_review_opinions_id_seq', 1, false);



SELECT pg_catalog.setval('public.ofc_events_id_seq', 1, false);



SELECT pg_catalog.setval('public.ofc_task_comments_id_seq', 1, false);



SELECT pg_catalog.setval('public.ofc_tasks_id_seq', 1, false);



SELECT pg_catalog.setval('public.ofc_trip_settlements_id_seq', 1, false);



SELECT pg_catalog.setval('public.ofc_trips_id_seq', 1, false);



SELECT pg_catalog.setval('public.prr_cases_id_seq', 1, false);



SELECT pg_catalog.setval('public.prr_review_items_id_seq', 1, false);



SELECT pg_catalog.setval('public.qlt_claim_logs_id_seq', 1, false);



SELECT pg_catalog.setval('public.qlt_claims_id_seq', 1, false);



SELECT pg_catalog.setval('public.qlt_lot_counts_id_seq', 1, false);



SELECT pg_catalog.setval('public.qlt_lot_moves_id_seq', 1, false);



SELECT pg_catalog.setval('public.qlt_lot_picks_id_seq', 1, false);



SELECT pg_catalog.setval('public.qlt_lots_id_seq', 1, false);



SELECT pg_catalog.setval('public.qlt_sup_evals_id_seq', 1, false);



SELECT pg_catalog.setval('public.sal_opp_logs_id_seq', 1, false);



SELECT pg_catalog.setval('public.sal_opps_id_seq', 1, false);
SET session_replication_role = origin;

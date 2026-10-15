-- =====================================================================
-- D090 — v10.31 합침(w1 · w2 · w3 · w5 · w6)에서 묶음끼리 맞춘 것 (SHARED_NOTES)
--
--   ① 파일 용도(ck_files_purpose) — 마지막으로 다시 만드는 곳이 모든 묶음의 합집합을 담습니다.
--      D049(w1) · D050(w2) · D072(w5) 가 각자 다시 만들던 CHECK 를 여기서 한 번 더 같은 목록으로(어느 DB · 어느 순서로 와도 이 판이 마지막).
--   ② 알림 종류 정책(notification_event_policies · tone) — 이번 판에서 생긴 알림이 정책 표에 없어 나의공간 알림 카드 색이 늘 파랑(info)이었고
--      종류별 수신 설정 목록에도 없었습니다. w6 의 3종(POSTING_SUSPENDED · REVIEW_SLA_DELAY · BUSINESS_REJECTED)과
--      w2 · w5 가 만든 알림(BIZAXIS_REQUEST · BIZQUICK_OFFER · SAFE_TRADE_AGREE · SUCCESS_STORY_CONSENT · BIZ_CHANGE_DECIDED · FULFILL_CONFIRM_REQUEST)을 넣습니다.
--   ③ 약관 대상(terms.audience) — 파트너 이용약관(PARTNER · w5 D076)은 입점한 파트너(대표 · 합류 직원)에게만 필수입니다.
--      10/10 사용자 답 「파트너 약관 발행 — 전부 가능」에 따라 필수(is_required)로 바꾸되 대상을 PARTNER 로 묶어,
--      일반 회원 가입 · 재동의 목록에는 나오지 않고 파트너에게만 재동의(로그인 · 파트너센터 진입 때 /terms/agree)가 걸리게 합니다.
--      발행(시행) 자체는 킷의 기존 방식 — `EFFECTIVE_FROM=YYYY-MM-DD bash scripts/publish-terms.sh PARTNER` (기본 대상 목록에도 PARTNER 를 넣음).
--   ④ 정기 작업 lead_cash_auto(w5 D070 자동 충전) — 30분마다. 전에는 리드 열람 직후 · 운영 단추로만 돌았습니다.
--   재실행 안전.
-- =====================================================================

/* ① 파일 용도 — 합집합 */
ALTER TABLE public.files DROP CONSTRAINT IF EXISTS ck_files_purpose;
ALTER TABLE public.files ADD CONSTRAINT ck_files_purpose
  CHECK (purpose = ANY (ARRAY['OWNERSHIP_DOC','MARKETING_MATERIAL','PARTNER_GUIDE','PRODUCT_IMAGE',
                              'LISTING_IMAGE','REQUEST_IMAGE','INQUIRY_ATTACHMENT',   -- w1 D049
                              'BROKER_DOC',                                          -- w2 D050 (LISTING_IMAGE · REQUEST_IMAGE 는 w1 과 같음)
                              'PARTNER_MEDIA']));                                    -- w5 D072
COMMENT ON CONSTRAINT ck_files_purpose ON public.files IS
  '파일 용도 — v10.31 합침(D090)이 마지막 정의: w1 LISTING_IMAGE · REQUEST_IMAGE · INQUIRY_ATTACHMENT + w2 BROKER_DOC + w5 PARTNER_MEDIA. '
  '용도를 더할 때는 새 마이그레이션에서 이 목록 전부를 다시 적습니다(file.dto FILE_PURPOSES · file.service UPLOADERS · file_policies 와 같이).';

/* ② 알림 종류 정책 — 카드 색(tone) · 수신 설정 */
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis, tone) VALUES
  ('POSTING_SUSPENDED',       '등록 일시 정지',            false, false, '이용약관 제12조(이용 제한 — 사유 통지)', 'warn'),
  ('REVIEW_SLA_DELAY',        '검수 지연 안내',            false, false, '이용약관 제6조 ②(영업일 기준 24시간)',  'info'),
  ('BUSINESS_REJECTED',       '사업자 인증 반려',          false, false, NULL,                                    'warn'),
  ('BIZAXIS_REQUEST',         '창업 축 문의 도착',         true,  false, NULL,                                    'info'),
  ('BIZQUICK_OFFER',          '빠른 매칭 제안 도착',       true,  false, NULL,                                    'info'),
  ('SAFE_TRADE_AGREE',        '안전거래 합의 요청',        false, false, '거래 당사자 확인 절차',                 'info'),
  ('SUCCESS_STORY_CONSENT',   '성공 사례 공개 동의 요청',  false, false, '거래 상대 정보 공개 동의',              'info'),
  ('BIZ_CHANGE_DECIDED',      '사업자 정보 변경 처리',     false, false, NULL,                                    'info'),
  ('FULFILL_CONFIRM_REQUEST', '이행 확인 요청',            false, false, NULL,                                    'info')
ON CONFLICT (event_code) DO UPDATE SET tone = EXCLUDED.tone;

/* ③ 약관 대상 */
ALTER TABLE public.terms ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'ALL';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_terms_audience') THEN
    ALTER TABLE public.terms ADD CONSTRAINT ck_terms_audience CHECK (audience IN ('ALL','PARTNER'));
  END IF;
END $$;
COMMENT ON COLUMN public.terms.audience IS
  '동의 대상(v10.31 · D090). ALL = 모든 회원(가입 · 재동의) · PARTNER = 입점한 파트너의 대표 · 합류 직원(fn_term_applies). '
  'is_required 는 그 대상 안에서의 필수입니다 — PARTNER 필수 약관은 일반 회원 가입 · 재동의 목록에 나오지 않습니다.';

CREATE OR REPLACE FUNCTION public.fn_term_applies(p_account uuid, p_audience text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT CASE coalesce(p_audience, 'ALL')
           WHEN 'ALL' THEN true
           WHEN 'PARTNER' THEN p_account IS NOT NULL AND EXISTS (
             SELECT 1 FROM partners p JOIN businesses b ON b.id = p.business_id
              WHERE p.status IN ('APPLIED','ACTIVE','SUSPENDED')
                AND (b.account_id = p_account
                     OR EXISTS (SELECT 1 FROM business_members m
                                 WHERE m.business_id = b.id AND m.account_id = p_account
                                   AND m.joined_at IS NOT NULL AND m.removed_at IS NULL)))
           ELSE false
         END
$$;
COMMENT ON FUNCTION public.fn_term_applies(uuid, text) IS
  '이 회원이 그 약관의 동의 대상인가(v10.31 · D090). PARTNER = 입점 신청 · 활동 · 일시 정지 중인 파트너의 대표 또는 합류한 직원.';

-- 파트너 이용약관 — 대상 PARTNER · 그 대상 안에서 필수. 「바뀐 점」(재동의 화면에 보임)은 이용자에게 보일 글로.
UPDATE public.terms
   SET audience = 'PARTNER', is_required = true,
       change_note = '파트너 이용약관 시행 — 리드 이용료 선불 충전(제3조) · 반려 인정 · 무효 시 잔액으로 환급(제4조) · 유상 잔액 환불(제5조) · 전환 전 후불분은 종전대로(제6조)'
 WHERE code = 'PARTNER' AND status IN ('DRAFT','LEGAL_REVIEW');
UPDATE public.terms SET audience = 'PARTNER' WHERE code = 'PARTNER' AND audience <> 'PARTNER';

-- 이용약관 1.1(D062)의 「바뀐 점」 — 재동의 화면에 그대로 보이는 글이라 내부 말(「시안대로」)을 빼고 이용자에게 보일 글로
UPDATE public.terms
   SET change_note = '무료 요금제에는 소개코드가 포함되지 않습니다(필요하면 건당 정액으로 발급) · 사업자로 받는 소개비는 사업자 인증 뒤 성사된 거래부터(그 전 거래는 개인으로 받음) · 등록물 확인은 영업일 기준 24시간 이내 · 부동산은 소개비가 아니라 노출료이며 소개비 약정 · 정산이 생기지 않음'
 WHERE code = 'SERVICE' AND change_note LIKE '요금제 내용을 시안대로%';

-- 동의하지 않은 필수 약관(운영 보고 · 재동의 현황) — 대상이 아닌 회원은 세지 않습니다
CREATE OR REPLACE VIEW public.v_term_not_agreed AS
 SELECT a.id AS account_id,
    a.email,
    t.code,
    t.title
   FROM accounts a
     CROSS JOIN terms t
  WHERE t.status = 'PUBLISHED'::text AND t.is_required AND a.status = 'ACTIVE'::text
    AND fn_term_applies(a.id, t.audience)
    AND NOT (EXISTS ( SELECT 1
           FROM v_term_consent_current g
          WHERE g.account_id = a.id AND g.term_code = t.code AND g.term_version = t.version AND g.agreed));

COMMENT ON TABLE public.lead_cash_wallets IS
  '리드 이용료 선불 잔액(D070). 자사 서비스(리드 확인비용) 이용료 선납으로 한정 — 다른 가맹점 사용 · 송금 · 양도 · 현금화 불가, 유상 잔액만 결제 취소로 환불. '
  '조건은 파트너 이용약관 제3~5조(10/10 사용자 답 — 파트너 약관 발행 전부 가능 · D090). '
  '잔액은 lead_cash_lines 로만 움직입니다 — 직접 UPDATE 로 잔액을 바꾸면 불변식(v_lead_cash_invariants)이 잡습니다';

/* ④ 정기 작업 — 리드 이용료 자동 충전 */
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('lead_cash_auto', 30, NULL, NULL, NULL, true,
        '리드 이용료 자동 충전 — 자동 청구를 켠 파트너 중 잔액이 기준 아래인 곳을 등록 카드로 충전(실패는 1시간 뒤 재시도 · 실패가 있으면 운영 경보)')
ON CONFLICT (job) DO NOTHING;

/* ⑤ 매칭 과정(fn_deal_timeline · w2 D052) — DB 함수가 대금 지급 기록 표(deal_payment_records)를 읽지 않게.
 *    INV-11 감시(v_dangling_refs · 공격 검정 D-03)는 「DB 함수 본문에 결제 · 계좌 계열 표 이름이 없을 것」을 봅니다 — 플랫폼 규칙(DB)이 당사자 결제 기록에 기대지 않게.
 *    4단계(대금 지급 기록)의 시각은 이제 서버(market.service bestCases)가 그 표에서 따로 읽어 채웁니다(화면 · 응답 모양은 같음). */
CREATE OR REPLACE FUNCTION public.fn_deal_timeline(p_deal uuid)
RETURNS TABLE(step int, code text, label text, at timestamptz)
LANGUAGE sql STABLE AS $$
  WITH d AS (SELECT * FROM public.deals WHERE id = p_deal),
  l AS (SELECT l.* FROM public.listings l JOIN d ON d.listing_id = l.id),
  rq AS (SELECT r.* FROM public.requests r JOIN d ON d.request_id = r.id),
  cv AS (SELECT c.created_at FROM public.conversations c JOIN d ON d.conversation_id = c.id),
  ct AS (SELECT min(coalesce(x.signed_by_buyer_at, x.agreed_by_buyer_at, x.issued_at)) AS at
           FROM public.deal_contracts x JOIN d ON d.id = x.deal_id WHERE x.state <> 'CANCELLED')
  SELECT * FROM (VALUES
    (1, 'REGISTERED', '등록',        coalesce((SELECT published_at FROM l), (SELECT created_at FROM rq))),
    (2, 'INQUIRY',    '문의 · 연결', coalesce((SELECT created_at FROM cv), (SELECT created_at FROM d))),
    (3, 'CONTRACT',   '조건 협의 · 계약', (SELECT at FROM ct)),
    (4, 'PAYMENT',    '대금 지급 기록',   NULL::timestamptz),   -- 서버가 채움(위 설명)
    (5, 'CONFIRMED',  '성사 확정',   (SELECT confirmed_at FROM d))
  ) v(step, code, label, at)
$$;

/* ⑥ A-07 부동산 노출료 게이트(w2 D056 trg_realty_no_referral_fee) — 다른 매물 게이트와 같은 모양으로(검정 K7).
 *    「BEFORE UPDATE OF 칸」만으로는 조회수 · 관심 수만 바뀌는 UPDATE 에도 게이트가 걸릴 수 있어(K7 · v_listing_gate_on_counter),
 *    INSERT 와 UPDATE 를 나누고 UPDATE 는 내용이 바뀐 때(fn_listing_content_changed)만. 규칙(RE_EXPOSURE_FEE)은 같습니다. */
DROP TRIGGER IF EXISTS trg_realty_no_referral_fee ON public.listings;
DROP TRIGGER IF EXISTS trg_realty_no_referral_fee_u ON public.listings;
CREATE TRIGGER trg_realty_no_referral_fee BEFORE INSERT ON public.listings
  FOR EACH ROW EXECUTE FUNCTION public.fn_realty_no_referral_fee();
CREATE TRIGGER trg_realty_no_referral_fee_u BEFORE UPDATE OF desired_fee, category_id ON public.listings
  FOR EACH ROW WHEN (fn_listing_content_changed(OLD.*, NEW.*)
                     AND (OLD.desired_fee IS DISTINCT FROM NEW.desired_fee OR OLD.category_id IS DISTINCT FROM NEW.category_id))
  EXECUTE FUNCTION public.fn_realty_no_referral_fee();

/* ⑦ INV-9R 감시(v_lead_fee_coupling · 검정 T-01 · V-04) — lead_fees.settle_mode(w5 D070 · 선불 PREPAID / 전환 전 후불 POSTPAID)는
 *    이용료를 「어떻게 내는가」(잔액 차감 · 후불 청구)이지 성사 · 소개비와의 연동이 아닙니다. 칸 이름의 settle 이 감시 정규식에 걸려 예외로 둡니다.
 *    성사 · 소개비 연동 칸(deal · referral · success · commission · 그 밖의 settle*)은 그대로 잡습니다. */
CREATE OR REPLACE VIEW public.v_lead_fee_coupling AS
 SELECT column_name
   FROM information_schema.columns
  WHERE table_schema::name = 'public'::name AND table_name::name = 'lead_fees'::name
    AND column_name::name ~ 'deal|referral|success|commission|settle'::text
    AND column_name::name <> 'settle_mode';
COMMENT ON VIEW public.v_lead_fee_coupling IS
  'INV-9R — 정보 이용료(lead_fees)가 성사 · 소개비와 연동되는 칸. 0이어야 합니다. settle_mode(선불 · 후불 납부 방식 · D070)는 연동이 아니라 예외(D090).';

/* ⑧ 광고 칸 「관 랜딩 띠」(GBAND · w2 D056) — 상품 · 소재가 없어 빈 칸으로 열려 있었습니다(검정 BA-01 빈 슬롯 · BD-01 상품 없는 슬롯).
 *    다른 칸과 같은 규칙으로: 판매 상품(도입가 미정 · 3주 실적으로 산정) 1줄 + 자사 소재 1건(메인 진입 칸 AD-106 과 같은 「소개뱅크 (자사)」 —
 *    다른 회사의 광고를 지어내지 않음). 운영이 팔면 그 소재로 바꿉니다. */
INSERT INTO public.ad_products (slot_code, period_unit, category, list_price, is_active, note, is_intro_price)
SELECT 'GBAND', 'WEEK', NULL, 0, true,
       '도입가 미정 — 3주 실적(실제 노출·클릭)으로 산정합니다. 예상 노출로 먼저 팔면 못 채웠을 때 환불 문제가 됩니다.', true
 WHERE EXISTS (SELECT 1 FROM public.ad_slots WHERE code = 'GBAND')
   AND NOT EXISTS (SELECT 1 FROM public.ad_products WHERE slot_code = 'GBAND');
INSERT INTO public.ad_placements (slot_code, status, creative_code, advertiser, category, title, body, cta, landing_route, is_regulated, attribution_enabled)
SELECT 'GBAND', 'ACTIVE', 'AD-111', '소개뱅크 (자사)', '자사', '공급자로 등록하고 맞는 요청을 먼저 받으십시오',
       '업종 · 지역을 등록하면 그에 맞는 소개 요청이 옵니다. 소개비는 당사자끼리 — 플랫폼 공제 0%.', '공급자 등록', '/register', false, false
 WHERE EXISTS (SELECT 1 FROM public.ad_slots WHERE code = 'GBAND')
   AND NOT EXISTS (SELECT 1 FROM public.ad_placements WHERE creative_code = 'AD-111');

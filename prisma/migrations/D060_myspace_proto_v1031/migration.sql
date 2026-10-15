-- v10.31 (10/10 지시 「시안을 기준으로 개발 · 기능 반영」 · 묶음 w3 · 나의공간) — 시안에 있는데 서버 자료가 없던 구역을 실제 자료로.
--   ① 요금제 내용을 시안대로(베이직 소개코드 0건 · 소개 제안 월 10건 / 스탠다드 3건 · 50건 / 프로 15건 · 무제한) — 10/1 결정(BASIC 월 1건) → 시안
--      · 소개 제안 월 한도를 DB 가 지킵니다(전에는 proposal_limit 값만 있고 아무도 세지 않았음)
--   ② 거래신용 — 소개 신뢰도(fn_trust_score · 0~99 · 시안 설명 「인증 · 초대 동의율 · 성사 기록 · 인정된 신고」)에 거래 후기(별점)를 더함
--   ③ 소개자 등급 기준표(새싹 ~ 지역 파트너 · 기준 · 혜택) — 시안 표 그대로
--   ④ 맞춤 요청 — 보기(view)가 없는 상태값(OPEN)을 보고 있어 늘 0건이던 것을 게시 중(PUBLISHED) 요청으로 · 내 분야(업종 코드)로 거름
--   ⑤ 알림 색(tone) · 등록 반려 「고치는 법」 글 · 계약 임시 저장 · 확인 요청 · 지급 세금계산서 발행 표시
--   ⑥ 거래 상태 글을 시안 말로(조건 협의 중 → 협의 중 · 계약서 작성됨 → 계약 진행 · 분쟁 진행 중 → 분쟁)
--   ⑦ 사업자 수령은 사업자 인증 뒤 성사된 건부터(시안 「인증 시각이 소개비 수령 자격의 기준일 · 소급 안 됨」) — 그 전 성사 건은 개인으로 받음(INV-10R 그대로)

/* ── ① 요금제 ─────────────────────────────────────────────────── */
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS features text[] NOT NULL DEFAULT '{}';
COMMENT ON COLUMN public.subscription_plans.features IS '요금제 카드에 보이는 혜택 줄(시안 D.my.plans[].d) — v10.31';

UPDATE public.subscription_plans SET included_codes = 0, proposal_limit = 10,
       features = ARRAY['소개코드 발급 없음','소개 제안 월 10건','목록 · 상세 열람'] WHERE code = 'BASIC';
UPDATE public.subscription_plans SET included_codes = 3, proposal_limit = 50,
       features = ARRAY['소개코드 월 3건','소개 제안 월 50건','등록 무제한','정산 신청'] WHERE code = 'STANDARD';
UPDATE public.subscription_plans SET included_codes = 15, proposal_limit = NULL,
       features = ARRAY['소개코드 월 15건','소개 제안 무제한','우선 노출','전담 CS'] WHERE code = 'PRO';
COMMENT ON COLUMN public.subscription_plans.proposal_limit IS '소개 제안(request_proposals) 월 한도 — NULL 은 무제한. 구독이 없으면 BASIC 값(v10.31 · fn_proposal_quota_guard)';

/* 소개 제안 월 한도 — 이번 달(한국 시각 1일부터) 보낸 제안 수. 유효 구독이 없으면 무료(BASIC) 한도 */
CREATE OR REPLACE FUNCTION public.fn_proposal_quota(p_account uuid)
 RETURNS TABLE(plan_code text, lim integer, used integer)
 LANGUAGE sql STABLE AS $$
  WITH p AS (
    SELECT coalesce((SELECT s.plan_code FROM subscriptions s
                      WHERE s.account_id = p_account AND s.status IN ('ACTIVE','PAST_DUE') LIMIT 1), 'BASIC') AS code)
  SELECT p.code, sp.proposal_limit,
         (SELECT count(*)::int FROM request_proposals rp
           WHERE rp.proposer_account_id = p_account
             AND rp.created_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'))
    FROM p JOIN subscription_plans sp ON sp.code = p.code
$$;

CREATE OR REPLACE FUNCTION public.fn_proposal_quota_guard() RETURNS trigger
 LANGUAGE plpgsql AS $$
DECLARE q record;
BEGIN
  SELECT * INTO q FROM fn_proposal_quota(NEW.proposer_account_id);
  IF q.lim IS NOT NULL AND q.used >= q.lim THEN
    RAISE EXCEPTION 'PROPOSAL_QUOTA_EXCEEDED: 이번 달 소개 제안 한도(% 요금제 월 %건)를 다 쓰셨습니다. 다음 달 1일에 초기화되거나 요금제를 올리실 수 있습니다.', q.plan_code, q.lim
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_proposal_quota ON public.request_proposals;
CREATE TRIGGER trg_proposal_quota BEFORE INSERT ON public.request_proposals
  FOR EACH ROW EXECUTE FUNCTION public.fn_proposal_quota_guard();

/* ── ② 거래신용 = 소개 신뢰도 + 거래 후기 ─────────────────────────── */
INSERT INTO public.trust_weights (code, label, weight, note) VALUES
  ('REVIEW', '거래 후기', 10.0, '상대가 남긴 거래 후기 별점(1~5). 3점이 0, 5점이 만점 — 후기 5건부터 다 반영(v10.31)')
ON CONFLICT (code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_trust_score(p_account uuid) RETURNS TABLE(score numeric, sample integer, detail jsonb)
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
  w_base numeric; w_id numeric; w_biz numeric; w_con numeric;
  w_link numeric; w_deal numeric; w_rep numeric; w_rev numeric;
  v_id boolean; v_biz boolean;
  v_sent int; v_agreed int; v_links int; v_deals int; v_reports int;
  v_rev_n int; v_rev_avg numeric;
  v_score numeric; v_n int; v_damp numeric;
BEGIN
  SELECT weight INTO w_base FROM trust_weights WHERE code='BASE';
  SELECT weight INTO w_id   FROM trust_weights WHERE code='IDENTITY';
  SELECT weight INTO w_biz  FROM trust_weights WHERE code='BUSINESS';
  SELECT weight INTO w_con  FROM trust_weights WHERE code='CONSENT_RATE';
  SELECT weight INTO w_link FROM trust_weights WHERE code='CONNECTION';
  SELECT weight INTO w_deal FROM trust_weights WHERE code='DEAL';
  SELECT weight INTO w_rep  FROM trust_weights WHERE code='REPORT';
  SELECT weight INTO w_rev  FROM trust_weights WHERE code='REVIEW';

  SELECT (a.identity_verified_at IS NOT NULL) INTO v_id
    FROM accounts a WHERE a.id = p_account;
  SELECT EXISTS (SELECT 1 FROM businesses b
                  WHERE b.account_id = p_account AND b.verified_at IS NOT NULL)
    INTO v_biz;

  SELECT count(*), count(*) FILTER (WHERE state='CONSENTED')
    INTO v_sent, v_agreed
    FROM introduction_invites WHERE introducer_id = p_account;

  SELECT count(*) INTO v_links FROM introduction_connections
   WHERE introducer_id = p_account AND is_valid;

  /* v10.31 — 성사는 소개자로 이끈 것과 당사자로 마친 것을 함께 셉니다(거래신용 = 실제 거래) */
  SELECT count(*) INTO v_deals FROM deals
   WHERE p_account IN (introducer_account_id, buyer_account_id, seller_account_id)
     AND status IN ('CONFIRMED','SETTLED');

  -- ★ 인정된 신고만 셉니다. 신고만으로 깎으면 경쟁사가 악용합니다.
  SELECT count(*) INTO v_reports FROM reports
   WHERE reporter_id IS DISTINCT FROM p_account
     AND state = 'UPHELD'
     AND target_id IN (SELECT id FROM listings WHERE owner_account_id = p_account);

  /* v10.31 — 거래 후기: 나를 대상으로 남긴 거래 후기(자기 후기 제외) */
  SELECT count(*), avg(rating) INTO v_rev_n, v_rev_avg FROM deal_reviews
   WHERE target_id = p_account AND author_id <> p_account;

  v_n := coalesce(v_sent,0) + coalesce(v_links,0) + coalesce(v_deals,0) + coalesce(v_rev_n,0);

  /* 표본이 적으면 행동 점수를 덜 반영합니다.
     3건만으로 높은 점수가 나오면 아무도 그 숫자를 믿지 않습니다. */
  v_damp := least(1.0, v_n::numeric / 10.0);

  v_score := w_base
           + (CASE WHEN v_id  THEN w_id  ELSE 0 END)
           + (CASE WHEN v_biz THEN w_biz ELSE 0 END)
           + v_damp * (
               w_con  * coalesce(coalesce(v_agreed,0)::numeric / nullif(v_sent,0), 0)
             + w_link * least(1.0, coalesce(v_links,0)::numeric / 10.0)
             + w_deal * least(1.0, coalesce(v_deals,0)::numeric / 5.0)
             )
           + coalesce(w_rev, 0) * least(1.0, coalesce(v_rev_n,0)::numeric / 5.0)
               * coalesce((v_rev_avg - 3.0) / 2.0, 0)
           + w_rep * least(1.0, coalesce(v_reports,0)::numeric / 3.0);

  RETURN QUERY SELECT
    greatest(0, least(99, round(coalesce(v_score, w_base), 1))),
    v_n,
    jsonb_build_object(
      'identity', v_id, 'business', v_biz,
      'invitesSent', v_sent, 'invitesConsented', v_agreed,
      'connections', v_links, 'deals', v_deals,
      'reviews', coalesce(v_rev_n,0), 'reviewAvg', round(coalesce(v_rev_avg,0), 2),
      'reportsUpheld', v_reports, 'damping', round(v_damp, 2));
END $$;
COMMENT ON FUNCTION public.fn_trust_score(uuid) IS '소개 신뢰도 · 거래신용 0~99(v10.31 — 거래 후기 · 당사자 성사 포함). 화면의 「거래신용 812」는 이 값 ×10(정수). 자금 보증이 아니라 행동 기록입니다 — INV-11';

/* ── ③ 소개자 등급 기준표 ─────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS public.introducer_grades (
  code        text PRIMARY KEY CHECK (code IN ('SEED','VERIFIED','EXPERT','TOP','REGION_PARTNER')),
  name        text NOT NULL,
  criteria    text NOT NULL,
  benefit     text NOT NULL,
  next_hint   text,
  sort_order  int  NOT NULL DEFAULT 0
);
COMMENT ON TABLE public.introducer_grades IS '소개자 등급 기준 · 혜택(시안 「활동 내역 › 등급」 표 · v10.31). 등급은 건수가 아니라 수락률 · 만족도로 정합니다';
INSERT INTO public.introducer_grades (code, name, criteria, benefit, next_hint, sort_order) VALUES
  ('SEED',           '새싹 소개자', '본인인증 · 프로필 완료',          '기본 요청 확인',        '첫 유효 연결 1건이면 인증 소개자',           1),
  ('VERIFIED',       '인증 소개자', '첫 유효 연결 완료',               '인증배지 · 맞춤 알림',  '유효 연결 3건이면 전문 소개자',              2),
  ('EXPERT',         '전문 소개자', '특정 분야 유효 연결 3건',         '검색 우선노출',         '수락률 70% 이상 · 좋은 평가면 우수 소개자', 3),
  ('TOP',            '우수 소개자', '수락률 70% 이상 · 좋은 평가',     '요청 우선배정',         '지역 활동 기준을 채우면 지역 파트너',        4),
  ('REGION_PARTNER', '지역 파트너', '지역 활동 기준 충족',             '지역 페이지 노출',      NULL,                                          5)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, criteria = EXCLUDED.criteria, benefit = EXCLUDED.benefit,
                                 next_hint = EXCLUDED.next_hint, sort_order = EXCLUDED.sort_order;

/* ── ④ 맞춤 요청 ─────────────────────────────────────────────────── */
CREATE OR REPLACE VIEW public.v_introducer_matched_requests AS
 SELECT p.account_id AS introducer_id,
    q.id AS request_id,
    q.title,
    q.gwan_code,
    q.category_id,
    q.closes_at
   FROM introducer_profiles p
     JOIN requests q ON q.status = 'PUBLISHED'::text
     LEFT JOIN categories c ON c.id = q.category_id
  WHERE q.owner_account_id <> p.account_id
    AND (q.closes_at IS NULL OR q.closes_at > now())
    /* v10.31 — 내 분야(업종 코드)가 있으면 그 분야만. 비어 있으면 전체 */
    AND (cardinality(p.categories) = 0 OR c.code = ANY (p.categories)
         OR EXISTS (SELECT 1 FROM categories pc WHERE pc.id = c.parent_id AND pc.code = ANY (p.categories)))
    AND NOT (EXISTS ( SELECT 1
           FROM introducer_responses r
          WHERE r.request_id = q.id AND r.introducer_id = p.account_id));
COMMENT ON VIEW public.v_introducer_matched_requests IS '소개자에게 맞는 요청(게시 중 · 마감 전 · 내 분야 · 아직 답하지 않은 것) — v10.31: 상태 OPEN(없는 값) → PUBLISHED, 분야 거름';

/* ── ⑤ 알림 색 · 반려 고치는 법 · 계약 · 세금계산서 ─────────────────── */
ALTER TABLE public.notification_event_policies ADD COLUMN IF NOT EXISTS tone text NOT NULL DEFAULT 'info'
  CHECK (tone IN ('info','ok','warn'));
COMMENT ON COLUMN public.notification_event_policies.tone IS '알림 카드 왼쪽 색(시안 tone — warn 주황 · ok 초록 · info 파랑) · v10.31';
UPDATE public.notification_event_policies SET tone = 'warn'
 WHERE event_code IN ('LISTING_REJECTED','LISTING_RESTRICTED','BADGE_REJECTED','BADGE_EXPIRING','SETTLEMENT_HELD','PROMO_ENDING',
                      'QUOTA_EXCEEDED','BUSINESS_REJECTED','DISPUTE_OPENED','SUBSCRIPTION_PAYMENT_FAILED','SUBSCRIPTION_CARD_UNUSABLE',
                      'SUBSCRIPTION_NO_METHOD','SUBSCRIPTION_REFUND_FAILED','SETTLEMENT_BLOCKED_INDIVIDUAL','CONTRACT_SIGN_REQUIRED');
UPDATE public.notification_event_policies SET tone = 'ok'
 WHERE event_code IN ('LISTING_APPROVED','BADGE_GRANTED','DEAL_CONFIRMED','SETTLEMENT_PAID','SUBSCRIPTION_RENEWED','BUSINESS_APPROVED',
                      'DISPUTE_RESOLVED','SUBSCRIPTION_REFUND_DONE','INQUIRY_ANSWERED');
/* 계약 「확인 요청」(시안 계약 진행 카드) — 계약 이행에 관한 통지라 수신거부 불가 */
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis, tone)
VALUES ('CONTRACT_NUDGE', '계약 확인 요청', false, false, '계약 이행에 관한 통지', 'warn')
ON CONFLICT (event_code) DO NOTHING;

ALTER TABLE public.review_reason_codes ADD COLUMN IF NOT EXISTS fix_guide text;
COMMENT ON COLUMN public.review_reason_codes.fix_guide IS '반려 사유별 「고치는 법」(시안 내 등록 리스팅 반려 상자) · v10.31';
UPDATE public.review_reason_codes SET fix_guide = v.g FROM (VALUES
  ('THIN_CONTENT',     '무엇을 · 어디서 · 얼마에 · 언제까지를 본문에 적어 주세요. 상품이면 규격 · 수량, 서비스면 범위 · 기간을 함께 적습니다.'),
  ('MISLEADING',       '확인할 수 없는 수치 · 실적은 빼거나 근거(서류)를 함께 올려 주세요.'),
  ('CONTACT_IN_BODY',  '본문 · 사진의 전화번호 · 메신저 · 계좌번호를 지워 주세요. 연락은 1:1 문의로 이어집니다.'),
  ('DOC_MISSING',      '업종에 필요한 증빙(허가 · 신고 · 등록증)을 첨부해 주세요. 번호가 보이면 됩니다.'),
  ('FEE_UNREASONABLE', '소개비를 거래 규모에 맞게 고쳐 주세요. 소개비는 당사자 협의로 정합니다(A-12).'),
  ('DUPLICATE',        '같은 내용의 등록이 이미 있습니다. 새로 올리지 말고 기존 등록을 고쳐 주세요.'),
  ('CATEGORY_WRONG',   '업종을 다시 골라 주세요. 맞는 업종이 없으면 고객센터로 알려 주세요.'),
  ('BANNED_WORD',      '확정 수익 · 원금 보장 같은 표현을 빼 주세요(자본시장법 · 표시광고법).'),
  ('OTHER',            '반려 사유에 적힌 내용을 고쳐 다시 검수를 요청해 주세요.')
) AS v(c, g) WHERE code = v.c AND fix_guide IS NULL;

ALTER TABLE public.deal_contracts
  ADD COLUMN IF NOT EXISTS draft_terms jsonb,
  ADD COLUMN IF NOT EXISTS draft_by uuid REFERENCES public.accounts(id),
  ADD COLUMN IF NOT EXISTS draft_at timestamptz,
  ADD COLUMN IF NOT EXISTS nudged_at timestamptz,
  ADD COLUMN IF NOT EXISTS nudged_by uuid REFERENCES public.accounts(id);
COMMENT ON COLUMN public.deal_contracts.draft_terms IS '「임시 저장」한 조건(보내지 않음 — 상대 합의에 영향 없음) · 저장한 사람만 봅니다 · v10.31';
COMMENT ON COLUMN public.deal_contracts.nudged_at IS '마지막 「확인 요청」 시각 — 하루 한 번(v10.31)';

ALTER TABLE public.settlements
  ADD COLUMN IF NOT EXISTS tax_invoice_issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS tax_invoice_no text CHECK (tax_invoice_no IS NULL OR length(btrim(tax_invoice_no)) BETWEEN 1 AND 40);
COMMENT ON COLUMN public.settlements.tax_invoice_issued_at IS '세금계산서 발행 표시(소개자가 직접 발행 · 회사는 대신 발행하지 않음) — 사업자 수령 · 지급 완료 건만 · v10.31';

/* ── ⑥ 거래 상태 글 ─────────────────────────────────────────────── */
UPDATE public.code_labels SET label = '협의 중',  updated_at = now() WHERE domain = 'deal.status' AND code = 'NEGOTIATING';
UPDATE public.code_labels SET label = '계약 진행', updated_at = now() WHERE domain = 'deal.status' AND code = 'CONTRACTED';
UPDATE public.code_labels SET label = '분쟁',     updated_at = now() WHERE domain = 'deal.status' AND code = 'DISPUTED';

/* ── ⑦ 사업자 수령은 인증 뒤 성사 건부터 ───────────────────────────── */
CREATE OR REPLACE FUNCTION public.fn_assert_settlement_rules()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE d record; b record;
BEGIN
  SELECT * INTO d FROM deals WHERE id = NEW.deal_id;
  IF d.status NOT IN ('CONFIRMED','SETTLED') THEN
    RAISE EXCEPTION 'INV-3 violated: deal % is % (must be CONFIRMED)', d.id, d.status;
  END IF;
  IF d.agreed_fee IS NULL OR NEW.amount <> d.agreed_fee THEN
    RAISE EXCEPTION 'INV-9 violated: settlement amount % <> agreed_fee %',
      NEW.amount, d.agreed_fee;
  END IF;
  /* G-120 — 받는 사람 = 그 거래의 소개자 */
  IF (TG_OP = 'INSERT' OR NEW.payee_account_id IS DISTINCT FROM OLD.payee_account_id)
     AND NEW.payee_account_id IS DISTINCT FROM d.introducer_account_id THEN
    RAISE EXCEPTION 'INV-9R violated (G-120): payee % is not the introducer of deal %', NEW.payee_account_id, d.id;
  END IF;
  IF NEW.payee_business_id IS NOT NULL THEN
    /* 사업자로 받는 경우 — 인증된 사업자 · 받는 사람의 것 */
    SELECT * INTO b FROM businesses WHERE id = NEW.payee_business_id;
    IF b.verified_at IS NULL THEN
      RAISE EXCEPTION 'INV-10 violated: payee business % is not verified', b.id;
    END IF;
    IF b.account_id <> NEW.payee_account_id THEN
      RAISE EXCEPTION 'payee business does not belong to payee account';
    END IF;
    /* v10.31 (시안 「인증 시각이 소개비 수령 자격의 기준일 · 소급 안 됨」) — 사업자 인증 전에 성사된 건은 사업자로 받지 않습니다 */
    IF (TG_OP = 'INSERT' OR NEW.payee_business_id IS DISTINCT FROM OLD.payee_business_id)
       AND d.confirmed_at IS NOT NULL AND b.verified_at > d.confirmed_at THEN
      RAISE EXCEPTION 'INV-10 violated: business % verified after deal % was confirmed (no retroactive business payout)', b.id, d.id;
    END IF;
  ELSIF TG_OP = 'INSERT' OR NEW.payee_business_id IS DISTINCT FROM OLD.payee_business_id THEN
    /* v10.28 (D040 · INV-10R) — 개인으로 받는 경우: 본인인증 + 확인된 받을 계좌(본인 명의 · 1원 확인 · 연동 전에는 간주) */
    IF NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = NEW.payee_account_id AND a.identity_verified_at IS NOT NULL) THEN
      RAISE EXCEPTION 'INV-10R violated: individual payee % is not identity-verified', NEW.payee_account_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM payout_accounts p WHERE p.account_id = NEW.payee_account_id AND p.verified) THEN
      RAISE EXCEPTION 'INV-10R violated: individual payee % has no verified payout account', NEW.payee_account_id;
    END IF;
  END IF;
  RETURN NEW;
END $function$;

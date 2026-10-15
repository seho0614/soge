-- =====================================================================
-- D096 — v10.38 (2026-10-13 대표 지시) 파트너센터 계정 기준 전환 — P2P 마무리
--
--   「모두 개인에게 허용. 단 등록 시 인증을 받아야 하는 경우만 인증 받고 가능 · 이외의 제약이 없음 · B2B 가 아니고 P2P」
--
--   v10.37 까지 파트너센터 신청(입점 · 공인중개사 인증 · 안심소개 축 입점 · 자격 심사 · 소개창업 인력대행 회신)은
--   모두 「사업자 정보(businesses) 한 줄」 아래에 붙었습니다 — 사업자 정보가 없는 개인은 신청할 곳이 없었습니다.
--
--   ① 개인 활동 정보 — businesses.kind = 'PERSON'
--      본인인증을 한 개인이 처음 신청할 때 그 계정에 한 줄이 자동으로 생깁니다(계정당 한 줄).
--      이름 = 회원 이름 · 사업자등록번호 없음 · **사업자 인증(verified_at)은 영원히 비어 있음**(제약으로 막음)
--      → 사업자 인증 · 세금계산서 · 사업자로 소개비 받기(INV-10) 판정에는 섞이지 않습니다.
--      입점 · 중개사 · 축 · 자격 심사 · 리드 · 노출 · 정산은 지금 쓰던 그대로 이 줄 아래에서 돕니다(표를 바꾸지 않음).
--   ② fn_actor_business(계정, 만들기) — 「이 계정이 파트너센터에서 쓰는 줄」 한 곳에서 고릅니다.
--      이미 신청이 붙은 줄 → 인증된 사업자 → 개인 활동 정보(본인인증 계정이면 없을 때 만듦) → 심사 중 사업자(예전 신청).
--   ③ fn_actor_ok(줄) — 활동 자격: 사업자는 사업자 인증 · 개인은 본인인증.
--      파트너 활동(ACTIVE) 게이트(fn_partner_requires_verified)가 이것을 봅니다.
--   ④ fn_biz_type_guard — 개인 활동 정보는 계정 종류(개인 · PERSONAL)를 따지지 않습니다.
--   ⑤ 법률 · 세무 정액 노출 세금계산서 줄 — 개인 파트너는 사업자등록번호가 없으므로 buyer_biz_no 를 비울 수 있게.
--      (국세청 전송은 API 가 막고 「카드 · 현금영수증으로 갈음 · 번호 직접 입력」을 안내합니다)
--   ⑥ 계정으로 사업자 줄을 찾는 곳 3곳 — 개인 활동 정보가 「사업자」로 읽히거나 줄이 두 번 나오지 않게 사업자 줄만 봅니다.
--      fn_checklist_verdict · fn_request_candidates · v_property_pending
--
--   ⑦ 파트너 이용약관 제1조 · 제7조 — 파트너 = 사업자 또는 본인인증 개인 · 개인 파트너는 세금계산서 대신 카드 · 현금영수증(검토 중이면 본문만).
--
--   인증이 필요한 등록은 그대로입니다 — 부동산 축 승인 = 공인중개사 인증 · 보험 · 의료 = 자격 심사 승인 · 제한업종 등록 불가.
--   재실행 안전.
-- =====================================================================

/* ── ① 개인 활동 정보 ─────────────────────────────────────────────── */
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'BUSINESS';
ALTER TABLE public.businesses ALTER COLUMN biz_reg_no DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_businesses_kind' AND conrelid = 'public.businesses'::regclass) THEN
    ALTER TABLE public.businesses ADD CONSTRAINT ck_businesses_kind CHECK (kind IN ('BUSINESS', 'PERSON'));
  END IF;
  /* 사업자 줄은 사업자등록번호가 꼭 있고, 개인 활동 정보는 사업자등록번호 · 법인번호 · 사업자 인증이 영원히 없습니다 */
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_businesses_person' AND conrelid = 'public.businesses'::regclass) THEN
    ALTER TABLE public.businesses ADD CONSTRAINT ck_businesses_person CHECK (
      (kind = 'BUSINESS' AND biz_reg_no IS NOT NULL)
      OR (kind = 'PERSON' AND biz_reg_no IS NULL AND corp_reg_no IS NULL AND verified_at IS NULL AND nts_status IS NULL));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_businesses_person ON public.businesses (account_id) WHERE kind = 'PERSON';

COMMENT ON COLUMN public.businesses.kind IS
  'v10.38 (D096) — BUSINESS = 사업자 정보 · PERSON = 개인 활동 정보(본인인증 개인이 파트너센터에 신청할 때 자동으로 생김 · 계정당 한 줄 · '
  '사업자등록번호 · 사업자 인증 없음 → 사업자 인증 · 세금계산서 판정에 섞이지 않음)';

/* ── ② 이 계정이 파트너센터에서 쓰는 줄 ──────────────────────────── */
CREATE OR REPLACE FUNCTION public.fn_actor_business(p_account uuid, p_create boolean DEFAULT false) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE v uuid; a record;
BEGIN
  IF p_account IS NULL THEN RETURN NULL; END IF;

  /* 1) 이미 신청이 붙은 줄(입점 · 축 · 공인중개사 · 자격 심사) — 하던 곳에서 이어서 합니다 */
  SELECT b.id INTO v
    FROM public.businesses b
   WHERE b.account_id = p_account
     AND (EXISTS (SELECT 1 FROM public.partners p WHERE p.business_id = b.id)
          OR EXISTS (SELECT 1 FROM public.mal_partner_axes x WHERE x.business_id = b.id)
          OR EXISTS (SELECT 1 FROM public.broker_verifications x WHERE x.business_id = b.id)
          OR EXISTS (SELECT 1 FROM public.qualification_reviews x WHERE x.business_id = b.id))
   ORDER BY EXISTS (SELECT 1 FROM public.partners p WHERE p.business_id = b.id) DESC,
            (b.verified_at IS NOT NULL) DESC, b.created_at
   LIMIT 1;
  IF v IS NOT NULL THEN RETURN v; END IF;

  /* 2) 인증된 사업자 */
  SELECT b.id INTO v FROM public.businesses b
   WHERE b.account_id = p_account AND b.kind = 'BUSINESS' AND b.verified_at IS NOT NULL
   ORDER BY b.verified_at DESC LIMIT 1;
  IF v IS NOT NULL THEN RETURN v; END IF;

  /* 3) 개인 활동 정보 — 본인인증 계정이면 없을 때 만듭니다 */
  SELECT b.id INTO v FROM public.businesses b WHERE b.account_id = p_account AND b.kind = 'PERSON';
  IF v IS NOT NULL THEN RETURN v; END IF;
  SELECT x.name, x.identity_verified_at INTO a FROM public.accounts x WHERE x.id = p_account;
  IF p_create AND a.identity_verified_at IS NOT NULL THEN
    INSERT INTO public.businesses (account_id, kind, company_name, ceo_name)
    VALUES (p_account, 'PERSON', a.name, a.name)
    ON CONFLICT (account_id) WHERE kind = 'PERSON' DO NOTHING
    RETURNING id INTO v;
    IF v IS NULL THEN
      SELECT b.id INTO v FROM public.businesses b WHERE b.account_id = p_account AND b.kind = 'PERSON';
    END IF;
    RETURN v;
  END IF;

  /* 4) 심사 중인 사업자(예전 신청 그대로) */
  SELECT b.id INTO v FROM public.businesses b
   WHERE b.account_id = p_account AND b.kind = 'BUSINESS'
   ORDER BY b.created_at DESC LIMIT 1;
  RETURN v;
END $$;

COMMENT ON FUNCTION public.fn_actor_business(uuid, boolean) IS
  'v10.38 (D096) — 이 계정이 파트너센터(입점 · 축 · 공인중개사 · 자격 심사 · 인력대행 회신)에서 쓰는 줄. '
  '신청이 붙은 줄 → 인증된 사업자 → 개인 활동 정보(p_create 이고 본인인증이면 만듦) → 심사 중 사업자. 없으면 NULL.';

/* ── ③ 활동 자격 ──────────────────────────────────────────────────── */
CREATE OR REPLACE FUNCTION public.fn_actor_ok(p_business uuid) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT coalesce((
    SELECT CASE WHEN b.kind = 'PERSON'
                THEN a.identity_verified_at IS NOT NULL AND a.status = 'ACTIVE' AND a.withdrawn_at IS NULL
                ELSE b.verified_at IS NOT NULL END
      FROM public.businesses b JOIN public.accounts a ON a.id = b.account_id
     WHERE b.id = p_business), false);
$$;

COMMENT ON FUNCTION public.fn_actor_ok(uuid) IS
  'v10.38 (D096) — 파트너 활동 자격. 사업자 줄 = 사업자 인증 · 개인 활동 정보 = 본인인증(정상 계정).';

CREATE OR REPLACE FUNCTION public.fn_partner_requires_verified() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  /* v10.38 (D096 · P2P) — 사업자는 사업자 인증, 개인은 본인인증이면 활동합니다 */
  IF NEW.status = 'ACTIVE' AND NOT public.fn_actor_ok(NEW.business_id) THEN
    RAISE EXCEPTION 'PERM: 본인인증(개인) 또는 사업자 인증을 마친 계정만 파트너로 활동할 수 있습니다';
  END IF;
  IF NEW.status = 'SUSPENDED' AND coalesce(btrim(NEW.suspended_reason),'') = '' THEN
    RAISE EXCEPTION 'AUDIT: 파트너 정지에는 사유가 필요합니다';
  END IF;
  RETURN NEW;
END $$;

/* ── ④ 계정 종류 가드 — 개인 활동 정보는 통과 ─────────────────────── */
CREATE OR REPLACE FUNCTION public.fn_biz_type_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_type text;
BEGIN
  /* v10.38 (D096) — 개인 활동 정보(사업자 아님)는 계정 종류를 따지지 않습니다 */
  IF NEW.kind = 'PERSON' THEN
    RETURN NEW;
  END IF;

  SELECT account_type INTO v_type FROM accounts WHERE id = NEW.account_id;

  IF v_type = 'CORP' AND coalesce(btrim(NEW.corp_reg_no),'') = '' THEN
    RAISE EXCEPTION 'SIGNUP: 법인은 법인등록번호가 필요합니다';
  END IF;
  IF v_type = 'SOLE' AND coalesce(btrim(NEW.corp_reg_no),'') <> '' THEN
    RAISE EXCEPTION 'SIGNUP: 개인사업자는 법인등록번호를 가질 수 없습니다';
  END IF;
  IF v_type = 'PERSONAL' THEN
    RAISE EXCEPTION
      'SIGNUP: 개인회원은 사업자 정보를 등록할 수 없습니다 — 사업자 전환이 먼저입니다';
  END IF;
  RETURN NEW;
END $$;

/* ── ⑤ 노출료 세금계산서 줄 — 개인 파트너는 사업자등록번호 없음 ────── */
ALTER TABLE public.consult_directory_invoices ALTER COLUMN buyer_biz_no DROP NOT NULL;
COMMENT ON COLUMN public.consult_directory_invoices.buyer_biz_no IS
  '공급받는 자 사업자등록번호. v10.38 (D096) — 개인 파트너(개인 활동 정보)는 비어 있습니다 → 국세청 전송 대상 아님(카드 · 현금영수증으로 갈음).';

/* ── ⑥ 계정으로 사업자 줄을 찾는 곳 — 사업자 줄만 ──────────────────── */
DO $$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.fn_checklist_verdict(uuid)'::regprocedure);
  n := replace(d,
    'WHERE b.account_id = l.owner_account_id LIMIT 1) AS biz_verified',
    'WHERE b.account_id = l.owner_account_id AND b.kind = ''BUSINESS'' ORDER BY b.verified_at DESC NULLS LAST LIMIT 1) AS biz_verified');
  IF n <> d THEN EXECUTE n; END IF;

  d := pg_get_functiondef('public.fn_request_candidates(uuid, integer)'::regprocedure);
  n := replace(d,
    'LEFT JOIN businesses b ON b.account_id = cand.acc' || chr(10),
    'LEFT JOIN businesses b ON b.account_id = cand.acc AND b.kind = ''BUSINESS''' || chr(10));
  IF n <> d THEN EXECUTE n; END IF;

  d := pg_get_viewdef('public.v_property_pending'::regclass, true);
  n := replace(d,
    'LEFT JOIN businesses b ON b.account_id = l.owner_account_id' || chr(10),
    'LEFT JOIN businesses b ON b.account_id = l.owner_account_id AND b.kind = ''BUSINESS''' || chr(10));
  IF n <> d THEN EXECUTE 'CREATE OR REPLACE VIEW public.v_property_pending AS ' || n; END IF;
END $$;

/* ── ⑦ 파트너 이용약관 제1조 · 제7조 — 파트너 = 사업자 또는 본인인증 개인 · 개인은 영수증 ──
 *   글은 scripts/terms-text.js 한 벌 · 방식은 D062 · D095 와 같음(초안 · 검토 중이면 본문만 · 발행된 판이면 다음 번호로 발행). 지금 PARTNER 는 검토 중(LEGAL_REVIEW). */
CREATE TEMP TABLE _terms_text_d096 (code text PRIMARY KEY, body text NOT NULL, note text NOT NULL) ON COMMIT DROP;
INSERT INTO _terms_text_d096 VALUES ('PARTNER', $TERM$# 파트너 이용약관

## 제1조 (목적)
이 약관은 **(주)한국바이오헬스케어 소개뱅크 사업부**(이하 "회사")가
운영하는 파트너센터에서, 입점한 회원(사업자 또는 본인인증을 마친 개인,
이하 "파트너")이 상담 신청(리드)을 받고 확인하는 조건을 정합니다.
이 약관에 없는 것은 「이용약관」을 따릅니다.

## 제2조 (리드 이용료는 정보 이용료입니다)
① 리드 이용료(확인비용)는 상담 신청자의 연락처를 **여는 순간** 생기는
   정보 이용료입니다.
② 상담이 성사되든 안 되든 금액은 같습니다. 성사되었다고 더 내지 않고,
   결렬되었다고 돌려받지 않습니다.
③ 리드 이용료는 **소개비가 아닙니다.** 소개비는 당사자끼리 직접 주고받으며
   회사를 거치지 않습니다(이용약관 제3조).
④ 금액은 업종 기준 단가(파트너가 그보다 높게 정한 최고 확인비용이 있으면
   그 금액)에 리드 등급 비율을 곱해 정합니다. 등급은 신청자 확인 알림의
   결과가 정합니다.

## 제3조 (선불 충전)
① 파트너는 리드 이용료를 **미리 충전한 잔액**에서 냅니다. 잔액이 모자라면
   연락처를 열 수 없고, 잔액이 0이면 새 상담이 배정되지 않습니다.
② 충전금(유상 잔액)은 **회사가 제공하는 리드 확인 서비스의 이용료로만**
   씁니다. 다른 가맹점 · 다른 회원의 상품이나 서비스에 쓰거나, 다른 사람에게
   넘기거나, 현금으로 바꿀 수 없습니다.
③ 한 번에 충전하는 금액과 보유하는 유상 잔액에는 상한이 있으며, 그 금액은
   서비스 화면에 표시합니다.
④ 충전할 때 파트너 등급에 따른 할인분을 **보너스 잔액**으로 드립니다.
   보너스 잔액은 유상 잔액보다 먼저 쓰이고, 환불 대상이 아니며, 그 충전을
   환불하면 회수합니다.
⑤ 자동 청구를 켜시면 잔액이 정하신 금액 아래로 내려갈 때 등록된 카드로
   정하신 금액을 충전합니다. 언제든지 끄실 수 있습니다.

## 제4조 (반려와 환급)
① 허위 정보 · 연락 불가 · 중복 · 지역이나 분야 밖의 리드는 접수 후
   72시간 안에 반려를 신청하실 수 있습니다. 한 건에 한 번, 한 달에 받은
   리드의 15%까지입니다.
② 상담 결렬은 반려 사유가 아닙니다.
③ 반려가 인정되거나 회사의 위험감지로 무효가 되면, 그 건의 확인비용을
   **차감한 그대로 잔액으로 환급**합니다(보너스로 낸 몫은 보너스 잔액으로).

## 제5조 (환불)
① 남은 **유상 잔액**은 언제든지 환불을 신청하실 수 있습니다. 회사는 충전에
   쓰신 결제 수단의 결제를 취소하는 방법으로 돌려드립니다.
② 환불 수수료는 받지 않습니다.
③ 결제사 사정으로 취소가 되지 않으면 그 금액은 잔액으로 되돌리고 알려
   드립니다.
④ 파트너 계약이 끝나면 남은 유상 잔액의 환불을 안내합니다.

## 제6조 (전환 전 후불 청구분)
이 약관 시행 전에 생긴 미청구 이용료는 종전 방식(후불 청구)대로 청구합니다.

## 제7조 (세금계산서)
① 충전하고 사용하신 이용료의 세금계산서는 관련 법령에 따라 발행하며,
   발행 상태는 파트너센터 「정산」 화면에서 보실 수 있습니다.
② 사업자등록번호가 없는 개인 파트너에게는 세금계산서 대신 결제 때 받으신
   카드 · 현금영수증으로 갈음합니다.

---

시행일 〔시행일〕$TERM$, 'v10.38 — P2P: 파트너 = 사업자 또는 본인인증을 마친 개인 · 개인 파트너는 세금계산서 대신 카드 · 현금영수증(제1조 · 제7조)');

DO $$
DECLARE
  x record; r record; v_ver text; v_day text := to_char((now() AT TIME ZONE 'Asia/Seoul')::date, 'YYYY"년" FMMM"월" FMDD"일"');
BEGIN
  FOR x IN SELECT * FROM _terms_text_d096 LOOP
    UPDATE public.terms SET body = x.body, change_note = x.note
     WHERE code = x.code AND status IN ('DRAFT','LEGAL_REVIEW')
       AND fn_term_body_norm(body) <> fn_term_body_norm(x.body);
    SELECT * INTO r FROM public.terms WHERE code = x.code AND status = 'PUBLISHED' ORDER BY effective_from DESC LIMIT 1;
    IF r.code IS NULL OR fn_term_body_norm(r.body) = fn_term_body_norm(x.body) THEN CONTINUE; END IF;
    v_ver := split_part(r.version, '.', 1) || '.' || (split_part(r.version, '.', 2)::int + 1);
    WHILE EXISTS (SELECT 1 FROM public.terms WHERE code = r.code AND version = v_ver) LOOP
      v_ver := split_part(v_ver, '.', 1) || '.' || (split_part(v_ver, '.', 2)::int + 1);
    END LOOP;
    INSERT INTO public.terms (code, version, title, body, is_required, effective_from, status, display_order, gwan_code, change_note)
    VALUES (r.code, v_ver, r.title, replace(x.body, '〔시행일〕', v_day), r.is_required, 'infinity', 'LEGAL_REVIEW', r.display_order, r.gwan_code, x.note);
    UPDATE public.terms SET status = 'PUBLISHED', effective_from = now(), blocked_by = NULL WHERE code = r.code AND version = v_ver;
    RAISE NOTICE '% % 발행 — 파트너 = 사업자 또는 본인인증 개인(이전 % 는 보관)', r.code, v_ver, r.version;
  END LOOP;
END $$;

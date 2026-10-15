-- =====================================================================
-- B075_functions
--
-- SQL 함수 171개. 업무 규칙의 집행체입니다.
-- 테이블 뒤에 둡니다 — LANGUAGE sql 함수는 생성 시점에 참조 테이블을 검사하므로
-- 앞에 두면 "relation does not exist" 로 깨집니다(plpgsql 은 늦게 검사해 안 깨집니다).
--
-- 검증된 상태(불변식 135 · 공격 37 · 문서 22 통과)에서 생성된 기준선입니다.
-- 손으로 고치지 마십시오.
-- 스키마를 바꾸려면 prisma/migrations/ 에 새 파일을 추가하십시오.
-- =====================================================================

CREATE FUNCTION public.fn_account_change_log() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.key NOT LIKE 'company.bank%' THEN RETURN NEW; END IF;
  IF coalesce(OLD.value,'') IS NOT DISTINCT FROM coalesce(NEW.value,'') THEN RETURN NEW; END IF;

  INSERT INTO company_account_changes (changed_by, field, before_val, after_val)
  VALUES (NEW.updated_by, NEW.key, nullif(OLD.value,''), NEW.value);
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_account_change_ro() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'ACCOUNT: 계좌 변경 이력은 고치거나 지울 수 없습니다';
END $$;

CREATE FUNCTION public.fn_actor_is_active(p_account_id uuid) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT coalesce((SELECT status = 'ACTIVE' FROM accounts WHERE id = p_account_id), false);
$$;

CREATE FUNCTION public.fn_ad_active_slot_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.status = 'ACTIVE' AND NEW.slot_code IS NULL THEN
    RAISE EXCEPTION
      'ADS: 슬롯 없이 노출할 수 없습니다 — 자리를 정한 뒤 켜십시오';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_ad_anonymize(p_account uuid) RETURNS TABLE(audited integer, anonymized integer)
    LANGUAGE plpgsql
    AS $$
DECLARE v_leak int; v_n int;
BEGIN
  -- ① 감사 먼저. 동의 없이 나간 노출이 있었는지 셉니다.
  SELECT count(*) INTO v_leak
    FROM ad_events e
   WHERE e.account_id = p_account
     AND e.segment_code IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM member_ad_profiles p
                      WHERE p.account_id = p_account AND p.consented_at IS NOT NULL);

  INSERT INTO ad_leak_audits(account_id, leaked_rows) VALUES (p_account, v_leak);

  -- ② 감사 기록이 남은 뒤에만 익명화합니다.
  UPDATE ad_events
     SET account_id = NULL, member_hash = NULL, anonymized_at = now()
   WHERE account_id = p_account;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN QUERY SELECT v_leak, v_n;
END $$;

CREATE FUNCTION public.fn_ad_attribution_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_on boolean; v_biz uuid;
BEGIN
  IF NEW.source <> 'AD' THEN
    /* 사람 소개인데 광고 정보가 붙어 있으면 잘못 들어온 것입니다. */
    IF NEW.ad_creative_code IS NOT NULL OR NEW.ad_advertiser_biz_id IS NOT NULL THEN
      RAISE EXCEPTION
        'ATTR: 소개 귀속에 광고 정보를 붙일 수 없습니다 — 출처가 섞이면 누구 소개인지 답할 수 없습니다';
    END IF;
    RETURN NEW;
  END IF;

  IF coalesce(btrim(NEW.ad_creative_code), '') = '' THEN
    RAISE EXCEPTION 'ATTR: 광고 귀속에는 소재 코드가 필요합니다';
  END IF;

  SELECT attribution_enabled, advertiser_business_id INTO v_on, v_biz
    FROM ad_placements WHERE creative_code = NEW.ad_creative_code;

  IF v_on IS NULL THEN
    RAISE EXCEPTION 'ATTR: 없는 광고 소재입니다 (%)', NEW.ad_creative_code;
  END IF;

  /* 광고 매니저에서 켜지 않았으면 귀속하지 않습니다.
     기본이 꺼짐이라, 켠 적 없는 광고는 여기서 걸립니다. */
  IF NOT v_on THEN
    RAISE EXCEPTION
      'ATTR: 이 광고는 귀속이 꺼져 있습니다 (%) — 광고 매니저에서 켜야 합니다',
      NEW.ad_creative_code;
  END IF;

  /* ★ 그 광고주의 그 건에만 귀속됩니다.
     소재의 광고주를 그대로 박아, 나중에 다른 광고주로 옮겨 붙일 수 없게 합니다. */
  NEW.ad_advertiser_biz_id := v_biz;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_ad_booking_gate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_reg boolean; v_ok timestamptz;
BEGIN
  IF NEW.creative_code IS NOT NULL THEN
    SELECT is_regulated, review_confirmed_at INTO v_reg, v_ok
      FROM ad_placements WHERE creative_code = NEW.creative_code LIMIT 1;
    IF coalesce(v_reg, false) AND v_ok IS NULL THEN
      RAISE EXCEPTION
        'ADS: 심의 확인 전 소재는 예약할 수 없습니다 (%). 노출 단계에서 막으면 이미 계약금이 오간 뒤입니다',
        NEW.creative_code;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_ad_events_append_only() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'AD: 광고 집계 기록은 수정·삭제할 수 없습니다 (과금 근거)';
END $$;

CREATE FUNCTION public.fn_ad_external_gate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_until text;
BEGIN
  SELECT value INTO v_until FROM site_settings WHERE key = 'ads.self_only_until';
  IF coalesce(btrim(v_until), '') <> ''
     AND current_date <= v_until::date
     AND NOT NEW.is_precontract THEN
    RAISE EXCEPTION
      'ADS: %까지는 자사 소재만 노출합니다. 선계약 광고주라면 is_precontract 로 표시하십시오',
      v_until;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_ad_invoice_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.total <> NEW.amount + coalesce(NEW.vat, 0) THEN
    RAISE EXCEPTION 'ADINV: 합계가 맞지 않습니다 — 공급가 % + 부가세 % ≠ 합계 %',
      NEW.amount, NEW.vat, NEW.total;
  END IF;

  /* 받은 금액이 청구액을 넘을 수 없습니다. */
  IF NEW.paid_amount IS NOT NULL AND NEW.paid_amount > NEW.total THEN
    RAISE EXCEPTION 'ADINV: 받은 금액이 청구액보다 큽니다 — 확인하십시오';
  END IF;

  /* 완납 표시에는 금액과 시각이 있어야 합니다. */
  IF NEW.status = 'PAID' AND (NEW.paid_at IS NULL OR NEW.paid_amount IS NULL) THEN
    RAISE EXCEPTION 'ADINV: 완납으로 바꾸시려면 입금일과 금액을 적어야 합니다';
  END IF;

  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_ad_payment_apply() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_total bigint; v_paid bigint;
BEGIN
  SELECT total INTO v_total FROM ad_invoices WHERE id = NEW.invoice_id;
  SELECT coalesce(sum(amount), 0) INTO v_paid
    FROM ad_payments WHERE invoice_id = NEW.invoice_id;

  UPDATE ad_invoices
     SET paid_amount = v_paid,
         paid_at     = CASE WHEN v_paid >= v_total THEN NEW.paid_at ELSE paid_at END,
         pay_method  = NEW.method,
         status      = CASE WHEN v_paid >= v_total THEN 'PAID'
                            WHEN v_paid > 0        THEN 'PARTIAL'
                            ELSE status END
   WHERE id = NEW.invoice_id;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_ad_payment_ro() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'ADPAY: 입금 기록은 고치거나 지울 수 없습니다 — 잘못 넣으셨으면 반대 기록을 남기십시오';
END $$;

CREATE FUNCTION public.fn_ad_regulated_gate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_reg boolean; v_conf timestamptz; v_cat text;
BEGIN
  SELECT is_regulated, review_confirmed_at, category
    INTO v_reg, v_conf, v_cat
    FROM ad_placements WHERE id = NEW.creative_id;

  IF v_reg THEN
    -- 대부·다단계는 심의로도 열리지 않습니다. 등록 자체가 제한업종입니다.
    IF v_cat IN ('대부','다단계') THEN
      RAISE EXCEPTION
        'INV-6: 제한업종 소재는 세그먼트에 지정할 수 없습니다 (%)', v_cat;
    END IF;
    -- 의료는 심의필 본사 확인 후에만 열립니다.
    IF v_conf IS NULL THEN
      RAISE EXCEPTION
        'RSK-07: 심의 확인 전 규제 소재는 세그먼트에 지정할 수 없습니다 (의료법 제27조)';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_ad_slot_gate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.slot_code IS NOT NULL AND NEW.is_regulated THEN
    IF NEW.category IN ('대부','다단계') THEN
      RAISE EXCEPTION 'INV-6: 제한업종 소재는 슬롯에 배정할 수 없습니다 (%)', NEW.category;
    END IF;
    IF NEW.review_confirmed_at IS NULL THEN
      RAISE EXCEPTION 'RSK-07: 심의 확인 전 규제 소재는 슬롯에 배정할 수 없습니다';
    END IF;
  END IF;
  -- 규제 소재는 노출 상태로 올릴 수 없습니다.
  IF NEW.status = 'ACTIVE' AND NEW.is_regulated AND NEW.review_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'RSK-07: 심의 확인 전 규제 소재는 노출할 수 없습니다';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_ai_decision_ro() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'AI: 판정 이력은 고치거나 지울 수 없습니다 — 감사 근거입니다';
END $$;

CREATE FUNCTION public.fn_ai_match_no_fee() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.match_source = 'AI_DIRECT' THEN
    IF NEW.introducer_account_id IS NOT NULL THEN
      RAISE EXCEPTION 'INV-2: AI 직접매칭에는 소개자가 없습니다';
    END IF;
    IF coalesce(NEW.agreed_fee, 0) > 0 THEN
      RAISE EXCEPTION 'INV-9R: AI 직접매칭에는 사람 소개비를 지급하지 않습니다';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_apply_priority_label() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.is_priority_exposed AND NEW.priority_label IS NULL THEN
    SELECT value INTO NEW.priority_label
      FROM site_settings WHERE key = 'exposure.priority_label';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_archive_prior_terms() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.status = 'PUBLISHED' AND OLD.status IS DISTINCT FROM 'PUBLISHED' THEN
    UPDATE terms SET status = 'ARCHIVED'
     WHERE code = NEW.code AND version <> NEW.version
       AND status IN ('PUBLISHED','LEGAL_REVIEW','DRAFT');
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_assert_active_subscription() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE s record;
BEGIN
  SELECT * INTO s FROM subscriptions WHERE id = NEW.subscription_id;
  IF s.status NOT IN ('ACTIVE','PAST_DUE') THEN
    RAISE EXCEPTION 'INV-8 violated: subscription % is %', s.id, s.status;
  END IF;
  IF NEW.issued_at > s.current_period_end THEN
    RAISE EXCEPTION 'INV-8 violated: subscription period expired';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_feature_on(p_name text) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT COALESCE((SELECT value = 'on' FROM site_settings
                    WHERE key = 'feature.' || p_name), false);
$$;

CREATE FUNCTION public.fn_assert_agreed_fee_matches_lock() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE locked_amount numeric(14,0);
BEGIN
  IF NEW.agreed_fee IS DISTINCT FROM OLD.agreed_fee THEN

    -- 소개비가 꺼져 있으면 금액 자체가 있으면 안 됩니다.
    -- 플랫폼이 다루지 않는 값이 거래에 남으면 나중에 근거처럼 쓰입니다.
    IF NOT fn_feature_on('referral_fee') AND NEW.agreed_fee IS NOT NULL THEN
      RAISE EXCEPTION
        'FEATURE_OFF: 소개비는 당사자 간 합의 사항이라 거래에 금액을 기록하지 않습니다 (deal %)',
        NEW.id;
    END IF;

    SELECT amount INTO locked_amount
      FROM fee_agreements
     WHERE deal_id = NEW.id AND state = 'LOCKED';

    IF NEW.agreed_fee IS NOT NULL AND locked_amount IS NULL THEN
      RAISE EXCEPTION
        'D-1 violated: agreed_fee set without a LOCKED fee_agreement (deal %)', NEW.id;
    END IF;
    IF NEW.agreed_fee IS DISTINCT FROM locked_amount THEN
      RAISE EXCEPTION
        'D-1 violated: agreed_fee % <> LOCKED agreement % (deal %)',
        NEW.agreed_fee, locked_amount, NEW.id;
    END IF;
    NEW.agreed_fee_fixed_at := coalesce(NEW.agreed_fee_fixed_at, now());
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_attribution_resolve(p_account_id uuid, p_at timestamp with time zone, p_policy integer DEFAULT 1) RETURNS TABLE(event_id bigint, code text, occurred_at timestamp with time zone, channel text)
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE pol record;
BEGIN
  SELECT * INTO pol FROM attribution_policies WHERE version = p_policy;
  IF pol IS NULL THEN RAISE EXCEPTION 'unknown attribution policy %', p_policy; END IF;

  RETURN QUERY
  SELECT e.id, e.code, e.occurred_at, e.channel
    FROM attribution_events e
   WHERE e.channel = ANY (pol.allow_channels)
     AND e.occurred_at <= p_at
     AND p_at < e.occurred_at + (pol.window_days || ' days')::interval
     AND (
          e.account_id = p_account_id
       OR e.visitor_key IN (
            SELECT vi.visitor_key FROM visitor_identities vi
             WHERE vi.account_id = p_account_id
               AND vi.linked_at >= e.occurred_at   -- 유입 이후에 연결된 계정만
          )
     )
   ORDER BY
     CASE WHEN pol.model = 'FIRST_TOUCH' THEN e.occurred_at END ASC,
     CASE WHEN pol.model = 'LAST_TOUCH'  THEN e.occurred_at END DESC,
     e.id ASC                                     -- 동시각 tie-break: 재현성 보장
   LIMIT 1;
END $$;

CREATE FUNCTION public.fn_assert_attribution_snapshot() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE ev record; pol int;
BEGIN
  IF NEW.status = 'CONFIRMED' AND OLD.status IS DISTINCT FROM 'CONFIRMED'
     AND NEW.introducer_account_id IS NOT NULL THEN

    IF NEW.attributed_event_id IS NULL THEN
      SELECT version INTO pol FROM attribution_policies
       WHERE effective_from <= NEW.created_at
       ORDER BY effective_from DESC LIMIT 1;

      SELECT * INTO ev
        FROM fn_attribution_resolve(NEW.buyer_account_id, NEW.created_at, pol);

      IF ev.event_id IS NULL THEN
        RAISE EXCEPTION
          'INV-2 violated: 귀속 근거가 없습니다. 소개자를 지정할 수 없습니다 (deal %)', NEW.id;
      END IF;

      NEW.attributed_event_id          := ev.event_id;
      NEW.attributed_code              := ev.code;
      NEW.attributed_at                := now();
      NEW.attribution_policy_version   := pol;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_assert_both_confirmed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.status = 'CONFIRMED' AND OLD.status IS DISTINCT FROM 'CONFIRMED' THEN
    IF (SELECT count(*) FROM deal_confirmations WHERE deal_id = NEW.id) < 2 THEN
      RAISE EXCEPTION 'INV-4 violated: both parties must confirm deal %', NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_assert_both_confirmed_ins() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.status = 'CONFIRMED' THEN
    -- INSERT 시점에는 아직 확인 기록이 있을 수 없습니다.
    -- 확정 상태로 곧장 만들어지는 행 자체를 금지합니다.
    IF (SELECT count(*) FROM deal_confirmations WHERE deal_id = NEW.id) < 2 THEN
      RAISE EXCEPTION
        'INV-4 violated: deal cannot be created as CONFIRMED without both confirmations';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_assert_gwan_open() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.is_active AND NOT coalesce(OLD.is_active, false) THEN
    IF NOT EXISTS (SELECT 1 FROM gwan_form_copy WHERE gwan_code = NEW.code) THEN
      RAISE EXCEPTION
        'NO_FORM_COPY: 등록 폼 문구가 없어 관을 열 수 없습니다. gwan_form_copy 를 먼저 채우십시오.';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM categories WHERE gwan_code = NEW.code AND status = 'APPROVED'
    ) THEN
      RAISE EXCEPTION
        'NO_APPROVED_CATEGORY: 승인된 업종이 없어 관을 열 수 없습니다.';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_assert_labor_law_check() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.status = 'APPROVED' THEN
    IF NEW.labor_law_flag IS NULL THEN
      RAISE EXCEPTION
        'A-14: 업종 승인 전 직업안정법 해당 여부 판정이 필요합니다 (%)', NEW.name;
    END IF;
    IF NEW.labor_law_flag = 'APPLICABLE' THEN
      RAISE EXCEPTION
        'A-14: 유료직업소개사업 등록 대상 업종은 승인할 수 없습니다 (%)', NEW.name;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_assert_listing_slots() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE slots int; cur int;
BEGIN
  IF NEW.status <> 'PUBLISHED' THEN RETURN NEW; END IF;
  SELECT p.listing_slots INTO slots
    FROM subscriptions s JOIN subscription_plans p ON p.code = s.plan_code
   WHERE s.account_id = NEW.owner_account_id AND s.status IN ('ACTIVE','PAST_DUE')
   LIMIT 1;
  IF slots IS NULL THEN RETURN NEW; END IF;
  SELECT count(*) INTO cur FROM listings
   WHERE owner_account_id = NEW.owner_account_id AND status = 'PUBLISHED'
     AND id <> NEW.id;
  IF cur >= slots THEN
    RAISE EXCEPTION 'listing slot limit reached: % of % used', cur, slots;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_assert_no_unresolved_vars() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.body ~ '\{[a-zA-Z]+\}' THEN
    RAISE EXCEPTION 'UNRESOLVED_TEMPLATE_VAR: 치환되지 않은 변수가 있습니다 — %',
      substring(NEW.body from '\{[a-zA-Z]+\}');
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_assert_optout_allowed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE p record;
BEGIN
  IF NOT NEW.enabled THEN
    SELECT * INTO p FROM notification_event_policies WHERE event_code = NEW.event_code;
    IF p.event_code IS NOT NULL AND NOT p.optout_allowed THEN
      RAISE EXCEPTION 'NOTIFICATION_OPTOUT_FORBIDDEN: %는 수신거부할 수 없습니다.', p.name;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_assert_promo_plan() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.is_promo AND NEW.plan_code <> 'STANDARD' THEN
    RAISE EXCEPTION
      'B-21 violated: promo subscription must be STANDARD-equivalent (got %)',
      NEW.plan_code;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_assert_settlement_rules() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
  SELECT * INTO b FROM businesses WHERE id = NEW.payee_business_id;
  IF b.verified_at IS NULL THEN
    RAISE EXCEPTION 'INV-10 violated: payee business % is not verified', b.id;
  END IF;
  IF b.account_id <> NEW.payee_account_id THEN
    RAISE EXCEPTION 'payee business does not belong to payee account';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_assert_term_publish() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.status = 'PUBLISHED' THEN
    IF btrim(coalesce(NEW.body,'')) = '' THEN
      RAISE EXCEPTION 'TERM_BODY_EMPTY: 내용 없이 발행할 수 없습니다 (%)', NEW.title;
    END IF;
    IF NEW.effective_from = 'infinity' THEN
      RAISE EXCEPTION 'TERM_EFFECTIVE_DATE_REQUIRED: 시행일을 지정하십시오 (%)', NEW.title;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_assert_view_quota() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE s record; p record;
BEGIN
  IF NEW.subscription_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO s FROM subscriptions WHERE id = NEW.subscription_id;
  SELECT * INTO p FROM subscription_plans WHERE code = s.plan_code;
  IF p.request_views_per_month IS NOT NULL
     AND s.request_views_used >= p.request_views_per_month THEN
    RAISE EXCEPTION 'view quota exceeded: plan % allows %/month',
      p.code, p.request_views_per_month;
  END IF;
  UPDATE subscriptions SET request_views_used = request_views_used + 1
   WHERE id = NEW.subscription_id;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_attribute_call() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE sn record;
BEGIN
  SELECT * INTO sn FROM safe_numbers WHERE id = NEW.safe_number_id;
  IF sn.code IS NOT NULL THEN
    INSERT INTO attribution_events(code, visitor_key, channel, occurred_at, expires_at, raw)
    VALUES (sn.code, coalesce(sn.visitor_key, NEW.caller_hash), 'CALL',
            NEW.occurred_at, NEW.occurred_at + interval '90 days',
            jsonb_build_object('safe_number_id', sn.id, 'duration_sec', NEW.duration_sec));
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_auto_confirm_on_contract() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE d record; biz record;
BEGIN
  IF NEW.signed_by_buyer_at IS NULL OR NEW.signed_by_seller_at IS NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.signed_by_buyer_at IS NOT NULL AND OLD.signed_by_seller_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO d FROM deals WHERE id = NEW.deal_id;
  IF d.status IN ('CONFIRMED','SETTLED','CANCELLED') THEN RETURN NEW; END IF;

  INSERT INTO deal_confirmations(deal_id, party, is_auto, source)
  VALUES (d.id,'BUYER',true,'CONTRACT'), (d.id,'SELLER',true,'CONTRACT')
  ON CONFLICT (deal_id, party) DO NOTHING;

  UPDATE deals
     SET status = 'CONFIRMED', confirmed_at = now(), confirm_mode = 'CONTRACT'
   WHERE id = d.id;

  -- 소개비 기능이 켜져 있을 때만 정산을 만듭니다.
  IF fn_feature_on('referral_fee')
     AND d.introducer_account_id IS NOT NULL AND d.agreed_fee IS NOT NULL THEN
    SELECT * INTO biz FROM businesses
     WHERE account_id = d.introducer_account_id AND verified_at IS NOT NULL
     LIMIT 1;
    IF biz.id IS NOT NULL THEN
      INSERT INTO settlements(deal_id, payee_account_id, payee_business_id, amount, status)
      VALUES (d.id, d.introducer_account_id, biz.id, d.agreed_fee, 'REQUESTED')
      ON CONFLICT (deal_id) DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_check_banned_words(p_text text, p_gwan text) RETURNS TABLE(word text, severity text)
    LANGUAGE sql STABLE
    AS $$
  SELECT b.word, b.severity
    FROM banned_words b
   WHERE b.is_active
     AND (b.gwan_code IS NULL OR b.gwan_code = p_gwan)
     AND btrim(b.word) <> ''            -- 빈 규칙은 전건 적중을 만듭니다
     AND CASE b.match_type
           WHEN 'EXACT'    THEN p_text = b.word
           -- lower() + position() : 대소문자 무시 + 문자 그대로 비교
           WHEN 'CONTAINS' THEN position(lower(b.word) in lower(p_text)) > 0
           WHEN 'REGEX'    THEN p_text ~* b.word
           ELSE false
         END;
$$;

CREATE FUNCTION public.fn_auto_review_reasons(p_review_item_id uuid) RETURNS text[]
    LANGUAGE plpgsql
    AS $$
DECLARE
  ri record; l record; b record; c record;
  reasons text[] := '{}';
  pol record;
  prior_rejects int;
  warn_word text;
BEGIN
  SELECT * INTO ri FROM review_items WHERE id = p_review_item_id;
  IF ri IS NULL THEN RETURN ARRAY['NOT_FOUND']; END IF;

  SELECT * INTO pol FROM auto_review_policies WHERE key = 'auto_approve_enabled';
  IF NOT pol.enabled THEN RETURN ARRAY['AUTO_DISABLED']; END IF;

  IF ri.target_type <> 'LISTING' THEN
    RETURN ARRAY['TARGET_TYPE_' || ri.target_type];
  END IF;

  SELECT * INTO l FROM listings WHERE id = ri.target_id;
  IF l IS NULL THEN RETURN ARRAY['TARGET_MISSING']; END IF;

  SELECT * INTO b FROM businesses
   WHERE account_id = l.owner_account_id ORDER BY verified_at NULLS LAST LIMIT 1;
  SELECT * INTO c FROM categories WHERE id = l.category_id;

  -- ★ 주의 단어. 문맥에 따라 정상일 수 있어 차단하지 않고 사람에게 보냅니다
  SELECT w.word INTO warn_word
    FROM fn_check_banned_words(
           coalesce(l.title,'') || ' ' || coalesce(l.body,''), l.gwan_code) w
   WHERE w.severity = 'WARN' LIMIT 1;
  IF warn_word IS NOT NULL THEN
    reasons := array_append(reasons, 'BANNED_WORD_WARN');
  END IF;

  SELECT * INTO pol FROM auto_review_policies WHERE key = 'manual_unverified_business';
  IF pol.enabled AND (b IS NULL OR b.verified_at IS NULL) THEN
    reasons := array_append(reasons, 'UNVERIFIED_BUSINESS');
  END IF;

  SELECT * INTO pol FROM auto_review_policies WHERE key = 'manual_first_listing';
  IF pol.enabled AND NOT EXISTS (
       SELECT 1 FROM listings x
        WHERE x.owner_account_id = l.owner_account_id
          AND x.id <> l.id AND x.status = 'PUBLISHED'
     ) THEN
    reasons := array_append(reasons, 'FIRST_LISTING');
  END IF;

  SELECT * INTO pol FROM auto_review_policies WHERE key = 'manual_fee_threshold';
  IF pol.enabled AND l.desired_fee IS NOT NULL AND l.desired_fee >= pol.num_value THEN
    reasons := array_append(reasons, 'HIGH_FEE');
  END IF;

  SELECT * INTO pol FROM auto_review_policies WHERE key = 'manual_after_reject';
  IF pol.enabled THEN
    SELECT count(*) INTO prior_rejects FROM review_items x
     WHERE x.submitted_by = l.owner_account_id AND x.status = 'REJECTED';
    IF prior_rejects > 0 THEN reasons := array_append(reasons, 'PRIOR_REJECT'); END IF;
  END IF;

  SELECT * INTO pol FROM auto_review_policies WHERE key = 'manual_gated_category';
  IF pol.enabled AND c.restricted_code IS NOT NULL AND EXISTS (
       SELECT 1 FROM restricted_industries r
        WHERE r.code = c.restricted_code AND r.gwan_code = l.gwan_code
          AND r.is_active AND r.mode = 'GATED'
     ) THEN
    reasons := array_append(reasons, 'GATED_CATEGORY');
  END IF;

  SELECT * INTO pol FROM auto_review_policies WHERE key = 'min_body_length';
  IF pol.enabled AND coalesce(length(btrim(l.body)), 0) < pol.num_value THEN
    reasons := array_append(reasons, 'THIN_CONTENT');
  END IF;

  RETURN reasons;
END $$;

CREATE FUNCTION public.fn_auto_review_on_enqueue() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE reasons text[]; rate numeric; sampled boolean := false;
BEGIN
  reasons := fn_auto_review_reasons(NEW.id);

  IF array_length(reasons, 1) IS NULL THEN
    SELECT num_value INTO rate FROM auto_review_policies
     WHERE key = 'sample_audit_rate' AND enabled;
    sampled := coalesce(random() * 100 < rate, false);

    UPDATE review_items
       SET decision_mode = 'AUTO', manual_reasons = NULL,
           status = 'APPROVED', decided_at = now(), audit_sampled = sampled
     WHERE id = NEW.id;

    UPDATE listings
       SET status = 'PUBLISHED', published_at = now()
     WHERE id = NEW.target_id AND status = 'IN_REVIEW';

    INSERT INTO review_events (review_item_id, event, memo)
    VALUES (NEW.id, 'APPROVED', '자동검수' ||
            CASE WHEN sampled THEN ' (표본 감사 대상)' ELSE '' END);

    INSERT INTO audit.audit_logs (actor_role, action, target_type, target_id, after_data)
    VALUES ('SYSTEM', 'REVIEW_AUTO_APPROVED', NEW.target_type, NEW.target_id,
            jsonb_build_object('review_item_id', NEW.id, 'sampled', sampled));
  ELSE
    UPDATE review_items
       SET decision_mode = 'MANUAL', manual_reasons = reasons
     WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_badge_apply_decision() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE b record;
BEGIN
  IF NEW.target_type <> 'LISTING_BADGE' THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('APPROVED','REJECTED') THEN RETURN NEW; END IF;
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  SELECT * INTO b FROM listing_badges WHERE id = NEW.target_id;
  IF b IS NULL THEN RETURN NEW; END IF;

  IF NEW.status = 'APPROVED' THEN
    UPDATE listing_badges
       SET status = 'GRANTED', decided_by = NEW.decision_by, decided_at = now()
     WHERE id = b.id;
    IF b.badge_type = 'URGENT' THEN
      UPDATE listings SET badge_urgent_until = b.valid_until WHERE id = b.listing_id;
    ELSE
      UPDATE listings SET badge_verified_at = now() WHERE id = b.listing_id;
    END IF;
  ELSE
    UPDATE listing_badges
       SET status = 'REJECTED', decided_by = NEW.decision_by, decided_at = now(),
           reject_reason_code = NEW.reject_reason_code, reject_memo = NEW.reject_memo
     WHERE id = b.id;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_badge_enqueue() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE l record; cnt int; max_days int; max_active int;
BEGIN
  SELECT * INTO l FROM listings WHERE id = NEW.listing_id;
  IF l.status <> 'PUBLISHED' THEN
    RAISE EXCEPTION 'BADGE_LISTING_NOT_PUBLISHED: 노출 중인 매물에만 신청할 수 있습니다.';
  END IF;
  IF l.owner_account_id <> NEW.requested_by THEN
    RAISE EXCEPTION 'BADGE_NOT_OWNER: 본인 매물에만 신청할 수 있습니다.';
  END IF;

  IF NEW.badge_type = 'URGENT' THEN
    SELECT num_value::int INTO max_days FROM auto_review_policies WHERE key = 'urgent_max_days';
    IF NEW.valid_until > now() + (max_days || ' days')::interval THEN
      RAISE EXCEPTION 'URGENT_PERIOD_TOO_LONG: 급구 기한은 최대 %일입니다.', max_days;
    END IF;

    SELECT num_value::int INTO max_active FROM auto_review_policies WHERE key = 'urgent_max_active';
    SELECT count(*) INTO cnt FROM listing_badges b
      JOIN listings x ON x.id = b.listing_id
     WHERE x.owner_account_id = NEW.requested_by
       AND b.badge_type = 'URGENT' AND b.status = 'GRANTED'
       AND b.valid_until > now();
    IF cnt >= max_active THEN
      RAISE EXCEPTION 'URGENT_TOO_MANY: 동시에 유지할 수 있는 급구는 %건입니다.', max_active;
    END IF;
  END IF;

  INSERT INTO review_items (target_type, target_id, gwan_code, submitted_by, sla_due_at)
  VALUES ('LISTING_BADGE', NEW.id, l.gwan_code, NEW.requested_by,
          now() + interval '24 hours');

  UPDATE listing_badges SET status = 'IN_REVIEW' WHERE id = NEW.id;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_bank_assume_off() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.key NOT LIKE 'company.bank%' THEN RETURN NEW; END IF;
  IF NEW.value LIKE '%시험용%' OR NEW.value LIKE '999999-%' THEN RETURN NEW; END IF;

  /* 셋이 모두 실제 값으로 바뀌었는가 */
  IF NOT EXISTS (
    SELECT 1 FROM site_settings
     WHERE key LIKE 'company.bank%' AND key <> NEW.key
       AND (value LIKE '%시험용%' OR value LIKE '999999-%'
            OR coalesce(btrim(value),'') = '')
  ) THEN
    UPDATE site_settings SET value = 'off' WHERE key = 'assume.bank';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_billing_attempt_ro() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'BILLING: 청구 시도 기록은 수정·삭제할 수 없습니다';
END $$;

CREATE FUNCTION public.fn_biz_type_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_type text;
BEGIN
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

CREATE FUNCTION public.fn_block_audit_write() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'append-only table: DELETE on % is forbidden', TG_TABLE_NAME;
  END IF;

  -- 마스킹만 허용합니다. 나머지가 하나라도 다르면 거부합니다
  IF NEW.id                IS DISTINCT FROM OLD.id
  OR NEW.actor_account_id  IS DISTINCT FROM OLD.actor_account_id
  OR NEW.actor_role        IS DISTINCT FROM OLD.actor_role
  OR NEW.action            IS DISTINCT FROM OLD.action
  OR NEW.target_type       IS DISTINCT FROM OLD.target_type
  OR NEW.target_id         IS DISTINCT FROM OLD.target_id
  OR NEW.before_data       IS DISTINCT FROM OLD.before_data
  OR NEW.after_data        IS DISTINCT FROM OLD.after_data
  OR NEW.occurred_at       IS DISTINCT FROM OLD.occurred_at
  OR NEW.ip                IS NOT NULL
  OR NEW.user_agent        IS NOT NULL
  THEN
    RAISE EXCEPTION
      'append-only table: UPDATE on % is forbidden (IP·User-Agent 마스킹만 허용)',
      TG_TABLE_NAME;
  END IF;

  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_block_fee_agreement_when_off() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT fn_feature_on('referral_fee') THEN
    RAISE EXCEPTION
      'FEATURE_OFF: 소개비는 현재 당사자 간 합의 사항이며 플랫폼이 중개하지 않습니다';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_block_restricted_listing() RETURNS trigger
    LANGUAGE plpgsql
    AS $$

DECLARE r record; c record;
BEGIN
  -- 노출을 늘리는 방향에서만 검사한다.
  -- SUSPENDED/ARCHIVED 로 내리는 것까지 막으면 제한업종 지정 시 자동 차단이 불가능해진다
  IF NEW.status NOT IN ('DRAFT','IN_REVIEW','PUBLISHED') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.status IS NOT DISTINCT FROM NEW.status
     AND OLD.category_id IS NOT DISTINCT FROM NEW.category_id THEN
    RETURN NEW;
  END IF;
  SELECT * INTO c FROM categories WHERE id = NEW.category_id;
  IF c.restricted_code IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO r FROM restricted_industries
   WHERE code = c.restricted_code AND gwan_code = NEW.gwan_code AND is_active;
  IF r.id IS NULL OR r.mode = 'ALLOW' THEN RETURN NEW; END IF;
  IF r.mode IN ('BLOCK','AD_ONLY') THEN
    RAISE EXCEPTION 'RESTRICTED_CATEGORY: %', r.block_message;
  END IF;
  RETURN NEW;   -- GATED 는 자격 확인 후 앱 계층에서 판정
END
$$;

CREATE FUNCTION public.fn_block_write() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'append-only table: % on % is forbidden', TG_OP, TG_TABLE_NAME;
END $$;

CREATE FUNCTION public.fn_is_verified_broker(p_account uuid) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM broker_verifications v
      JOIN businesses b ON b.id = v.business_id
     WHERE b.account_id = p_account
       AND v.state = 'VERIFIED'
       AND (v.recheck_due IS NULL OR v.recheck_due >= current_date));
$$;

CREATE FUNCTION public.fn_broker_gate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_gwan text; v_owner_ok boolean; v_ready text;
BEGIN
  IF NEW.gwan_code <> 'MAL' THEN RETURN NEW; END IF;

  -- 중개사 인증이 있으면 통과
  IF fn_is_verified_broker(NEW.owner_account_id) THEN RETURN NEW; END IF;

  -- 소유자 직거래 경로가 열려 있고, 이 매물이 등기부로 확인됐으면 통과
  SELECT value INTO v_ready FROM site_settings WHERE key = 'mal.owner_direct_ready';
  IF coalesce(v_ready, 'off') = 'on' THEN
    SELECT EXISTS (SELECT 1 FROM owner_verifications o
                    WHERE o.listing_id = NEW.id AND o.state = 'VERIFIED')
      INTO v_owner_ok;
    IF v_owner_ok THEN RETURN NEW; END IF;
  END IF;

  RAISE EXCEPTION
    'BROKER: 부동산 소개는 중개사 인증이 필요합니다 (공인중개사법 9조) — '
    '소유자 직거래는 등기부 확인 후 별도 경로로 등록하십시오';
END $$;

CREATE FUNCTION public.fn_broker_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.state = 'VERIFIED' AND coalesce(OLD.state,'') <> 'VERIFIED' THEN
    IF NEW.lookup_result IS DISTINCT FROM 'MATCH' THEN
      RAISE EXCEPTION
        'BROKER: 국토부 대조 결과가 일치해야 승인할 수 있습니다 (현재 %)',
        coalesce(NEW.lookup_result, '미조회');
    END IF;
    IF NEW.decided_by IS NULL THEN
      -- 자동 승인 경로를 두지 않습니다. 대조가 맞아도 명의 도용이 있습니다.
      RAISE EXCEPTION 'BROKER: 운영 확인자가 필요합니다';
    END IF;
    NEW.decided_at := now();
    -- 정기 재확인. 등록이 취소돼도 우리에게 통보되지 않습니다.
    NEW.recheck_due := (current_date + 180);
  END IF;
  IF NEW.state = 'REJECTED' AND coalesce(btrim(NEW.reject_reason),'') = '' THEN
    RAISE EXCEPTION 'BROKER: 반려에는 사유가 필요합니다';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_broker_sync() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.state = 'VERIFIED' THEN
    UPDATE businesses SET broker_license_no = NEW.license_no,
                          broker_verified_at = now()
     WHERE id = NEW.business_id;
  ELSIF NEW.state IN ('REJECTED','EXPIRED') THEN
    UPDATE businesses SET broker_verified_at = NULL WHERE id = NEW.business_id;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_category_restrict_cascade() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_n int;
BEGIN
  /* 제한이 새로 걸렸을 때만 돕니다.
     이미 제한이던 것을 다시 저장할 때마다 돌면 불필요합니다. */
  IF NEW.restricted_code IS NOT NULL
     AND OLD.restricted_code IS DISTINCT FROM NEW.restricted_code THEN

    UPDATE listings
       SET status = 'SUSPENDED', updated_at = now()
     WHERE category_id = NEW.id
       AND status = 'PUBLISHED';
    GET DIAGNOSTICS v_n = ROW_COUNT;

    /* 내렸으면 등록자에게 알려야 합니다.
       말없이 내리면 "왜 사라졌냐"는 문의가 옵니다. */
    IF v_n > 0 THEN
      INSERT INTO notifications (account_id, event_code, title, body)
      SELECT DISTINCT l.owner_account_id, 'LISTING_RESTRICTED',
             '등록하신 건이 비공개로 전환되었습니다',
             '해당 업종이 제한업종으로 지정되어(' || coalesce(NEW.restricted_code,'') ||
             ') 노출을 중단했습니다. 자세한 사유는 고객센터로 문의해 주십시오.'
        FROM listings l
       WHERE l.category_id = NEW.id AND l.status = 'SUSPENDED';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_charge_success_fee() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_plan text; v_fee numeric;
BEGIN
  -- 플래그를 실제로 읽습니다. 이 한 줄이 없어서 스위치가 새고 있었습니다.
  IF NOT fn_feature_on('success_fee') THEN
    RETURN NEW;
  END IF;

  IF NEW.status <> 'CONFIRMED' OR (TG_OP = 'UPDATE' AND OLD.status = 'CONFIRMED') THEN
    RETURN NEW;
  END IF;

  SELECT s.plan_code, p.success_fee
    INTO v_plan, v_fee
    FROM subscriptions s
    JOIN subscription_plans p ON p.code = s.plan_code
   WHERE s.account_id = NEW.seller_account_id
     AND s.status = 'ACTIVE'
   ORDER BY p.success_fee ASC          -- 여러 건이면 회원에게 유리한 쪽
   LIMIT 1;

  -- 구독이 없으면 최고 요금(BASIC)을 적용합니다.
  -- 청구를 건너뛰면 구독 해지가 곧 수수료 회피가 됩니다.
  IF v_plan IS NULL THEN
    SELECT 'NONE', success_fee INTO v_plan, v_fee
      FROM subscription_plans WHERE code = 'BASIC';
  END IF;

  IF COALESCE(v_fee, 0) > 0 THEN
    INSERT INTO success_fees (deal_id, payer_account_id, plan_code, amount)
    VALUES (NEW.id, NEW.seller_account_id, v_plan, v_fee)
    ON CONFLICT (deal_id) DO NOTHING;
  END IF;

  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_check_k_alert() RETURNS TABLE(raised boolean, k_now numeric, k_prev numeric)
    LANGUAGE plpgsql
    AS $$
DECLARE cur numeric; prev numeric; pend int; thr numeric := 1.30;
BEGIN
  SELECT k INTO cur  FROM v_k_value
   WHERE cohort_month = date_trunc('month', now())::date;
  SELECT k INTO prev FROM v_k_value
   WHERE cohort_month = date_trunc('month', now() - interval '1 month')::date;
  SELECT count(*) INTO pend FROM review_items
   WHERE status IN ('QUEUED','IN_PROGRESS');

  IF coalesce(cur,0) >= thr AND coalesce(prev,0) >= thr THEN
    INSERT INTO ops_alerts(alert_code, severity, title, detail)
    VALUES ('K_VALUE_BREACH','CRITICAL',
            'k값 경보선 2개월 연속 초과 — 검수 증원 안건 발의',
            jsonb_build_object('k_current',cur,'k_previous',prev,
                               'threshold',thr,'review_pending',pend))
    ON CONFLICT DO NOTHING;
    RETURN QUERY SELECT true, cur, prev;
  ELSE
    RETURN QUERY SELECT false, cur, prev;
  END IF;
END $$;

CREATE FUNCTION public.fn_check_promo_expiry() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM subscriptions
   WHERE is_promo AND promo_notified_at IS NULL
     AND promo_ends_at BETWEEN now() AND now() + interval '14 days';
  IF n > 0 THEN
    INSERT INTO ops_alerts(alert_code, severity, title, detail)
    VALUES ('PROMO_EXPIRY_UNNOTIFIED',
            CASE WHEN n >= 50 THEN 'CRITICAL' ELSE 'WARN' END,
            format('프로모션 만료 D-14 미고지 %s건', n),
            jsonb_build_object('count', n))
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN n;
END $$;

CREATE FUNCTION public.fn_check_sla_alert() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM review_items
   WHERE status IN ('QUEUED','IN_PROGRESS') AND sla_due_at < now();
  IF n > 0 THEN
    INSERT INTO ops_alerts(alert_code, severity, title, detail)
    VALUES ('REVIEW_SLA_BREACH', CASE WHEN n >= 20 THEN 'CRITICAL' ELSE 'WARN' END,
            format('검수 SLA 위반 %s건', n), jsonb_build_object('count', n))
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN n;
END $$;

CREATE FUNCTION public.fn_checklist_verdict(p_listing_id uuid) RETURNS TABLE(auto_ok boolean, reason text)
    LANGUAGE plpgsql
    AS $_$
DECLARE r record; v_ok boolean; v_sql text; v_fail text; v_is_biz boolean;
BEGIN
  SELECT l.*, c.restricted_code,
         (SELECT b.verified_at FROM businesses b
           WHERE b.account_id = l.owner_account_id LIMIT 1) AS biz_verified,
         (SELECT a.account_type FROM accounts a WHERE a.id = l.owner_account_id) AS acct_type
    INTO r
    FROM listings l
    LEFT JOIN categories c ON c.id = l.category_id
   WHERE l.id = p_listing_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, '대상을 찾을 수 없습니다'; RETURN;
  END IF;

  -- ① 법적 게이트가 먼저입니다. 틀리면 과태료가 나옵니다.
  IF r.restricted_code IS NOT NULL THEN
    RETURN QUERY SELECT false, '제한업종 — 사람 심사'; RETURN;
  END IF;

  /* 사업자 등록은 인증이 있어야 합니다.
     개인회원은 애초에 판매 등록을 할 수 없으므로 여기 오지 않습니다 —
     온다면 그것 자체가 이상한 상태라 사람이 봐야 합니다. */
  v_is_biz := (r.acct_type = 'BUSINESS');
  IF v_is_biz AND r.biz_verified IS NULL THEN
    RETURN QUERY SELECT false, '사업자 인증 미완 — 사람 심사'; RETURN;
  END IF;
  IF NOT v_is_biz THEN
    RETURN QUERY SELECT false, '개인회원 판매 등록 — 사람 심사'; RETURN;
  END IF;

  IF coalesce(r.desired_fee, 0) >= 50000000 THEN
    RETURN QUERY SELECT false, '고액(5천만원 이상) — 사람 심사'; RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM review_items ri
              WHERE ri.target_id = p_listing_id AND ri.status = 'REJECTED') THEN
    RETURN QUERY SELECT false, '반려 이력 — 사람 심사'; RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM listings l2
                  WHERE l2.owner_account_id = r.owner_account_id
                    AND l2.id <> p_listing_id AND l2.status = 'PUBLISHED') THEN
    RETURN QUERY SELECT false, '첫 등록 — 사람 심사'; RETURN;
  END IF;

  -- ② 체크리스트
  FOR v_sql, v_fail IN
    SELECT check_sql, fail_message FROM listing_checklist
     WHERE target_type = 'LISTING' AND is_required ORDER BY sort_order
  LOOP
    EXECUTE format('SELECT (%s) FROM listings WHERE id = $1', v_sql)
       INTO v_ok USING p_listing_id;
    IF NOT coalesce(v_ok, false) THEN
      RETURN QUERY SELECT false, v_fail; RETURN;
    END IF;
  END LOOP;

  RETURN QUERY SELECT true, '체크리스트 통과 — 자동 노출';
END $_$;

CREATE FUNCTION public.fn_classify(p_text text) RETURNS TABLE(category_code text, name text, gwan_code text, grade text, score integer, matched text[])
    LANGUAGE sql STABLE
    AS $$
  SELECT c.code, c.name, c.gwan_code, c.grade,
         sum(v.weight)::int AS score,
         array_agg(v.term ORDER BY v.weight DESC) AS matched
    FROM classify_categories c
    JOIN classify_vocab v ON v.category_code = c.code
   WHERE c.is_active
     AND position(lower(v.term) in lower(p_text)) > 0
   GROUP BY c.code, c.name, c.gwan_code, c.grade
   ORDER BY sum(v.weight) DESC, c.sort_order
$$;

CREATE FUNCTION public.fn_classify_blocked(p_text text) RETURNS TABLE(source text, matched text, severity text, reason text)
    LANGUAGE sql STABLE
    AS $$
  -- 금칙어
  SELECT 'BANNED_WORD'::text, b.word, b.severity,
         '등록할 수 없는 표현입니다'::text
    FROM banned_words b
   WHERE b.is_active AND b.severity = 'BLOCK' AND btrim(b.word) <> ''
     AND CASE b.match_type
           WHEN 'REGEX' THEN p_text ~* b.word
           WHEN 'EXACT' THEN p_text = b.word
           ELSE position(lower(b.word) in lower(p_text)) > 0
         END

  UNION

  -- 제한업종 — 이름으로
  SELECT 'RESTRICTED_INDUSTRY'::text, r.name, 'BLOCK'::text,
         coalesce(r.block_message, r.legal_basis, '제한업종입니다')
    FROM restricted_industries r
   WHERE r.is_active AND r.mode IN ('BLOCK','AD_ONLY')
     AND position(lower(r.name) in lower(p_text)) > 0

  UNION

  -- 제한업종 — 실제로 쓰는 말로
  SELECT 'RESTRICTED_INDUSTRY'::text, r.name, 'BLOCK'::text,
         coalesce(r.block_message, r.legal_basis, '제한업종입니다')
    FROM restrict_vocab v
    JOIN restricted_industries r
      ON r.code = v.code AND r.is_active AND r.mode IN ('BLOCK','AD_ONLY')
   WHERE position(lower(v.term) in lower(p_text)) > 0;
$$;

CREATE FUNCTION public.fn_collect_gate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.state IN ('READY','RUNNING') THEN
    IF NEW.robots_at IS NULL THEN
      RAISE EXCEPTION 'COLLECT: 수집 전 robots 확인이 필요합니다';
    END IF;
    IF NEW.legal_at IS NULL THEN
      RAISE EXCEPTION 'COLLECT: 법무 회신 전에는 READY 로 올릴 수 없습니다';
    END IF;
  END IF;

  /* INV-C5 — 차단을 풀면 게이트를 다시 통과해야 합니다.
   *   BLOCKED → STOPPED 로만 갑니다. 곧바로 READY 는 안 됩니다. */
  IF TG_OP = 'UPDATE' AND OLD.state = 'BLOCKED' AND NEW.state <> 'STOPPED'
     AND NEW.state <> 'BLOCKED' THEN
    RAISE EXCEPTION
      'COLLECT: 차단을 풀면 STOPPED 로만 갑니다 — 게이트를 다시 통과시키십시오';
  END IF;

  /* 차단을 풀 때는 누가 풀었는지 남아야 합니다. */
  IF TG_OP = 'UPDATE' AND OLD.state = 'BLOCKED' AND NEW.state = 'STOPPED'
     AND NEW.unblocked_by IS NULL THEN
    RAISE EXCEPTION 'COLLECT: 차단을 푸신 분을 남겨야 합니다';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_collect_item_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE f record;
BEGIN
  SELECT * INTO f FROM collect_fetches WHERE id = NEW.fetch_id;
  IF f IS NULL THEN
    RAISE EXCEPTION 'COLLECT: 출처(fetch_id) 없는 데이터는 넣을 수 없습니다';
  END IF;
  IF f.status IN ('DONE','FAILED','ABORTED') THEN
    RAISE EXCEPTION
      'COLLECT: 끝난 실행에는 데이터를 더 넣을 수 없습니다 — 새로 실행하십시오';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_connection_requires_consent() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_state text; v_intro uuid;
BEGIN
  SELECT state, introducer_id INTO v_state, v_intro
    FROM introduction_invites WHERE id = NEW.invite_id;

  IF v_state IS DISTINCT FROM 'CONSENTED' THEN
    RAISE EXCEPTION
      'CONSENT: 상대방이 동의하지 않은 초대로는 연결할 수 없습니다 (현재 %)', coalesce(v_state,'없음');
  END IF;
  IF v_intro IS DISTINCT FROM NEW.introducer_id THEN
    RAISE EXCEPTION 'CONSENT: 초대를 보낸 소개자와 연결의 소개자가 다릅니다';
  END IF;
  IF NEW.introducer_id = NEW.requester_id THEN
    RAISE EXCEPTION 'INV-1: 자기 자신을 소개할 수 없습니다';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_contract_fulfil() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.state = 'FULFILLED' AND coalesce(OLD.state,'') <> 'FULFILLED' THEN
    UPDATE deals SET status = 'CONFIRMED', confirmed_at = now()
     WHERE id = NEW.deal_id AND status <> 'CONFIRMED';
  END IF;
  RETURN NULL;
END $$;

CREATE FUNCTION public.fn_contract_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_ok boolean;
BEGIN
  NEW.updated_at := now();

  -- 조건 합의: 양측이 각각 눌러야 AGREED
  IF NEW.state = 'AGREED' AND coalesce(OLD.state,'') <> 'AGREED' THEN
    IF NEW.agreed_by_buyer_at IS NULL OR NEW.agreed_by_seller_at IS NULL THEN
      RAISE EXCEPTION
        'CONTRACT: 양측이 모두 조건에 합의해야 합니다 (매수 % · 매도 %)',
        coalesce(NEW.agreed_by_buyer_at::text,'미확인'),
        coalesce(NEW.agreed_by_seller_at::text,'미확인');
    END IF;
    IF NEW.terms IS NULL THEN
      RAISE EXCEPTION 'CONTRACT: 합의 조건이 비어 있습니다 — 무엇에 합의했는지 남아야 합니다';
    END IF;
  END IF;

  -- 서명: 합의 뒤에만, 그리고 양측이 각각
  IF NEW.state = 'SIGNED' AND coalesce(OLD.state,'') <> 'SIGNED' THEN
    IF coalesce(OLD.state,'') <> 'AGREED' THEN
      RAISE EXCEPTION 'CONTRACT: 조건 합의(AGREED) 없이 서명할 수 없습니다';
    END IF;
    IF NEW.signed_by_buyer_at IS NULL OR NEW.signed_by_seller_at IS NULL THEN
      RAISE EXCEPTION 'CONTRACT: 양측이 모두 서명해야 합니다';
    END IF;
  END IF;

  -- 이행 완료: 서명 뒤에만, 양측 확인
  IF NEW.state = 'FULFILLED' AND coalesce(OLD.state,'') <> 'FULFILLED' THEN
    IF coalesce(OLD.state,'') <> 'SIGNED' THEN
      RAISE EXCEPTION 'CONTRACT: 서명 완료(SIGNED) 없이 이행 확인을 할 수 없습니다';
    END IF;
    IF NEW.fulfilled_by_buyer_at IS NULL OR NEW.fulfilled_by_seller_at IS NULL THEN
      RAISE EXCEPTION 'CONTRACT: 양측이 모두 이행을 확인해야 합니다';
    END IF;
  END IF;

  -- 파기: 사유 필수
  IF NEW.state = 'CANCELLED' AND coalesce(btrim(NEW.cancel_reason),'') = '' THEN
    RAISE EXCEPTION 'CONTRACT: 파기에는 사유가 필요합니다';
  END IF;

  -- 서명 후에는 조건을 바꿀 수 없습니다.
  IF OLD.state IN ('SIGNED','FULFILLED')
     AND NEW.terms IS DISTINCT FROM OLD.terms THEN
    RAISE EXCEPTION 'CONTRACT: 서명한 계약의 조건은 바꿀 수 없습니다 — 파기 후 다시 맺으십시오';
  END IF;

  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_crev_ro() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'CONTRACT: 계약 이력은 수정·삭제할 수 없습니다 (분쟁 근거)';
END $$;

CREATE FUNCTION public.fn_delivery_ro() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'NOTIFY: 발송 기록은 삭제할 수 없습니다';
  END IF;
  IF NEW.notification_id IS DISTINCT FROM OLD.notification_id
     OR NEW.channel IS DISTINCT FROM OLD.channel THEN
    RAISE EXCEPTION 'NOTIFY: 발송 기록의 대상·채널은 변경할 수 없습니다';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_derive_segment(p_account uuid) RETURNS text
    LANGUAGE sql STABLE
    AS $$
  SELECT CASE
    -- 관심 업종이 뚜렷하면 그 관을 씁니다
    WHEN EXISTS (SELECT 1 FROM listings l
                  WHERE l.owner_account_id = p_account AND l.gwan_code = 'BIZ')
      THEN 'SEG-B'
    WHEN EXISTS (SELECT 1 FROM listings l
                  WHERE l.owner_account_id = p_account AND l.gwan_code = 'MAL')
      THEN 'SEG-D'
    WHEN EXISTS (SELECT 1 FROM listings l
                  WHERE l.owner_account_id = p_account AND l.gwan_code = 'HLT')
      THEN 'SEG-F'
    WHEN EXISTS (SELECT 1 FROM partners p
                  JOIN businesses b ON b.id = p.business_id
                 WHERE b.account_id = p_account AND p.status = 'ACTIVE')
      THEN 'SEG-C'
    ELSE 'SEG-A'   -- 아직 알 수 없음 — 전체 공개 광고가 나갑니다
  END;
$$;

CREATE FUNCTION public.fn_duty_separation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE has_conflict boolean;
BEGIN
  IF NEW.role NOT IN ('ADMIN','PAYOUT') THEN RETURN NEW; END IF;

  /* SUPER 는 예외 — 사고 수습 때 열 사람이 하나는 있어야 합니다. */
  IF EXISTS (SELECT 1 FROM account_roles
              WHERE account_id = NEW.account_id AND role = 'SUPER') THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM account_roles
     WHERE account_id = NEW.account_id
       AND role = CASE WHEN NEW.role = 'ADMIN' THEN 'PAYOUT' ELSE 'ADMIN' END
  ) INTO has_conflict;

  IF has_conflict THEN
    RAISE EXCEPTION
      'DUTY: 한 사람이 정산 승인(ADMIN)과 지급 실행(PAYOUT)을 함께 가질 수 없습니다 — 사고가 나도 되돌릴 근거가 없어집니다';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_end_promo(p_subscription_id uuid, p_next_plan text) RETURNS TABLE(next_plan text, slots integer, suspended_listings integer)
    LANGUAGE plpgsql
    AS $$
DECLARE s record; v_slots int; cnt int := 0;
BEGIN
  SELECT * INTO s FROM subscriptions WHERE id = p_subscription_id;
  UPDATE subscriptions
     SET is_promo = false, plan_code = p_next_plan
   WHERE id = p_subscription_id;

  SELECT listing_slots INTO v_slots FROM subscription_plans WHERE code = p_next_plan;
  IF v_slots IS NOT NULL THEN
    WITH ranked AS (
      SELECT id, row_number() OVER (ORDER BY published_at DESC NULLS LAST) AS rn
        FROM listings
       WHERE owner_account_id = s.account_id AND status = 'PUBLISHED'
    )
    UPDATE listings SET status = 'SUSPENDED'
     WHERE id IN (SELECT id FROM ranked WHERE rn > v_slots);
    GET DIAGNOSTICS cnt = ROW_COUNT;
  END IF;
  RETURN QUERY SELECT p_next_plan, v_slots, cnt;
END $$;

CREATE FUNCTION public.fn_enforce_banned_words() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  txt text;
  hit record;
BEGIN
  txt := coalesce(NEW.title,'') || ' ' || coalesce(NEW.body,'');

  SELECT * INTO hit FROM fn_check_banned_words(txt, NEW.gwan_code)
   WHERE severity = 'BLOCK' LIMIT 1;

  IF hit.word IS NOT NULL THEN
    RAISE EXCEPTION 'BANNED_WORD: "%"는 사용할 수 없는 표현입니다.', hit.word;
  END IF;

  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_enforce_new_restriction() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE n int := 0;
BEGIN
  IF NEW.mode <> 'BLOCK' OR NOT NEW.is_active THEN RETURN NEW; END IF;

  WITH hit AS (
    SELECT l.id, l.owner_account_id, l.title
      FROM listings l JOIN categories c ON c.id = l.category_id
     WHERE c.restricted_code = NEW.code
       AND l.gwan_code = NEW.gwan_code
       AND l.status IN ('PUBLISHED','IN_REVIEW')
  ), upd AS (
    UPDATE listings SET status = 'SUSPENDED'
     WHERE id IN (SELECT id FROM hit) RETURNING id
  )
  INSERT INTO notifications(account_id, event_code, title, body, link_url)
  SELECT owner_account_id, 'LISTING_RESTRICTED',
         '등록하신 매물의 노출이 중단되었습니다',
         format('「%s」이(가) 제한 업종으로 지정되어 노출이 중단되었습니다. %s',
                title, NEW.block_message),
         '/my/listings'
    FROM hit;
  GET DIAGNOSTICS n = ROW_COUNT;

  INSERT INTO ops_alerts(alert_code, severity, title, detail)
  VALUES ('RESTRICTION_ENFORCED','WARN',
          format('제한업종 지정으로 %s건 노출 중단 (%s)', n, NEW.name),
          jsonb_build_object('code',NEW.code,'gwan',NEW.gwan_code,'affected',n))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_event_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.status = 'PUBLISHED' AND NEW.ends_at < now() THEN
    RAISE EXCEPTION
      'EVENT: 이미 끝난 이벤트는 열 수 없습니다 — 기간을 늘리시려면 새 이벤트를 만드십시오';
  END IF;

  /* 혜택 없는 이벤트는 이벤트가 아닙니다. */
  IF NEW.status = 'PUBLISHED' AND coalesce(btrim(NEW.benefit), '') = '' THEN
    RAISE EXCEPTION 'EVENT: 무엇을 드리는지 적어야 합니다';
  END IF;

  /* 선착순인데 인원을 안 적으면 끝이 없습니다. */
  IF NEW.join_type <> 'NONE' AND NEW.status = 'PUBLISHED'
     AND NEW.max_joins IS NULL THEN
    RAISE EXCEPTION
      'EVENT: 참여를 받으시려면 인원을 정하십시오 — 줄 수 있는 만큼만 받아야 합니다';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_event_join_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE e record; v_n int;
BEGIN
  SELECT * INTO e FROM events WHERE id = NEW.event_id;

  IF e.status <> 'PUBLISHED' THEN
    RAISE EXCEPTION 'EVENT: 진행 중인 이벤트가 아닙니다';
  END IF;
  IF now() < e.starts_at OR now() > e.ends_at THEN
    RAISE EXCEPTION 'EVENT: 이벤트 기간이 아닙니다 (% ~ %)',
      to_char(e.starts_at,'MM-DD'), to_char(e.ends_at,'MM-DD');
  END IF;
  IF e.join_type = 'NONE' THEN
    RAISE EXCEPTION 'EVENT: 참여 신청을 받지 않는 이벤트입니다';
  END IF;

  IF e.max_joins IS NOT NULL THEN
    SELECT count(*) INTO v_n FROM event_joins WHERE event_id = NEW.event_id;
    IF v_n >= e.max_joins THEN
      RAISE EXCEPTION 'EVENT: 정원이 찼습니다 (%명)', e.max_joins;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_event_join_ro() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'EVENT: 참여 기록은 지울 수 없습니다 — 지급 근거입니다';
END $$;

CREATE FUNCTION public.fn_expire_badges() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE n int;
BEGIN
  UPDATE listing_badges SET status = 'EXPIRED'
   WHERE status = 'GRANTED' AND badge_type = 'URGENT' AND valid_until <= now();
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE listings SET badge_urgent_until = NULL
   WHERE badge_urgent_until IS NOT NULL AND badge_urgent_until <= now();
  RETURN n;
END $$;

CREATE FUNCTION public.fn_gate_deal_actor() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT fn_actor_is_active(NEW.buyer_account_id) THEN
    RAISE EXCEPTION 'PERM: suspended or withdrawn buyer cannot create deals';
  END IF;
  IF NOT fn_actor_is_active(NEW.seller_account_id) THEN
    RAISE EXCEPTION 'PERM: suspended or withdrawn seller cannot create deals';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_gate_refcode_actor() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT fn_actor_is_active(NEW.owner_account_id) THEN
    RAISE EXCEPTION 'PERM: suspended or withdrawn account cannot issue referral codes';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_gated_category_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE c record; r record;
BEGIN
  IF NEW.status NOT IN ('DRAFT','IN_REVIEW','PUBLISHED') THEN RETURN NEW; END IF;
  IF NEW.category_id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO c FROM categories WHERE id = NEW.category_id;
  IF c.restricted_code IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO r FROM restricted_industries
   WHERE code = c.restricted_code AND gwan_code = NEW.gwan_code AND is_active;
  IF r.id IS NULL OR r.mode <> 'GATED' THEN RETURN NEW; END IF;

  /* 심의 대상은 번호가 있어야 합니다.
     "나중에 받겠다" 를 허용하면 심의 없는 광고가 그대로 나갑니다. */
  IF coalesce(btrim(NEW.review_no), '') = '' THEN
    RAISE EXCEPTION 'GATED: %', coalesce(r.block_message,
      '이 업종은 자격 확인이 필요합니다');
  END IF;

  /* 형식만 봅니다 — 진짜인지는 운영이 확인합니다.
     식약처 조회 연동 전에는 형식 확인이 할 수 있는 전부입니다. */
  IF NEW.review_no !~ '[0-9]{4}' THEN
    RAISE EXCEPTION
      'GATED: 심의필 번호 형식이 아닙니다 — 예) 심의필 제2026-0451호';
  END IF;

  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_grade_rate_monotone() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_bad int;
BEGIN
  SELECT count(*) INTO v_bad FROM (
    SELECT rate,
           lag(rate) OVER (
             PARTITION BY coalesce(gwan_code, '*')
             ORDER BY rank                    -- ★ 알파벳이 아니라 서열
           ) AS prev
      FROM lead_grade_rates
  ) t WHERE prev IS NOT NULL AND rate > prev;

  IF v_bad > 0 THEN
    RAISE EXCEPTION
      'GRADE: 등급 비율은 높은 등급이 더 커야 합니다 (관별로 각각)';
  END IF;
  RETURN NULL;
END $$;

CREATE FUNCTION public.fn_gwan_order_unique() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_dup int;
BEGIN
  SELECT count(*) INTO v_dup FROM (
    SELECT sort_order FROM gwans WHERE is_active
     GROUP BY sort_order HAVING count(*) > 1) t;
  IF v_dup > 0 THEN
    RAISE EXCEPTION
      'GWAN: 노출 순서가 겹칩니다 — 같은 값이 둘이면 표시 순서가 매번 달라집니다';
  END IF;
  RETURN NULL;
END $$;

CREATE FUNCTION public.fn_gwan_sale_mode(p_gwan text) RETURNS text
    LANGUAGE sql STABLE
    AS $$
  SELECT coalesce((SELECT sale_mode FROM gwans WHERE code = p_gwan), 'BROKER');
$$;

CREATE FUNCTION public.fn_hlt_cart_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE p record;
BEGIN
  SELECT * INTO p FROM hlt_products WHERE id = NEW.product_id;
  IF p.status <> 'ON_SALE' THEN
    RAISE EXCEPTION 'HLTC: 판매 중인 상품이 아닙니다 — %', p.name;
  END IF;
  /* 재고보다 많이 담는 것은 막습니다 — 주문 때 알면 이미 늦습니다. */
  IF p.stock < NEW.qty THEN
    RAISE EXCEPTION 'HLTC: 남은 수량이 %개입니다 — %', p.stock, p.name;
  END IF;

  INSERT INTO hlt_carts (account_id) VALUES (NEW.account_id)
    ON CONFLICT (account_id) DO UPDATE SET updated_at = now();
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_hlt_change_ro() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'HLTC: 요율 변경 이력은 고치거나 지울 수 없습니다';
END $$;

CREATE FUNCTION public.fn_hlt_rate_for(p_seller uuid, p_category_code text) RETURNS numeric
    LANGUAGE sql STABLE
    AS $$
  SELECT coalesce(
    (SELECT commission_rate FROM hlt_sellers WHERE id = p_seller AND commission_rate IS NOT NULL),
    (SELECT rate FROM hlt_commission_rates WHERE category_code = p_category_code),
    (SELECT rate FROM hlt_commission_rates WHERE category_code = '*'),
    10.00);
$$;

CREATE FUNCTION public.fn_hlt_one_seller() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_order_seller uuid; v_item_seller uuid;
BEGIN
  SELECT seller_id INTO v_order_seller FROM hlt_orders WHERE id = NEW.order_id;
  SELECT seller_id INTO v_item_seller  FROM hlt_products WHERE id = NEW.product_id;

  IF v_item_seller IS NULL THEN
    RAISE EXCEPTION 'HLTO: 판매자가 없는 상품은 주문할 수 없습니다';
  END IF;

  /* 주문에 판매자가 없으면 첫 품목의 판매자로 정합니다. */
  IF v_order_seller IS NULL THEN
    UPDATE hlt_orders SET seller_id = v_item_seller WHERE id = NEW.order_id;
  ELSIF v_order_seller <> v_item_seller THEN
    RAISE EXCEPTION
      'HLTO: 한 주문에 판매자가 섞일 수 없습니다 — 판매자별로 나눠 주문하십시오 (INV-H9)';
  END IF;

  /* 수수료를 **주문 시점에 박습니다.**
   * 요율만 두고 매번 계산하면 요율을 바꾼 순간 지난 정산이 달라집니다. */
  IF NEW.commission_rate IS NULL THEN
    NEW.commission_rate := fn_hlt_rate_for(
      v_item_seller,
      (SELECT c.code FROM hlt_products p
         LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.id = NEW.product_id));
  END IF;
  NEW.commission_amount := floor(NEW.amount * NEW.commission_rate / 100);

  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_hlt_order_seller_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_seller uuid; v_order_seller uuid;
BEGIN
  SELECT seller_id INTO v_seller FROM hlt_products WHERE id = NEW.product_id;
  SELECT seller_id INTO v_order_seller FROM hlt_orders WHERE id = NEW.order_id;

  IF v_seller IS NULL THEN
    RAISE EXCEPTION 'HLTO: 판매자가 정해지지 않은 상품입니다';
  END IF;
  IF v_order_seller IS NOT NULL AND v_order_seller <> v_seller THEN
    RAISE EXCEPTION
      'HLTO: 한 주문에 여러 판매자를 담을 수 없습니다 — 판매자별로 나눠 주문하십시오';
  END IF;

  /* 주문에 판매자가 비어 있으면 첫 품목의 판매자로 채웁니다. */
  IF v_order_seller IS NULL THEN
    UPDATE hlt_orders SET seller_id = v_seller WHERE id = NEW.order_id;
  END IF;

  /* 주문 시점 요율을 박습니다. */
  IF NEW.commission_rate IS NULL THEN
    SELECT coalesce(
             (SELECT s.commission_rate FROM hlt_sellers s WHERE s.id = v_seller),
             (SELECT r.rate FROM hlt_commission_rates r
               JOIN hlt_products p ON p.id = NEW.product_id
               JOIN categories c ON c.id = p.category_id
              WHERE r.category_code = c.code),
             10.00)
      INTO NEW.commission_rate;
  END IF;
  NEW.commission_amount := round(NEW.amount * NEW.commission_rate / 100);

  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_hlt_pay_apply() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.state = 'PAID' AND coalesce(OLD.state,'') <> 'PAID' THEN
    UPDATE hlt_orders
       SET status = 'PAID', paid_at = coalesce(NEW.approved_at, now()),
           pay_method = NEW.method
     WHERE id = NEW.order_id;
  END IF;
  IF NEW.state = 'CANCELED' THEN
    UPDATE hlt_orders SET status = 'CANCELED' WHERE id = NEW.order_id;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_hlt_product_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE c record; r record;
BEGIN
  IF NEW.status NOT IN ('ON_SALE','SOLD_OUT') THEN RETURN NEW; END IF;
  IF NEW.category_id IS NULL THEN
    RAISE EXCEPTION 'HLTP: 업종을 정해야 판매할 수 있습니다';
  END IF;
  SELECT * INTO c FROM categories WHERE id = NEW.category_id;
  IF c.gwan_code <> 'HLT' THEN
    RAISE EXCEPTION 'HLTP: 건강상품관 업종이 아닙니다 — 직판은 건강몰만입니다';
  END IF;
  SELECT * INTO r FROM restricted_industries
   WHERE code = c.restricted_code AND gwan_code = 'HLT' AND is_active;
  IF r.id IS NOT NULL THEN
    IF r.mode IN ('BLOCK','AD_ONLY') THEN RAISE EXCEPTION 'HLTP: %', r.block_message; END IF;
    IF r.mode = 'GATED' AND coalesce(btrim(NEW.review_no),'') = '' THEN
      RAISE EXCEPTION 'HLTP: 심의필 번호가 있어야 판매할 수 있습니다 (의료기기법 24조)';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_hlt_rate_changed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_TABLE_NAME = 'hlt_commission_rates' THEN
    IF TG_OP = 'UPDATE' AND OLD.rate IS NOT DISTINCT FROM NEW.rate THEN RETURN NEW; END IF;
    INSERT INTO hlt_commission_changes (scope, target, before_rate, after_rate, changed_by)
    VALUES ('CATEGORY', NEW.category_code,
            CASE WHEN TG_OP='UPDATE' THEN OLD.rate END, NEW.rate, NEW.updated_by);
  ELSE
    IF TG_OP = 'UPDATE'
       AND OLD.commission_rate IS NOT DISTINCT FROM NEW.commission_rate THEN RETURN NEW; END IF;
    IF NEW.commission_rate IS NULL THEN RETURN NEW; END IF;
    INSERT INTO hlt_commission_changes (scope, target, before_rate, after_rate)
    VALUES ('SELLER', NEW.code,
            CASE WHEN TG_OP='UPDATE' THEN OLD.commission_rate END, NEW.commission_rate);
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_hlt_rate_log() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.rate IS NOT DISTINCT FROM NEW.rate THEN RETURN NEW; END IF;
  INSERT INTO hlt_commission_changes (scope, target, before_rate, after_rate, changed_by)
  VALUES (CASE WHEN NEW.category_code = '*' THEN 'DEFAULT' ELSE 'CATEGORY' END,
          NEW.category_code,
          CASE WHEN TG_OP = 'UPDATE' THEN OLD.rate ELSE NULL END,
          NEW.rate, NEW.updated_by);
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_hlt_rate_log_ro() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'HLTC: 수수료율 변경 이력은 고치거나 지울 수 없습니다';
END $$;

CREATE FUNCTION public.fn_hlt_return_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE o record; d int;
BEGIN
  IF NEW.state = 'REJECTED' AND coalesce(btrim(NEW.decide_note),'') = '' THEN
    RAISE EXCEPTION
      'HLTR: 거절하시려면 이유를 적어야 합니다 — 청약철회는 법이 준 권리라 근거가 필요합니다';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO o FROM hlt_orders WHERE id = NEW.order_id;
    IF o.delivered_at IS NOT NULL THEN
      d := extract(day FROM (now() - o.delivered_at));
      IF d > 7 AND NEW.kind = 'RETURN' THEN
        NEW.detail := coalesce(NEW.detail,'') ||
          E'\n[자동] 배송 완료 후 ' || d || '일 경과 — 청약철회 기간(7일)을 넘었습니다.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_hlt_sale_gate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_mode text; v_msg text;
BEGIN
  IF NEW.gwan_code <> 'HLT' OR NEW.category_id IS NULL THEN RETURN NEW; END IF;

  SELECT r.mode, r.block_message INTO v_mode, v_msg
    FROM categories c
    JOIN restricted_industries r
      ON r.code = c.restricted_code AND r.gwan_code = 'HLT' AND r.is_active
   WHERE c.id = NEW.category_id;

  /* GATED 는 통과시킵니다 — 자격 확인은 trg_gated_category 가 합니다.
     BLOCK 과 AD_ONLY 만 막습니다. */
  IF v_mode IN ('BLOCK', 'AD_ONLY') THEN
    RAISE EXCEPTION 'HEALTH: %', coalesce(v_msg,
      '건강몰에서 판매할 수 없는 품목입니다');
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_hlt_settle_flow() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP <> 'UPDATE' OR OLD.status = NEW.status THEN RETURN NEW; END IF;

  /* ★ 확인을 건너뛰고 지급할 수 없습니다.
   *   정산서는 판매자가 보고 이의를 낼 시간이 있어야 합니다. */
  IF NEW.status = 'PAID' AND OLD.status <> 'CONFIRMED' THEN
    RAISE EXCEPTION
      'HLTS: 확인(CONFIRMED)을 거치지 않고 지급할 수 없습니다 — 지금 %', OLD.status;
  END IF;

  /* 지급한 것은 되돌릴 수 없습니다 — 이미 나간 돈입니다. */
  IF OLD.status = 'PAID' THEN
    RAISE EXCEPTION 'HLTS: 지급된 정산은 되돌릴 수 없습니다 — 다음 회차에서 조정하십시오';
  END IF;

  /* 이월한 것도 되돌리지 않습니다 — 다음 주 정산이 이미 그 값을 썼습니다. */
  IF OLD.status = 'CARRIED' AND NEW.status <> 'CARRIED' THEN
    RAISE EXCEPTION 'HLTS: 이월된 정산은 되돌릴 수 없습니다';
  END IF;

  /* 확인 시각을 자동으로 남깁니다 — 사람이 남기게 하면 빠뜨립니다. */
  IF NEW.status = 'CONFIRMED' AND NEW.confirmed_at IS NULL THEN
    NEW.confirmed_at := now();
  END IF;
  IF NEW.status = 'PAID' AND NEW.paid_at IS NULL THEN
    NEW.paid_at := now();
  END IF;

  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_hlt_settle_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.net_amount <> NEW.gross_amount - NEW.commission - NEW.refund_amount + NEW.carried_in THEN
    RAISE EXCEPTION
      'HLTS: 정산액이 맞지 않습니다 — 매출 % - 수수료 % - 환불 % + 이월 % ≠ 지급액 %',
      NEW.gross_amount, NEW.commission, NEW.refund_amount, NEW.carried_in, NEW.net_amount;
  END IF;

  /* 음수면 지급하지 않고 다음 주로 넘깁니다 — 계좌에서 빼 올 수 없습니다. */
  IF NEW.net_amount < 0 AND NEW.status = 'PAID' THEN
    RAISE EXCEPTION 'HLTS: 정산액이 음수입니다 — 지급이 아니라 이월해야 합니다';
  END IF;

  /* 지급하려면 보낼 곳이 있어야 합니다. */
  IF NEW.status = 'PAID' AND NOT EXISTS (
    SELECT 1 FROM hlt_sellers s
     WHERE s.id = NEW.seller_id
       AND (s.type = 'DIRECT' OR coalesce(btrim(s.submerchant_id),'') <> '')) THEN
    RAISE EXCEPTION
      'HLTS: 하위가맹점 ID 가 없습니다 — 어디로 보낼지 모릅니다 (PG 계약 뒤 채우십시오)';
  END IF;

  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_hlt_settlement_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.net_amount <> NEW.gross_amount - NEW.commission - NEW.refund_amount + NEW.carried_in THEN
    RAISE EXCEPTION
      'HLTS: 정산 합계가 맞지 않습니다 — 매출 % - 수수료 % - 환불 % + 이월 % ≠ %',
      NEW.gross_amount, NEW.commission, NEW.refund_amount, NEW.carried_in, NEW.net_amount;
  END IF;

  /* 음수면 지급하지 않고 넘깁니다. */
  IF NEW.net_amount < 0 AND NEW.status = 'PAID' THEN
    RAISE EXCEPTION 'HLTS: 정산액이 음수입니다 — 지급할 수 없습니다. 다음 주로 넘기십시오';
  END IF;

  /* 하위가맹점이 없으면 지급이 안 됩니다. */
  IF NEW.status = 'PAID' AND NOT EXISTS (
    SELECT 1 FROM hlt_sellers
     WHERE id = NEW.seller_id
       AND (type = 'DIRECT' OR coalesce(btrim(submerchant_id),'') <> '')
  ) THEN
    RAISE EXCEPTION
      'HLTS: 하위가맹점 ID 가 없습니다 — PG 계약 뒤에 채우셔야 지급됩니다';
  END IF;

  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_hlt_ship_apply() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.state = 'DELIVERED' THEN
    UPDATE hlt_orders
       SET status = 'DELIVERED', delivered_at = NEW.happened_at
     WHERE id = NEW.order_id AND delivered_at IS NULL;
  ELSIF NEW.state IN ('PICKED','IN_TRANSIT') THEN
    UPDATE hlt_orders
       SET status = 'SHIPPED', shipped_at = coalesce(shipped_at, NEW.happened_at)
     WHERE id = NEW.order_id AND status IN ('PAID','PREPARING');
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_hlt_stock_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE p record;
BEGIN
  SELECT * INTO p FROM hlt_products WHERE id = NEW.product_id;
  IF p.status <> 'ON_SALE' THEN
    RAISE EXCEPTION 'HLTO: 판매 중인 상품이 아닙니다 — %', p.name;
  END IF;
  IF p.stock < NEW.qty THEN
    RAISE EXCEPTION 'HLTO: 재고가 부족합니다 — % (남은 수량 %)', p.name, p.stock;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_hold_settlement_on_dispute() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE settlements
     SET status = 'HELD', held_by_dispute_id = NEW.id
   WHERE deal_id = NEW.deal_id
     AND status = 'REQUESTED';
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_hub_no_listing() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM gwans WHERE code = NEW.gwan_code AND is_hub) THEN
    RAISE EXCEPTION
      'GWAN: %는 상위 관이라 직접 등록할 수 없습니다 — 소개머니·소개몰·소개창업 중에서 고르십시오',
      NEW.gwan_code;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_in_quiet_hours() RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT CASE
    WHEN qs IS NULL OR qe IS NULL THEN false
    WHEN qs < qe THEN h >= qs AND h < qe
    ELSE h >= qs OR h < qe      -- 21시~8시처럼 자정을 넘는 경우
  END
  FROM (SELECT
    (SELECT value::int FROM site_settings WHERE key='notify.quiet_start') qs,
    (SELECT value::int FROM site_settings WHERE key='notify.quiet_end')   qe,
    extract(hour from now() at time zone 'Asia/Seoul')::int h) t;
$$;

CREATE FUNCTION public.fn_infeed_label_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_spec jsonb;
BEGIN
  IF NEW.code = 'INFEED' THEN
    v_spec := NEW.spec;
    IF coalesce(v_spec->>'label','') = '' THEN
      RAISE EXCEPTION
        'ADS: 인피드는 "광고" 표기가 필요합니다 — 추천과 섞이면 목록 신뢰가 무너집니다';
    END IF;
    IF NEW.in_ranking THEN
      RAISE EXCEPTION
        'ADS: 인피드를 추천 점수에 넣을 수 없습니다 — 돈으로 순위를 사는 것이 됩니다';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_invite_contact_purge() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.state IN ('SENT','FAILED','SKIPPED') AND OLD.state = 'QUEUED' THEN
    NEW.contact_enc := NULL;
    NEW.purged_at   := now();
    IF NEW.state = 'SENT' THEN NEW.sent_at := coalesce(NEW.sent_at, now()); END IF;
  END IF;
  -- 한 번 지운 연락처를 다시 채울 수 없습니다.
  IF OLD.purged_at IS NOT NULL AND NEW.contact_enc IS NOT NULL THEN
    RAISE EXCEPTION 'PRIVACY: 파기된 연락처를 다시 저장할 수 없습니다';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_invite_delivery_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.channel = 'SELF' AND (NEW.contact_enc IS NOT NULL OR NEW.contact_hash IS NOT NULL) THEN
    RAISE EXCEPTION
      'PRIVACY: 소개자 직접 전달(SELF)에는 연락처를 저장하지 않습니다';
  END IF;
  IF NEW.channel <> 'SELF' AND NEW.state = 'QUEUED' AND NEW.contact_enc IS NULL THEN
    RAISE EXCEPTION 'PRIVACY: 대행 발송에는 연락처가 필요합니다';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_invite_state_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.state = 'CONSENTED' AND NEW.state <> 'CONSENTED' THEN
    RAISE EXCEPTION 'CONSENT: 동의 기록은 되돌릴 수 없습니다';
  END IF;
  IF NEW.state = 'CONSENTED' AND OLD.state <> 'CONSENTED' THEN
    NEW.consented_at := coalesce(NEW.consented_at, now());
  END IF;
  IF NEW.state = 'DECLINED' AND OLD.state <> 'DECLINED' THEN
    NEW.declined_at := now();
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_invoice_no_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'BILLING: 청구 기록은 삭제할 수 없습니다 (매출 근거)';
END $$;

CREATE FUNCTION public.fn_invoice_not_cancelled() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_cancel timestamptz; v_price numeric;
BEGIN
  SELECT s.cancel_at, p.monthly_price INTO v_cancel, v_price
    FROM subscriptions s JOIN subscription_plans p ON p.code = s.plan_code
   WHERE s.id = NEW.subscription_id;

  IF v_cancel IS NOT NULL AND NEW.period_start >= v_cancel THEN
    RAISE EXCEPTION 'BILLING: 해지 예약된 구독은 청구할 수 없습니다';
  END IF;
  IF coalesce(v_price, 0) = 0 AND NEW.amount > 0 THEN
    RAISE EXCEPTION 'BILLING: 무료 요금제에 금액을 청구할 수 없습니다';
  END IF;
  IF NEW.amount < 0 THEN
    RAISE EXCEPTION 'BILLING: 청구액은 음수일 수 없습니다';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_invoice_paid_lock() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.status = 'PAID' THEN
    IF NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.period_start IS DISTINCT FROM OLD.period_start
       OR NEW.period_end   IS DISTINCT FROM OLD.period_end
       OR NEW.subscription_id IS DISTINCT FROM OLD.subscription_id THEN
      RAISE EXCEPTION 'BILLING: 결제 완료된 청구의 금액·기간은 변경할 수 없습니다';
    END IF;
  END IF;
  IF NEW.status = 'PAID' AND OLD.status <> 'PAID' THEN
    NEW.paid_at := coalesce(NEW.paid_at, now());
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_is_intro_blocked(p_code text, p_gwan text) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM restricted_industries r
     WHERE r.is_active
       AND r.code = p_code
       AND (r.gwan_code IS NULL OR r.gwan_code = p_gwan)
       AND r.mode IN ('BLOCK','AD_ONLY')   -- ★ 둘 다 소개는 막습니다
  );
$$;

CREATE FUNCTION public.fn_job_claim(p_job text, p_slot text) RETURNS bigint
    LANGUAGE plpgsql
    AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO job_runs(job, slot) VALUES (p_job, p_slot)
  ON CONFLICT (job, slot) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;   -- NULL 이면 이미 누가 잡았습니다
END $$;

CREATE FUNCTION public.fn_job_run_ro() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'JOB: 실행 기록은 삭제할 수 없습니다';
  END IF;
  IF NEW.job IS DISTINCT FROM OLD.job OR NEW.slot IS DISTINCT FROM OLD.slot
     OR NEW.started_at IS DISTINCT FROM OLD.started_at THEN
    RAISE EXCEPTION 'JOB: 실행 기록의 작업·시각은 변경할 수 없습니다';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_jobs_due(p_now timestamp with time zone DEFAULT now()) RETURNS TABLE(job text, slot text)
    LANGUAGE sql STABLE
    AS $$
  WITH t AS (
    SELECT s.job, s.every_min, s.at_hour, s.at_minute, s.at_dow,
           (p_now AT TIME ZONE 'Asia/Seoul')                          AS local_ts,
           extract(hour from p_now AT TIME ZONE 'Asia/Seoul')::int     AS h,
           extract(minute from p_now AT TIME ZONE 'Asia/Seoul')::int   AS mi,
           extract(dow  from p_now AT TIME ZONE 'Asia/Seoul')::int + 1 AS dow,
           -- 마지막으로 실제 시작한 시각. 없으면 아주 옛날로 봅니다.
           coalesce((SELECT max(r.started_at) FROM job_runs r WHERE r.job = s.job),
                    p_now - interval '100 years')                      AS last_run
      FROM job_schedules s
     WHERE s.is_active
  )
  SELECT t.job,
         CASE WHEN t.at_hour IS NULL
              -- 주기 작업: 슬롯을 주기 단위로 내림해 중복을 막습니다.
              THEN to_char(t.local_ts, 'YYYYMMDD"T"HH24') || ':' ||
                   lpad(((t.mi / t.every_min) * t.every_min)::text, 2, '0')
              -- 시각 작업: 하루 한 번이므로 날짜 + 지정 시각
              ELSE to_char(t.local_ts, 'YYYYMMDD') || 'T' ||
                   lpad(t.at_hour::text, 2, '0') || ':' ||
                   lpad(coalesce(t.at_minute, 0)::text, 2, '0')
         END AS slot
    FROM t
   WHERE CASE
           WHEN t.at_hour IS NOT NULL THEN
             -- 오늘 그 시각이 지났고, 오늘 아직 안 돌았으면 지금 돕니다.
             -- 03:30 작업을 04:10 에 발견해도 실행합니다 —
             -- 놓친 것을 다음 날까지 미루면 파기가 하루 밀립니다.
             (t.h > t.at_hour OR (t.h = t.at_hour AND t.mi >= coalesce(t.at_minute, 0)))
             AND (t.at_dow IS NULL OR t.dow = t.at_dow)
             AND (t.last_run AT TIME ZONE 'Asia/Seoul')::date
                 < (t.local_ts)::date
           ELSE
             -- 마지막 실행 이후 주기가 지났으면 지금 돕니다.
             -- 30초를 빼는 것은 tick 이 조금 일찍 와도 놓치지 않게 하려는 것입니다.
             p_now >= t.last_run + (t.every_min || ' minutes')::interval
                                 - interval '30 seconds'
         END;
$$;

CREATE FUNCTION public.fn_landing_gwan_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_ok boolean;
BEGIN
  IF NEW.key IN ('site.landing_after_login','site.landing_new_member')
     AND coalesce(btrim(NEW.value),'') <> '' THEN
    SELECT is_active INTO v_ok FROM gwans WHERE code = NEW.value;
    IF v_ok IS NULL THEN
      RAISE EXCEPTION 'SETTING: %는 없는 관입니다', NEW.value;
    END IF;
    IF NOT v_ok THEN
      RAISE EXCEPTION
        'SETTING: %는 중지된 관입니다 — 로그인하자마자 "중지 상태" 화면을 보게 됩니다',
        NEW.value;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_last_super_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.role = 'SUPER'
     AND (SELECT count(*) FROM account_roles WHERE role = 'SUPER') <= 1 THEN
    RAISE EXCEPTION
      'PERM: 마지막 SUPER 권한은 회수할 수 없습니다. 다 지우면 복구할 방법이 없습니다';
  END IF;
  RETURN OLD;
END $$;

CREATE FUNCTION public.fn_lead_default_fee_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
BEGIN
  IF NEW.key = 'lead.default_fee' AND NEW.value ~ '^[0-9]+$'
     AND NEW.value::numeric < 2209 THEN
    RAISE EXCEPTION
      'SETTING: 기본 확인비용이 손익분기(2,209원) 아래입니다 — 리드를 만들수록 자금을 태웁니다';
  END IF;
  RETURN NEW;
END $_$;

CREATE FUNCTION public.fn_lead_fee_change_log() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.lead_fee IS DISTINCT FROM OLD.lead_fee THEN
    INSERT INTO lead_fee_changes(category_id, old_fee, new_fee)
    VALUES (NEW.id, OLD.lead_fee, NEW.lead_fee);
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_lead_fee_no_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'FEE: 이용료 기록은 삭제할 수 없습니다 (매출 근거)';
END $$;

CREATE FUNCTION public.fn_lead_fee_requires_view() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_viewed timestamptz;
BEGIN
  SELECT viewed_at INTO v_viewed FROM lead_deliveries WHERE id = NEW.delivery_id;
  IF v_viewed IS NULL THEN
    RAISE EXCEPTION
      'FEE: 열람하지 않은 리드에는 이용료가 발생하지 않습니다';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_lead_fee_void_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  /* 어느 쪽으로 표시하든 규칙이 필요합니다. */
  IF (NEW.voided_at IS NOT NULL OR NEW.state = 'VOIDED')
     AND coalesce(btrim(NEW.void_rule), '') = '' THEN
    RAISE EXCEPTION
      'LEADFEE: 무효 처리에는 규칙이 필요합니다 — 왜 지웠는지가 남아야 따질 수 있습니다';
  END IF;

  /* 둘을 함께 맞춥니다. 따로 두면 "무효인데 PENDING" 이 생기고,
     그런 행은 집계를 조용히 틀리게 만듭니다. */
  IF NEW.voided_at IS NOT NULL AND NEW.state <> 'VOIDED' THEN
    NEW.state := 'VOIDED';
  END IF;
  IF NEW.state = 'VOIDED' AND NEW.voided_at IS NULL THEN
    NEW.voided_at := now();
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_lead_rate(p_gwan text, p_grade text) RETURNS numeric
    LANGUAGE sql STABLE
    AS $$
  SELECT rate FROM lead_grade_rates
   WHERE grade = p_grade AND (gwan_code = p_gwan OR gwan_code IS NULL)
   ORDER BY gwan_code NULLS LAST      -- 관 전용이 먼저
   LIMIT 1;
$$;

CREATE FUNCTION public.fn_listing_gwan_match() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_cat_gwan text;
BEGIN
  IF NEW.category_id IS NOT NULL THEN
    SELECT gwan_code INTO v_cat_gwan FROM categories WHERE id = NEW.category_id;
    IF v_cat_gwan IS NOT NULL AND v_cat_gwan <> NEW.gwan_code THEN
      RAISE EXCEPTION
        'CATEGORY: 업종(%)이 이 관(%)의 것이 아닙니다 — 목록에 다른 관 물건이 섞입니다',
        v_cat_gwan, NEW.gwan_code;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_listing_requires_business() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_need boolean; v_type text; v_verified boolean;
BEGIN
  IF NEW.item_type IS NULL THEN RETURN NEW; END IF;

  SELECT requires_business INTO v_need FROM item_types WHERE code = NEW.item_type;
  IF NOT coalesce(v_need, false) THEN RETURN NEW; END IF;

  -- 리스팅은 계정이 소유합니다. 그 계정이 인증 사업자인지를 봅니다.
  SELECT (a.account_type = 'BUSINESS'
          AND EXISTS (SELECT 1 FROM businesses b
                       WHERE b.account_id = a.id AND b.verified_at IS NOT NULL))
    INTO v_verified
    FROM accounts a
   WHERE a.id = NEW.owner_account_id;

  IF coalesce(v_verified, false) IS NOT TRUE THEN
    SELECT name INTO v_type FROM item_types WHERE code = NEW.item_type;
    RAISE EXCEPTION
      'INV-7: %은(는) 인증 사업자만 등록할 수 있습니다', coalesce(v_type, NEW.item_type);
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_listing_seller_gate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_type text; v_verified timestamptz;
BEGIN
  -- ★ 사람 소개는 개인도 할 수 있습니다.
  IF NEW.item_type = 'PERSON' THEN
    RETURN NEW;
  END IF;

  SELECT account_type INTO v_type FROM accounts WHERE id = NEW.owner_account_id;

  IF v_type IS DISTINCT FROM 'BUSINESS' THEN
    RAISE EXCEPTION
      'SELLER: 상품·서비스 판매 등록은 인증 사업자만 할 수 있습니다. '
      '개인회원은 사람 소개와 소개받기 요청을 이용해 주십시오';
  END IF;

  SELECT verified_at INTO v_verified
    FROM businesses WHERE account_id = NEW.owner_account_id LIMIT 1;
  IF v_verified IS NULL THEN
    RAISE EXCEPTION 'SELLER: 사업자 인증을 마쳐야 판매 등록을 하실 수 있습니다';
  END IF;

  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_lock_fee_on_contract() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE fa record;
BEGIN
  -- 소개비가 꺼져 있으면 소개비 없이 계약서를 냅니다.
  -- 소개비는 당사자끼리 정하는 사항이므로 플랫폼 계약서의 조건이 아닙니다.
  IF NOT fn_feature_on('referral_fee') THEN
    NEW.fee_agreement_id := NULL;
    RETURN NEW;
  END IF;

  SELECT * INTO fa FROM fee_agreements
   WHERE deal_id = NEW.deal_id AND state = 'LOCKED';
  IF fa.id IS NULL THEN
    -- AGREED 상태의 최신 합의를 LOCKED 로 승격
    SELECT * INTO fa FROM fee_agreements
     WHERE deal_id = NEW.deal_id AND state = 'AGREED'
       AND agreed_by_buyer_at IS NOT NULL AND agreed_by_seller_at IS NOT NULL
     ORDER BY version DESC LIMIT 1;
    IF fa.id IS NULL THEN
      RAISE EXCEPTION
        '계약서 발급 불가: 양측이 합의한 소개비 금액이 없습니다 (deal %)', NEW.deal_id;
    END IF;
    INSERT INTO fee_agreements(deal_id, version, proposed_by, amount, state,
                               agreed_by_buyer_at, agreed_by_seller_at, reason_code)
    VALUES (fa.deal_id, fa.version + 1, fa.proposed_by, fa.amount, 'LOCKED',
            fa.agreed_by_buyer_at, fa.agreed_by_seller_at, 'CONTRACT_ISSUE')
    RETURNING * INTO fa;
    UPDATE deals SET agreed_fee = fa.amount, agreed_fee_fixed_at = now()
     WHERE id = NEW.deal_id;
  END IF;
  NEW.fee_agreement_id := fa.id;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_main_copy_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_word text;
BEGIN
  SELECT w.word INTO v_word
    FROM banned_words w
   WHERE w.is_active AND w.severity = 'BLOCK'
     AND position(lower(w.word) in lower(NEW.text)) > 0
   LIMIT 1;
  IF v_word IS NOT NULL THEN
    RAISE EXCEPTION 'MAIN: 문구에 쓸 수 없는 표현이 있습니다 — %', v_word;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_main_section_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.is_locked AND NOT NEW.is_active THEN
    RAISE EXCEPTION
      'MAIN: %는 끌 수 없습니다. 메인 최상단이 곧 서비스의 첫인상입니다', OLD.name;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_match_scores(p_partner uuid, p_lead uuid) RETURNS TABLE(code text, raw numeric)
    LANGUAGE sql STABLE
    AS $$
  WITH l AS (SELECT sido, sigungu, category_id FROM leads WHERE id = p_lead)
  -- 지역: 시군구까지 맞으면 100, 시도만 맞으면 60, 아니면 0
  SELECT 'loc', CASE
      WHEN EXISTS (SELECT 1 FROM partner_regions r, l
                    WHERE r.partner_id = p_partner
                      AND r.sido = l.sido AND r.sigungu = l.sigungu) THEN 100
      WHEN EXISTS (SELECT 1 FROM partner_regions r, l
                    WHERE r.partner_id = p_partner AND r.sido = l.sido) THEN 60
      ELSE 0 END::numeric
  UNION ALL
  -- 업종: 승인된 서비스에 그 업종이 있으면 100
  SELECT 'cat', CASE
      WHEN EXISTS (SELECT 1 FROM partner_services s, l
                    WHERE s.partner_id = p_partner AND s.status = 'APPROVED'
                      AND s.category_id = l.category_id) THEN 100
      ELSE 0 END::numeric
  UNION ALL
  -- 성사 이력: 이용료가 확정된 건수. 20건이면 만점입니다
  SELECT 'win', least(100, coalesce((
      SELECT count(*) * 5 FROM lead_fees f
       WHERE f.partner_id = p_partner AND f.state = 'BILLED'), 0))::numeric
  UNION ALL
  /* 응답 속도: 평균 열람 시간.
     30분 안이면 만점, 6시간 넘으면 0 — 요청자는 그동안 기다립니다.
     기록이 없으면 50 에서 시작합니다(신규를 불리하게 두지 않습니다). */
  SELECT 'spd', coalesce((
      SELECT greatest(0, least(100,
        round(100 - (avg(EXTRACT(epoch FROM (viewed_at - delivered_at)) / 60) - 30)
              * 100.0 / 330)))
        FROM lead_deliveries
       WHERE partner_id = p_partner AND viewed_at IS NOT NULL), 50)::numeric
  UNION ALL
  -- 신뢰지표: 열람률. 받아 놓고 안 열면 요청자가 기다립니다
  SELECT 'trust', coalesce((
      SELECT round(100.0 * count(*) FILTER (WHERE viewed_at IS NOT NULL)
             / nullif(count(*), 0))
        FROM lead_deliveries WHERE partner_id = p_partner), 50)::numeric;
$$;

CREATE FUNCTION public.fn_match_candidates(p_lead uuid, p_limit integer DEFAULT 10) RETURNS TABLE(partner_id uuid, company text, total numeric, parts jsonb)
    LANGUAGE sql STABLE
    AS $$
  SELECT p.id, b.company_name,
         round(sum(s.raw * w.weight / 100.0), 1),
         jsonb_object_agg(s.code, jsonb_build_object(
           'raw', s.raw, 'weight', w.weight,
           'points', round(s.raw * w.weight / 100.0, 1)))
    FROM partners p
    JOIN businesses b ON b.id = p.business_id
    CROSS JOIN LATERAL fn_match_scores(p.id, p_lead) s
    JOIN recommend_weights w ON w.code = s.code
   WHERE p.status = 'ACTIVE'
     -- 미납 한도를 넘으면 새 리드를 받지 않습니다
     AND coalesce((SELECT sum(amount) FROM lead_fees f
                    WHERE f.partner_id = p.id AND f.state = 'PENDING'), 0)
         < p.unpaid_cap
   GROUP BY p.id, b.company_name
   HAVING sum(s.raw * w.weight / 100.0) > 0
   ORDER BY 3 DESC
   LIMIT p_limit;
$$;

CREATE FUNCTION public.fn_may_hold_funds(p_gwan text) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT coalesce((SELECT sale_mode = 'DIRECT' FROM gwans WHERE code = p_gwan), false);
$$;

CREATE FUNCTION public.fn_next_ad_invoice_no() RETURNS text
    LANGUAGE sql
    AS $$
  SELECT 'AD-' || to_char(now(), 'YYYYMM') || '-' ||
         lpad(nextval('ad_invoice_seq')::text, 4, '0');
$$;

CREATE FUNCTION public.fn_next_hlt_order_no() RETURNS text
    LANGUAGE sql
    AS $$
  SELECT 'H' || to_char(now(), 'YYMMDD') || lpad(nextval('hlt_order_seq')::text, 5, '0');
$$;

CREATE FUNCTION public.fn_owner_verify_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.state = 'VERIFIED' AND coalesce(OLD.state,'') <> 'VERIFIED' THEN
    IF NEW.doc_key IS NULL OR NEW.issued_on IS NULL THEN
      RAISE EXCEPTION 'OWNER: 등기부등본 없이 승인할 수 없습니다';
    END IF;
    IF NEW.issued_on < current_date - 30 THEN
      RAISE EXCEPTION
        'OWNER: 발급일이 30일을 넘은 등기부입니다 (%). 그 사이 소유권이 이전됐을 수 있습니다',
        NEW.issued_on;
    END IF;
    IF NEW.decided_by IS NULL THEN
      -- 자동 승인 경로가 없습니다. 반드시 사람이 봅니다.
      RAISE EXCEPTION 'OWNER: 자동 승인 경로가 없습니다. 운영 확인자가 필요합니다';
    END IF;
    NEW.decided_at := now();
  END IF;

  IF NEW.state = 'REJECTED' AND coalesce(btrim(NEW.reject_reason),'') = '' THEN
    RAISE EXCEPTION 'OWNER: 반려에는 사유가 필요합니다';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_owner_verify_ro() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'OWNER: 소유자 확인 기록은 삭제할 수 없습니다';
END $$;

CREATE FUNCTION public.fn_partner_approve_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.status = 'ACTIVE'
     AND (NEW.approved_by IS NULL OR NEW.approved_at IS NULL) THEN
    RAISE EXCEPTION
      'PARTNER: 승인자와 승인 시각이 필요합니다 — 누가 들여보냈는지 남아야 합니다';
  END IF;

  IF NEW.status = 'SUSPENDED'
     AND coalesce(btrim(NEW.suspended_reason), '') = '' THEN
    RAISE EXCEPTION 'PARTNER: 정지에는 사유가 필요합니다';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_partner_requires_verified() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_ok boolean;
BEGIN
  SELECT (verified_at IS NOT NULL) INTO v_ok FROM businesses WHERE id = NEW.business_id;
  IF NEW.status = 'ACTIVE' AND NOT coalesce(v_ok, false) THEN
    RAISE EXCEPTION 'PERM: 인증된 사업자만 파트너로 활동할 수 있습니다';
  END IF;
  IF NEW.status = 'SUSPENDED' AND coalesce(btrim(NEW.suspended_reason),'') = '' THEN
    RAISE EXCEPTION 'AUDIT: 파트너 정지에는 사유가 필요합니다';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_partner_service_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.status = 'REJECTED'
     AND coalesce(btrim(NEW.reject_reason), '') = '' THEN
    RAISE EXCEPTION
      'SERVICE: 반려에는 사유가 필요합니다 — 무엇을 고쳐야 하는지 알아야 다시 올립니다';
  END IF;

  /* 승인으로 되돌릴 때는 반려 사유를 지웁니다.
     남아 있으면 화면에 "승인됨 · 반려사유 …" 가 같이 보입니다. */
  IF NEW.status = 'APPROVED' AND OLD.status = 'REJECTED' THEN
    NEW.reject_reason := NULL;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_payout_add(p_account uuid, p_bank_code text, p_bank_name text, p_account_no text, p_holder text, p_code text, p_stub boolean) RETURNS uuid
    LANGUAGE plpgsql
    AS $_$
DECLARE k text; v_id uuid;
BEGIN
  IF p_bank_code !~ '^[0-9]{3}$' THEN
    RAISE EXCEPTION 'PAYOUT: 은행 코드는 숫자 세 자리입니다 — 예) 004 국민은행';
  END IF;
  IF p_account_no !~ '^[0-9-]{9,20}$' THEN
    RAISE EXCEPTION 'PAYOUT: 계좌번호를 다시 확인해 주십시오 — 숫자와 하이픈만 9~20자입니다';
  END IF;

  k := current_setting('app.pii_key', true);
  IF coalesce(k,'') = '' THEN k := 'sgb-dev-pii-key'; END IF;

  INSERT INTO payout_accounts
    (account_id, bank_name, holder_name, account_enc, bank_enc, account_last4,
     verify_code, verify_sent_at, is_stub)
  VALUES (p_account, p_bank_name, p_holder,
          pgp_sym_encrypt(p_account_no, k), pgp_sym_encrypt(p_bank_code, k),
          right(regexp_replace(p_account_no, '[^0-9]', '', 'g'), 4),
          p_code, now(), coalesce(p_stub, false))
  RETURNING id INTO v_id;
  RETURN v_id;
END $_$;

CREATE FUNCTION public.fn_payout_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.is_default AND NOT NEW.verified THEN
    RAISE EXCEPTION
      'PAYOUT: 인증되지 않은 계좌는 기본으로 둘 수 없습니다 — 1원 인증을 먼저 하십시오';
  END IF;

  /* 계좌를 바꾸면 인증이 풀립니다.
   * 인증만 해 놓고 번호를 바꾸면 확인의 의미가 없습니다. */
  IF TG_OP = 'UPDATE'
     AND OLD.account_enc IS DISTINCT FROM NEW.account_enc
     AND NEW.verified AND OLD.verified THEN
    NEW.verified := false;
    NEW.verified_at := NULL;
    NEW.is_default := false;
    NEW.verify_tries := 0;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_payout_reveal(p_id uuid, p_reason text) RETURNS TABLE(bank_code text, account_no text)
    LANGUAGE plpgsql
    AS $$
DECLARE k text; r record;
BEGIN
  IF coalesce(btrim(p_reason),'') = '' THEN
    RAISE EXCEPTION 'PAYOUT: 계좌를 꺼내시려면 사유를 적어야 합니다';
  END IF;
  k := current_setting('app.pii_key', true);
  IF coalesce(k,'') = '' THEN k := 'sgb-dev-pii-key'; END IF;

  SELECT * INTO r FROM payout_accounts WHERE id = p_id;
  IF r IS NULL THEN RAISE EXCEPTION 'PAYOUT: 없는 계좌입니다'; END IF;
  IF NOT r.verified THEN
    RAISE EXCEPTION 'PAYOUT: 인증되지 않은 계좌입니다 — 지급할 수 없습니다';
  END IF;

  INSERT INTO audit.pii_access_logs
    (actor_account_id, target_account_id, field, reason, occurred_at)
  VALUES (current_setting('app.actor_id', true)::uuid, r.account_id,
          'payout_account', p_reason, now());

  RETURN QUERY SELECT
    pgp_sym_decrypt(r.bank_enc, k)::text,
    pgp_sym_decrypt(r.account_enc, k)::text;
END $$;

CREATE FUNCTION public.fn_persona_registered_keep() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.registered_at := coalesce(NEW.registered_at, now());
  ELSE
    NEW.registered_at := coalesce(OLD.registered_at, NEW.registered_at, now());
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_point_ledger_ro() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'POINT: 포인트 기록은 삭제할 수 없습니다';
  END IF;
  IF NEW.points IS DISTINCT FROM OLD.points
     OR NEW.account_id IS DISTINCT FROM OLD.account_id
     OR NEW.rule_code  IS DISTINCT FROM OLD.rule_code THEN
    RAISE EXCEPTION 'POINT: 포인트 기록의 금액·대상은 변경할 수 없습니다';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_point_redeemable_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_needs boolean; v_valid boolean;
BEGIN
  SELECT needs_valid INTO v_needs FROM point_rules WHERE code = NEW.rule_code;
  IF NEW.redeemable AND coalesce(v_needs, true) THEN
    SELECT is_valid INTO v_valid FROM introduction_connections WHERE id = NEW.connection_id;
    IF coalesce(v_valid, false) IS NOT TRUE THEN
      RAISE EXCEPTION
        'POINT: 유효 연결이 확인되기 전에는 현금화할 수 없습니다';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_profile_consent_gate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.consented_at IS NULL THEN
    RAISE EXCEPTION 'PRIVACY: 성향 저장에는 동의가 필요합니다';
  END IF;
  IF NEW.consented_at > now() THEN
    RAISE EXCEPTION 'PRIVACY: 동의 시각이 미래일 수 없습니다';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_property_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_ok boolean; v_acc uuid;
BEGIN
  IF NEW.verified_at IS NOT NULL AND OLD.verified_at IS NULL THEN
    IF coalesce(btrim(NEW.broker_reg_no), '') = '' THEN
      RAISE EXCEPTION
        'PROP: 개설등록번호 없이 매물을 공개할 수 없습니다 (공인중개사법 제18조의2)';
    END IF;

    -- 그 사업자가 BROKER 자격 심사를 통과했는지 봅니다.
    SELECT b.account_id INTO v_acc
      FROM listings l JOIN businesses b ON b.account_id = l.owner_account_id
     WHERE l.id = NEW.listing_id;

    SELECT EXISTS (
      SELECT 1 FROM qualification_reviews q
       JOIN businesses b2 ON b2.id = q.business_id
      WHERE b2.account_id = v_acc
        AND q.category_code = 'BROKER' AND q.state = 'APPROVED'
    ) INTO v_ok;

    IF NOT coalesce(v_ok, false) THEN
      RAISE EXCEPTION
        'PROP: 중개사 자격 심사를 통과하지 않았습니다. 무등록 중개는 플랫폼도 책임집니다';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_published_terms_no_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.status = 'PUBLISHED' AND OLD.version = '1.0' THEN
    RAISE EXCEPTION
      'TERM: 발행된 약관은 삭제할 수 없습니다 (동의 이력의 근거). 고치려면 새 버전을 만드십시오';
  END IF;
  RETURN OLD;
END $$;

CREATE FUNCTION public.fn_purge_accounts() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE n int;
BEGIN
  UPDATE accounts
     SET email = ('purged+' || id || '@invalid')::citext,
         name = '탈퇴회원',
         phone = NULL,
         password_hash = '',
         purged_at = now()
   WHERE withdrawn_at IS NOT NULL
     AND purged_at IS NULL
     AND retention_until <= current_date;
  GET DIAGNOSTICS n = ROW_COUNT;

  UPDATE identity_verifications iv SET ci_hash = NULL
    FROM accounts a
   WHERE a.id = iv.account_id AND a.purged_at IS NOT NULL AND iv.ci_hash IS NOT NULL;

  -- 계좌 파기 단계는 제거했습니다(INV-11). 보관하는 계좌가 없습니다.
  RETURN n;
END $$;

CREATE FUNCTION public.fn_purge_classify_logs() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE n int;
BEGIN
  DELETE FROM classify_logs WHERE created_at < now() - interval '90 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE FUNCTION public.fn_purge_old_ip() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE n int;
BEGIN
  -- 감사 로그의 IP 는 1년 후 마스킹. 행위 기록은 남기되 위치는 지웁니다
  UPDATE audit.audit_logs SET ip = NULL, user_agent = NULL
   WHERE occurred_at < now() - interval '1 year' AND ip IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;

  -- 귀속 로그의 IP 해시는 만료 후 제거
  UPDATE attribution_events SET ip_hash = NULL
   WHERE expires_at < now() - interval '90 days' AND ip_hash IS NOT NULL;

  RETURN n;
END $$;

CREATE FUNCTION public.fn_qualification_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_basis text;
BEGIN
  IF NEW.state = 'APPROVED' THEN
    SELECT legal_basis INTO v_basis FROM qualification_rules
     WHERE category_code = NEW.category_code;
    IF v_basis LIKE '%불가%' THEN
      RAISE EXCEPTION 'QUAL: %는 등록할 수 없는 분야입니다 (%)', NEW.category_code, v_basis;
    END IF;

    -- 발급처 조회 없이 승인할 수 없습니다.
    -- 서류만 받고 통과시키면 위조된 자격증이 그대로 들어옵니다.
    IF NOT NEW.lookup_done THEN
      RAISE EXCEPTION 'QUAL: 발급처 조회를 마쳐야 승인할 수 있습니다';
    END IF;
    NEW.decided_at := now();
  END IF;

  IF NEW.state = 'REJECTED' AND coalesce(btrim(NEW.reject_reason), '') = '' THEN
    RAISE EXCEPTION 'QUAL: 반려에는 사유가 필요합니다';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_qualification_ro() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'QUAL: 자격 심사 기록은 삭제할 수 없습니다 (면책 근거)';
END $$;

CREATE FUNCTION public.fn_redact_audit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.after_data IS NOT NULL THEN
    NEW.after_data := NEW.after_data
      - 'email' - 'phone' - 'name' - 'password' - 'ciHash' - 'ci_hash'
      - 'accountNo' - 'account_no' - 'holderName' - 'accessToken' - 'refreshToken'
      - 'bizRegNo' - 'address';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_referral_no_chain() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_cnt int;
BEGIN
  -- 순환 초대 차단: 내가 초대한 사람이 나를 초대할 수 없습니다.
  SELECT count(*) INTO v_cnt FROM introducer_referrals
   WHERE inviter_id = NEW.invitee_id AND invitee_id = NEW.inviter_id;
  IF v_cnt > 0 THEN
    RAISE EXCEPTION 'INV-1: 서로 초대하는 관계는 만들 수 없습니다';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_refund_eligible(p_sub uuid) RETURNS TABLE(eligible boolean, reason text)
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE s record; v_views int;
BEGIN
  SELECT * INTO s FROM subscriptions WHERE id = p_sub;
  IF s IS NULL THEN
    RETURN QUERY SELECT false, '없는 구독입니다'; RETURN;
  END IF;
  IF s.refunded_at IS NOT NULL THEN
    RETURN QUERY SELECT false, '이미 환불된 구독입니다'; RETURN;
  END IF;

  /* ① 결제 당일인가 */
  IF s.current_period_start::date <> current_date THEN
    RETURN QUERY SELECT false,
      '환불은 결제 당일에만 가능합니다 (결제일 ' ||
      to_char(s.current_period_start, 'YYYY-MM-DD') || ')';
    RETURN;
  END IF;

  /* ② 당일이어도 **쓰셨으면** 안 됩니다.
     리드를 열람하면 상대의 연락처가 이미 열립니다 — 되돌릴 수 없습니다. */
  v_views := coalesce(s.request_views_used, 0) + coalesce(s.codes_used_this_period, 0);
  IF v_views > 0 THEN
    RETURN QUERY SELECT false,
      '이미 이용하신 구독은 환불할 수 없습니다 (열람 ' || v_views || '건)';
    RETURN;
  END IF;

  RETURN QUERY SELECT true, '환불 가능합니다'::text;
END $$;

CREATE FUNCTION public.fn_refund_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_ok boolean; v_why text;
BEGIN
  IF NEW.refunded_at IS NULL OR OLD.refunded_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.current_period_start::date <> NEW.refunded_at::date THEN
    RAISE EXCEPTION
      'REFUND: 환불은 결제 당일에만 가능합니다 — 결제일 %, 환불일 %',
      NEW.current_period_start::date, NEW.refunded_at::date;
  END IF;

  IF coalesce(NEW.request_views_used,0) + coalesce(NEW.codes_used_this_period,0) > 0 THEN
    RAISE EXCEPTION
      'REFUND: 이미 이용하신 구독은 환불할 수 없습니다 — 열람한 연락처는 되돌릴 수 없습니다';
  END IF;

  IF coalesce(btrim(NEW.refund_reason), '') = '' THEN
    RAISE EXCEPTION 'REFUND: 환불 사유를 적어야 합니다';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_report_escalate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_cnt int; v_at int; v_gwan text; v_owner uuid;
BEGIN
  SELECT auto_queue_at INTO v_at FROM report_reasons WHERE code = NEW.reason_code;
  SELECT count(DISTINCT reporter_id) INTO v_cnt
    FROM reports
   WHERE target_type = NEW.target_type AND target_id = NEW.target_id
     AND reason_code = NEW.reason_code AND state IN ('OPEN','QUEUED');

  IF v_cnt >= coalesce(v_at, 3) THEN
    UPDATE reports SET state = 'QUEUED'
     WHERE target_type = NEW.target_type AND target_id = NEW.target_id
       AND state = 'OPEN';

    IF NEW.target_type = 'LISTING'
       AND NOT EXISTS (SELECT 1 FROM review_items ri
                        WHERE ri.target_id = NEW.target_id AND ri.status = 'QUEUED') THEN
      SELECT gwan_code, owner_account_id INTO v_gwan, v_owner
        FROM listings WHERE id = NEW.target_id;
      IF v_owner IS NOT NULL THEN
        INSERT INTO review_items
          (target_type, target_id, gwan_code, submitted_by, status, decision_mode,
           sla_due_at)
        VALUES ('LISTING', NEW.target_id, coalesce(v_gwan,'MNY'), v_owner,
                'QUEUED', 'MANUAL', now() + interval '24 hours');
      END IF;
    END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE FUNCTION public.fn_report_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_owner uuid;
BEGIN
  IF NEW.target_type = 'LISTING' THEN
    SELECT owner_account_id INTO v_owner FROM listings WHERE id = NEW.target_id;
  ELSIF NEW.target_type = 'REQUEST' THEN
    SELECT owner_account_id INTO v_owner FROM requests WHERE id = NEW.target_id;
  END IF;

  IF v_owner IS NOT NULL AND v_owner = NEW.reporter_id THEN
    RAISE EXCEPTION 'REPORT: 자기 등록은 신고할 수 없습니다';
  END IF;

  IF NEW.state = 'UPHELD' AND coalesce(btrim(NEW.resolution), '') = '' THEN
    RAISE EXCEPTION 'REPORT: 인정할 때는 처리 내용을 적어야 합니다';
  END IF;
  IF NEW.state = 'DISMISSED' AND coalesce(btrim(NEW.resolution), '') = '' THEN
    RAISE EXCEPTION 'REPORT: 기각할 때는 사유를 적어야 합니다 — 신고자가 답을 받아야 합니다';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_report_ro() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'REPORT: 신고 기록은 삭제할 수 없습니다 (제재 근거)';
END $$;

CREATE FUNCTION public.fn_resolve_attribution(p_deal_id uuid) RETURNS bigint
    LANGUAGE plpgsql
    AS $$
DECLARE d record; ev record;
BEGIN
  SELECT * INTO d FROM deals WHERE id = p_deal_id;
  IF d.attributed_event_id IS NOT NULL THEN RETURN d.attributed_event_id; END IF;
  IF d.attributed_code IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO ev FROM attribution_events
   WHERE code = d.attributed_code
     AND (account_id = d.buyer_account_id OR account_id IS NULL)
     AND occurred_at <= d.created_at
     AND d.created_at < expires_at
   ORDER BY occurred_at ASC        -- first-touch (INV-2)
   LIMIT 1;

  IF ev.id IS NULL THEN RETURN NULL; END IF;
  UPDATE deals SET attributed_event_id = ev.id, attributed_at = now()
   WHERE id = p_deal_id;
  RETURN ev.id;
END $$;

CREATE FUNCTION public.fn_review_event_log() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_event text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;

  v_event := CASE
    WHEN TG_OP = 'INSERT'        THEN 'SUBMITTED'
    WHEN NEW.status = 'APPROVED' THEN 'APPROVED'
    WHEN NEW.status = 'REJECTED' THEN 'REJECTED'
    WHEN NEW.status = 'QUEUED'   THEN 'RESUBMITTED'   -- 반려 뒤 다시 올라온 것
    ELSE NULL
  END;

  /* 목록에 없는 상태는 기록하지 않습니다 —
     억지로 넣으면 제약이 깨지고 상태 변경 자체가 막힙니다. */
  IF v_event IS NULL THEN RETURN NULL; END IF;

  INSERT INTO review_events (review_item_id, event, actor_id, reason_code, memo)
  VALUES (
    NEW.id, v_event,
    coalesce(NEW.decision_by, NEW.assignee_id, NEW.submitted_by),
    NEW.reject_reason_code,
    CASE v_event
      WHEN 'SUBMITTED'   THEN '검수 접수'
      WHEN 'APPROVED'    THEN '승인'
      WHEN 'REJECTED'    THEN coalesce('반려 — ' || NEW.reject_memo, '반려')
      WHEN 'RESUBMITTED' THEN '재검수 대기'
    END);
  RETURN NULL;
END $$;

CREATE FUNCTION public.fn_review_event_ro() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'REVIEW: 검수 이력은 수정·삭제할 수 없습니다 (분쟁 근거)';
END $$;

CREATE FUNCTION public.fn_revoke_badge_on_edit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.version IS DISTINCT FROM OLD.version THEN
    UPDATE listing_badges SET status = 'REVOKED'
     WHERE listing_id = NEW.id AND status = 'GRANTED';
    NEW.badge_verified_at := NULL;
    NEW.badge_urgent_until := NULL;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_revoke_codes_on_subscription_end() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.status IN ('CANCELLED','EXPIRED') AND OLD.status NOT IN ('CANCELLED','EXPIRED') THEN
    UPDATE referral_codes
       SET revoked_at = now()
     WHERE subscription_id = NEW.id
       AND revoked_at IS NULL
       -- 이미 거래가 붙은 코드는 살려 둔다 (귀속 기록 보존)
       AND code NOT IN (SELECT attributed_code FROM deals WHERE attributed_code IS NOT NULL);
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_revoke_sessions_on_status() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.status IN ('SUSPENDED','WITHDRAWN')
     AND OLD.status NOT IN ('SUSPENDED','WITHDRAWN') THEN
    -- 발급된 소개코드를 즉시 정지합니다.
    -- 코드가 살아 있으면 정지 회원의 링크로 계속 유입이 잡힙니다.
    UPDATE referral_codes SET revoked_at = now()
     WHERE owner_account_id = NEW.id AND revoked_at IS NULL;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_risk_action_reason() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.action IN ('SUSPEND_ACCOUNT','SUSPEND_LISTING','REJECT')
     AND coalesce(btrim(NEW.memo), '') = '' THEN
    RAISE EXCEPTION 'AUDIT: 제재 조치에는 사유가 필요합니다 (%)', NEW.action;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_risk_action_ro() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT: 조치 기록은 수정·삭제할 수 없습니다';
END $$;

CREATE FUNCTION public.fn_risk_alert_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'AUDIT: 위험 경보 기록은 삭제할 수 없습니다';
  END IF;
  IF NEW.rule_code IS DISTINCT FROM OLD.rule_code
     OR NEW.subject IS DISTINCT FROM OLD.subject
     OR NEW.detail  IS DISTINCT FROM OLD.detail
     OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at THEN
    RAISE EXCEPTION 'AUDIT: 위험 경보의 내용은 변경할 수 없습니다 (처리 상태만 바뀝니다)';
  END IF;
  IF NEW.state IN ('CLOSED','FALSE_POSITIVE') AND OLD.state NOT IN ('CLOSED','FALSE_POSITIVE') THEN
    NEW.closed_at := now();
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_risk_scan() RETURNS TABLE(rule_code text, inserted integer, ok boolean)
    LANGUAGE plpgsql
    AS $_$
DECLARE r record; v_cnt int;
BEGIN
  FOR r IN SELECT code, detect_sql, severity FROM risk_rules
            WHERE is_active AND auto_detect AND coalesce(detect_sql,'') <> ''
            ORDER BY sort_order
  LOOP
    BEGIN
      EXECUTE format($f$
        INSERT INTO risk_alerts(rule_code, severity, subject, detail, reason)
        SELECT %L, %L, s.subject, s.detail, '자동 탐지'
          FROM (%s) s
         WHERE NOT EXISTS (
           SELECT 1 FROM risk_alerts a
            WHERE a.rule_code = %L AND a.subject = s.subject
              AND a.state IN ('OPEN','REVIEWING'))
      $f$, r.code, r.severity, r.detect_sql, r.code);
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      rule_code := r.code; inserted := v_cnt; ok := true;
    EXCEPTION WHEN others THEN
      -- 규칙 하나가 깨져도 나머지는 돌아야 합니다.
      -- 조용히 넘기지 않고 경보로 남깁니다 — 탐지가 멈춘 것을 알아야 합니다.
      INSERT INTO risk_alerts(rule_code, severity, subject, detail, reason)
      SELECT r.code, 'HIGH', 'rule:' || r.code,
             '탐지 질의가 실패했습니다: ' || SQLERRM, '규칙 점검 필요'
       WHERE NOT EXISTS (
         SELECT 1 FROM risk_alerts a
          WHERE a.subject = 'rule:' || r.code AND a.state IN ('OPEN','REVIEWING'));
      rule_code := r.code; inserted := 0; ok := false;
    END;
    RETURN NEXT;
  END LOOP;
END $_$;

CREATE FUNCTION public.fn_role_audit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.role IN ('ADMIN','SUPER','REVIEWER') THEN
    INSERT INTO role_changes(account_id, role, action) VALUES (NEW.account_id, NEW.role, 'GRANT');
  ELSIF TG_OP = 'DELETE' AND OLD.role IN ('ADMIN','SUPER','REVIEWER') THEN
    INSERT INTO role_changes(account_id, role, action) VALUES (OLD.account_id, OLD.role, 'REVOKE');
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;

CREATE FUNCTION public.fn_role_change_ro() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT: 권한 변경 기록은 수정·삭제할 수 없습니다';
END $$;

CREATE FUNCTION public.fn_search_head(p_kw text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT lower(btrim(split_part(btrim(coalesce(p_kw,'')), ' ', 1)));
$$;

CREATE FUNCTION public.fn_search_match(p_title text, p_body text, p_kw text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE
    WHEN coalesce(btrim(p_kw), '') = '' THEN true
    ELSE NOT EXISTS (
      SELECT 1 FROM unnest(string_to_array(btrim(p_kw), ' ')) AS w(t)
       WHERE length(btrim(w.t)) >= 2
         AND position(lower(btrim(w.t)) in lower(coalesce(p_title,'') || ' ' || coalesce(p_body,''))) = 0
    )
  END;
$$;

CREATE FUNCTION public.fn_search_rank(p_title text, p_kw text) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE
    WHEN coalesce(btrim(p_kw), '') = '' THEN 0
    ELSE coalesce(
      nullif(position(lower(split_part(btrim(p_kw), ' ', 1)) in lower(coalesce(p_title,''))), 0),
      9999)
  END;
$$;

CREATE FUNCTION public.fn_set_retention_on_withdraw() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE has_deal boolean;
BEGIN
  IF NEW.withdrawn_at IS NOT NULL AND OLD.withdrawn_at IS NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM deals d
       WHERE NEW.id IN (d.buyer_account_id, d.seller_account_id, d.introducer_account_id)
    ) INTO has_deal;

    NEW.retention_until := CASE
      WHEN has_deal THEN (NEW.withdrawn_at + interval '5 years')::date
      ELSE NEW.withdrawn_at::date
    END;
    NEW.status := 'WITHDRAWN';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE FUNCTION public.fn_setting_int(p_key text, p_default integer) RETURNS integer
    LANGUAGE sql STABLE
    AS $_$
  SELECT coalesce((SELECT value::int FROM site_settings
                    WHERE key = p_key AND value ~ '^[0-9]+$'), p_default);
$_$;

CREATE FUNCTION public.fn_setting_validate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.value_pattern IS NOT NULL
     AND NEW.value IS NOT NULL
     AND NEW.value !~ NEW.value_pattern THEN
    RAISE EXCEPTION
      'SETTING: % 값이 형식에 맞지 않습니다 (허용 %, 예: %)',
      NEW.key, NEW.value_pattern, coalesce(NEW.value_example, '-');
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_settlement_no_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'INV-9R: settlement records cannot be deleted';
END $$;

CREATE FUNCTION public.fn_settlement_paid_actor() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_payer uuid;
BEGIN
  IF NEW.status = 'PAID' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'PAID') THEN
    SELECT d.seller_account_id INTO v_payer FROM deals d WHERE d.id = NEW.deal_id;
    IF NEW.paid_marked_by IS NULL
       OR NEW.paid_marked_by NOT IN (v_payer, NEW.payee_account_id) THEN
      RAISE EXCEPTION 'PERM: only settlement parties can mark payment as received';
    END IF;
    NEW.paid_marked_at := now();
  END IF;

  -- 한 번 찍힌 표시자는 바뀌지 않습니다.
  IF TG_OP = 'UPDATE' AND OLD.paid_marked_by IS NOT NULL
     AND NEW.paid_marked_by IS DISTINCT FROM OLD.paid_marked_by THEN
    RAISE EXCEPTION 'PERM: paid_marked_by is immutable';
  END IF;

  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_success_fee_no_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'BILLING: success fee records cannot be deleted (use status=CANCELLED)';
END $$;

CREATE FUNCTION public.fn_success_fee_waive_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.status = 'WAIVED' AND COALESCE(btrim(NEW.waived_reason), '') = '' THEN
    RAISE EXCEPTION 'BILLING: waiving a success fee requires a reason';
  END IF;
  IF NEW.amount <> OLD.amount THEN
    RAISE EXCEPTION 'BILLING: success fee amount is fixed at charge time';
  END IF;
  IF NEW.status = 'PAID' AND OLD.status <> 'PAID' THEN
    NEW.settled_at := now();
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_term_agree_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM terms
   WHERE code = NEW.term_code AND version = NEW.term_version;
  IF v_status IS DISTINCT FROM 'PUBLISHED' THEN
    RAISE EXCEPTION
      'TERM: 발행되지 않은 약관에는 동의할 수 없습니다 (%)', NEW.term_code;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_term_agree_ro() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'TERM: 동의 기록은 삭제할 수 없습니다 (분쟁의 근거)';
END $$;

CREATE FUNCTION public.fn_terms_scope_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.status = 'PUBLISHED' AND NEW.gwan_code IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM terms t
                WHERE t.code = NEW.code
                  AND t.gwan_code IS NULL
                  AND t.status = 'PUBLISHED') THEN
      RAISE EXCEPTION
        'TERMS: %는 이미 전 관 공통으로 발행돼 있습니다 — '
        '관 전용과 공통이 같이 있으면 어느 것에 동의한 것인지 알 수 없습니다',
        NEW.code;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_trust_score(p_account uuid) RETURNS TABLE(score numeric, sample integer, detail jsonb)
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
  w_base numeric; w_id numeric; w_biz numeric; w_con numeric;
  w_link numeric; w_deal numeric; w_rep numeric;
  v_id boolean; v_biz boolean;
  v_sent int; v_agreed int; v_links int; v_deals int; v_reports int;
  v_score numeric; v_n int; v_damp numeric;
BEGIN
  SELECT weight INTO w_base FROM trust_weights WHERE code='BASE';
  SELECT weight INTO w_id   FROM trust_weights WHERE code='IDENTITY';
  SELECT weight INTO w_biz  FROM trust_weights WHERE code='BUSINESS';
  SELECT weight INTO w_con  FROM trust_weights WHERE code='CONSENT_RATE';
  SELECT weight INTO w_link FROM trust_weights WHERE code='CONNECTION';
  SELECT weight INTO w_deal FROM trust_weights WHERE code='DEAL';
  SELECT weight INTO w_rep  FROM trust_weights WHERE code='REPORT';

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

  SELECT count(*) INTO v_deals FROM deals
   WHERE introducer_account_id = p_account AND status = 'CONFIRMED';

  -- ★ 인정된 신고만 셉니다. 신고만으로 깎으면 경쟁사가 악용합니다.
  SELECT count(*) INTO v_reports FROM reports
   WHERE reporter_id IS DISTINCT FROM p_account
     AND state = 'UPHELD'
     AND target_id IN (SELECT id FROM listings WHERE owner_account_id = p_account);

  v_n := coalesce(v_sent,0) + coalesce(v_links,0) + coalesce(v_deals,0);

  /* 표본이 적으면 행동 점수를 덜 반영합니다.
     3건만으로 높은 점수가 나오면 아무도 그 숫자를 믿지 않습니다. */
  v_damp := least(1.0, v_n::numeric / 10.0);

  v_score := w_base
           + (CASE WHEN v_id  THEN w_id  ELSE 0 END)
           + (CASE WHEN v_biz THEN w_biz ELSE 0 END)
           + v_damp * (
               w_con  * (coalesce(v_agreed,0)::numeric / nullif(v_sent,0))
             + w_link * least(1.0, coalesce(v_links,0)::numeric / 10.0)
             + w_deal * least(1.0, coalesce(v_deals,0)::numeric / 5.0)
             )
           + w_rep * least(1.0, coalesce(v_reports,0)::numeric / 3.0);

  RETURN QUERY SELECT
    greatest(0, least(99, round(coalesce(v_score, w_base), 1))),
    v_n,
    jsonb_build_object(
      'identity', v_id, 'business', v_biz,
      'invitesSent', v_sent, 'invitesConsented', v_agreed,
      'connections', v_links, 'deals', v_deals,
      'reportsUpheld', v_reports, 'damping', round(v_damp, 2));
END $$;

CREATE FUNCTION public.fn_validate_setting_value() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE ph record;
BEGIN
  IF NOT NEW.is_required_for_open OR coalesce(btrim(NEW.value),'') = '' THEN
    RETURN NEW;
  END IF;

  -- 자리표시자가 남아 있으면 거부합니다
  SELECT * INTO ph FROM setting_placeholders p
   WHERE NEW.value ILIKE '%' || p.token || '%' LIMIT 1;
  IF ph.token IS NOT NULL THEN
    RAISE EXCEPTION
      'SETTING_PLACEHOLDER: %에 자리표시자 "%"가 남아 있습니다. 실제 값을 입력하십시오.',
      NEW.key, ph.token;
  END IF;

  IF NEW.value_pattern IS NOT NULL AND NEW.value !~ NEW.value_pattern THEN
    RAISE EXCEPTION
      'SETTING_FORMAT: %의 형식이 올바르지 않습니다. 예: %',
      NEW.key, coalesce(NEW.value_example, NEW.value_pattern);
  END IF;

  IF NEW.min_length IS NOT NULL AND length(btrim(NEW.value)) < NEW.min_length THEN
    RAISE EXCEPTION
      'SETTING_TOO_SHORT: %는 %자 이상이어야 합니다.', NEW.key, NEW.min_length;
  END IF;

  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_verify_invariants() RETURNS TABLE(inv text, violation_count bigint, detail text)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY SELECT 'INV-1'::text, count(*), 'tier <> 1'::text
    FROM deals WHERE tier <> 1;
  RETURN QUERY SELECT 'INV-3'::text, count(*), 'settlement on non-confirmed deal'::text
    FROM settlements s JOIN deals d ON d.id = s.deal_id
   WHERE d.status NOT IN ('CONFIRMED','SETTLED');
  RETURN QUERY SELECT 'INV-4'::text, count(*), 'confirmed without both parties'::text
    FROM deals d WHERE d.status IN ('CONFIRMED','SETTLED')
     AND (SELECT count(*) FROM deal_confirmations c WHERE c.deal_id = d.id) < 2;
  RETURN QUERY SELECT 'INV-9'::text, count(*), 'settlement amount <> agreed_fee'::text
    FROM settlements s JOIN deals d ON d.id = s.deal_id
   WHERE s.amount IS DISTINCT FROM d.agreed_fee;
  RETURN QUERY SELECT 'INV-10'::text, count(*), 'payee business not verified'::text
    FROM settlements s JOIN businesses b ON b.id = s.payee_business_id
   WHERE b.verified_at IS NULL;
  RETURN QUERY SELECT 'D-1'::text, count(*), 'agreed_fee <> LOCKED agreement'::text
    FROM deals d WHERE d.agreed_fee IS NOT NULL
     AND d.agreed_fee IS DISTINCT FROM
         (SELECT amount FROM fee_agreements f WHERE f.deal_id = d.id AND f.state='LOCKED');
  RETURN QUERY SELECT 'INV-2'::text, count(*), 'introducer without snapshot'::text
    FROM deals WHERE status IN ('CONFIRMED','SETTLED')
     AND introducer_account_id IS NOT NULL AND attributed_event_id IS NULL;
END $$;

CREATE FUNCTION public.fn_withdrawal_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.days < 7 THEN
    RAISE EXCEPTION
      'WITHDRAW: 청약철회는 7일 미만으로 줄일 수 없습니다 (전자상거래법 17조) — 약관에 적어도 무효입니다';
  END IF;
  RETURN NEW;
END $$;

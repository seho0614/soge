-- v10.28 (작업 지시서 5절 · 10/9 「진행」 · 10/9 답: 스위치는 연동 뒤 운영자가 켬) — 개인(본인인증 회원)도 소개비를 받음.
--   소개비는 당사자끼리 직접 지급합니다(INV-11) — 회사는 돈을 받아 두지 않고, 정산 줄은 지급 사실을 기록할 뿐입니다.
--   받을 계좌 확인은 **정산을 신청할 때**(10/7 결정) — 개인은 본인 명의 계좌를 1원으로 확인(연동 전에는 간주 모드 · assume.bank)해야 정산 줄이 생깁니다.
--   사업자 수령(INV-10)은 그대로 · 개인 수령(INV-10R)은 본인인증 + 확인된 받을 계좌. 소개자 확인(G-120 · D034)은 그대로.
--   기능 스위치(feature.referral_fee)는 바꾸지 않습니다 — 꺼져 있으면 지금처럼 정산이 생기지 않습니다(INV-9 · 약정 없음).

ALTER TABLE settlements ALTER COLUMN payee_business_id DROP NOT NULL;

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
    /* 사업자로 받는 경우 — 전과 같음: 인증된 사업자 · 받는 사람의 것 */
    SELECT * INTO b FROM businesses WHERE id = NEW.payee_business_id;
    IF b.verified_at IS NULL THEN
      RAISE EXCEPTION 'INV-10 violated: payee business % is not verified', b.id;
    END IF;
    IF b.account_id <> NEW.payee_account_id THEN
      RAISE EXCEPTION 'payee business does not belong to payee account';
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

CREATE OR REPLACE FUNCTION public.fn_confirm_when_both()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE d record; biz record;
BEGIN
  IF (SELECT count(*) FROM deal_confirmations WHERE deal_id = NEW.deal_id) < 2 THEN
    RETURN NEW;
  END IF;

  SELECT * INTO d FROM deals WHERE id = NEW.deal_id FOR UPDATE;
  IF d.status IN ('CONFIRMED','SETTLED','CANCELLED','DISPUTED') THEN RETURN NEW; END IF;

  IF fn_feature_on('referral_fee') AND d.introducer_account_id IS NOT NULL
     AND d.agreed_fee IS NULL THEN
    RETURN NEW;   -- 소개비 약정이 먼저입니다
  END IF;

  UPDATE deals
     SET status = 'CONFIRMED', confirmed_at = now(),
         confirm_mode = CASE WHEN NEW.source = 'AUTO_7D' THEN 'AUTO' ELSE 'BOTH' END
   WHERE id = d.id;

  IF fn_feature_on('referral_fee')
     AND d.introducer_account_id IS NOT NULL AND d.agreed_fee IS NOT NULL THEN
    SELECT * INTO biz FROM businesses
     WHERE account_id = d.introducer_account_id AND verified_at IS NOT NULL LIMIT 1;
    IF biz.id IS NOT NULL THEN
      INSERT INTO settlements(deal_id, payee_account_id, payee_business_id, amount, status)
      VALUES (d.id, d.introducer_account_id, biz.id, d.agreed_fee, 'REQUESTED')
      ON CONFLICT (deal_id) DO NOTHING;
    /* v10.28 (D040) — 사업자가 아닌 본인인증 소개자: 확인된 받을 계좌가 있으면 개인으로 정산 줄을 만듦(없으면 본인이 계좌를 확인한 뒤 신청) */
    ELSIF EXISTS (SELECT 1 FROM accounts a WHERE a.id = d.introducer_account_id AND a.identity_verified_at IS NOT NULL)
      AND EXISTS (SELECT 1 FROM payout_accounts p WHERE p.account_id = d.introducer_account_id AND p.verified) THEN
      INSERT INTO settlements(deal_id, payee_account_id, payee_business_id, amount, status)
      VALUES (d.id, d.introducer_account_id, NULL, d.agreed_fee, 'REQUESTED')
      ON CONFLICT (deal_id) DO NOTHING;
    ELSE
      /* 받을 계좌가 확인되지 않아 정산 줄을 만들지 못함 — 소개자에게 알림(정산 화면에서 계좌 확인 뒤 「소개비 받기」) */
      PERFORM fn_notify(d.introducer_account_id, 'SETTLEMENT_BLOCKED_INDIVIDUAL',
        jsonb_build_object('title', coalesce((SELECT title FROM listings WHERE id = d.listing_id), '소개'),
                           'amount', to_char(d.agreed_fee, 'FM999,999,999,990')),
        '/my/settlement');
    END IF;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_verify_invariants()
 RETURNS TABLE(inv text, violation_count bigint, detail text)
 LANGUAGE plpgsql
AS $function$
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
  /* v10.28 (D040) — 개인 수령: 본인인증 · 확인된 받을 계좌 */
  RETURN QUERY SELECT 'INV-10R'::text, count(*), 'individual payee without identity or verified payout account'::text
    FROM settlements s JOIN accounts a ON a.id = s.payee_account_id
   WHERE s.payee_business_id IS NULL
     AND (a.identity_verified_at IS NULL OR NOT EXISTS (SELECT 1 FROM payout_accounts p WHERE p.account_id = s.payee_account_id AND p.verified));
  RETURN QUERY SELECT 'D-1'::text, count(*), 'agreed_fee <> LOCKED agreement'::text
    FROM deals d WHERE d.agreed_fee IS NOT NULL
     AND d.agreed_fee IS DISTINCT FROM
         (SELECT amount FROM fee_agreements f WHERE f.deal_id = d.id AND f.state='LOCKED');
  RETURN QUERY SELECT 'INV-2'::text, count(*), 'introducer without snapshot'::text
    FROM deals WHERE status IN ('CONFIRMED','SETTLED')
     AND introducer_account_id IS NOT NULL AND attributed_event_id IS NULL;
END $function$;

/* 알림 글 — 「사업자만 수령」 문구를 새 규칙으로(보내는 곳: 위 fn_confirm_when_both) */
UPDATE notification_event_policies SET name = '받을 계좌 확인 필요' WHERE event_code = 'SETTLEMENT_BLOCKED_INDIVIDUAL';
UPDATE notification_templates
   SET title = CASE channel WHEN 'EMAIL' THEN '[소개뱅크] 소개비를 받을 계좌를 확인해 주십시오' ELSE '소개비를 받을 계좌를 확인해 주십시오' END,
       body  = '{title} 거래가 성사되어 소개비 {amount}원을 받으실 수 있습니다. 받을 계좌가 아직 확인되지 않아 정산이 기록되지 않았습니다. '
            || '마이페이지 › 정산에서 본인 명의 계좌를 등록 · 확인한 뒤 「소개비 받기」를 눌러 주십시오(사업자 인증을 하셨다면 사업자로 받습니다). '
            || '소개비는 거래 당사자가 직접 지급합니다.'
            || CASE channel WHEN 'EMAIL' THEN E'\n\n본 메일은 발신 전용입니다.' ELSE '' END
 WHERE code IN ('SETTLEMENT_BLOCKED_INDIVIDUAL_INAPP','SETTLEMENT_BLOCKED_INDIVIDUAL_EMAIL');

/* 안내 글 — 「개인은 소개비를 받을 수 없음」을 새 규칙으로 */
UPDATE ui_messages SET message = '거래 만들기 · 소개비 제시 · 계약서 발급은 사업자 인증 뒤에 됩니다.', basis = 'INV-10 · INV-10R', updated_at = now()
 WHERE code = 'BUSINESS_ONLY';
UPDATE faqs SET answer = '받을 수 있습니다. 본인인증을 하시면 개인으로 받고, 정산을 신청할 때 본인 명의 받을 계좌를 확인합니다. 사업자 인증을 하셨다면 사업자로 받습니다. 소개비는 거래 당사자가 직접 지급합니다.', updated_at = now()
 WHERE id = 'c09d7275-75dd-431d-b6e0-8ed23facbb67';

/* 기능 스위치 설명 — 「현재 off」라는 고정 글이 켠 뒤에도 남지 않게 */
UPDATE site_settings
   SET description = '소개비 기능 스위치(기본 off · 본인인증 · 계좌 확인 연동 뒤 운영자가 켬). 켜면 당사자가 소개비를 약정하고, 성사 때 정산 기록이 생깁니다(사업자 INV-10 · 개인 INV-10R). 소개비는 당사자끼리 직접 지급합니다(INV-11) — 플랫폼은 받거나 보내지 않습니다.'
 WHERE key = 'feature.referral_fee';

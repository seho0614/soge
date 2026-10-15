-- v10.31 (W5 · 10/10 시안 기준 지시) — 리드 이용료: 후불 청구 → **선불 충전 잔액**(시안 SB-PTC-CTR-400 「총 잔액 · 유상 잔액 · 등급 할인 · 자동 청구」)
--
--   ★ 범위 한정(결정 기록 w5_decisions.md): 충전금은 **소개뱅크 자사 서비스(리드 열람 확인비용) 이용료의 선납**으로만 씁니다.
--     다른 가맹점 · 다른 회원에게 쓰거나 보낼 수 없고, 현금으로 바꾸어 주지 않습니다(유상 잔액의 환불만 — 원래 결제 수단 취소).
--     소개비는 여기를 지나지 않습니다(INV-9 · INV-11 그대로 — 결제 어댑터의 orderName 검사도 그대로).
--
--   충전   결제(토스 어댑터 · 키 없으면 스텁) 승인 → CHARGE(유상) + BONUS(등급 할인분 — 보너스 잔액)
--   차감   리드 연락처를 열 때(lead_fees INSERT) — 보너스 먼저, 그다음 유상(시안 cash.note). 모자라면 DB 가 막습니다
--   환급   반려 인정 · 위험감지 무효(lead_fees → VOIDED) — 차감한 그대로 보너스 · 유상에 되돌립니다(RESTORE)
--   환불   유상 잔액만 — 묶음(REFUND_HOLD) → 결제 취소 → 확정(REFUND_PAID) 또는 되돌림(REFUND_RETURN) · 그 충전의 보너스는 회수(BONUS_CLAWBACK)
--
--   원장은 **이중 기입**입니다: 한 거래(lead_cash_entries)의 줄(lead_cash_lines) 합은 0 (차변 +, 대변 −).
--   지갑(lead_cash_wallets)의 잔액은 줄에서만 움직이고(트리거), 0 아래로 내려가지 않습니다(CHECK).
--   원장은 고치거나 지우지 못합니다 — 바로잡기는 반대 기입(ADJUST)으로. 불변식은 v_lead_cash_invariants(0줄이 정상).

-- ---------------------------------------------------------------------
-- 0. 설정
-- ---------------------------------------------------------------------
INSERT INTO public.site_settings(key, value, description, value_pattern, value_example) VALUES
 ('lead.cash.mode', 'PREPAID',
  '리드 이용료 방식 — PREPAID: 선불 충전 잔액에서 차감(10/10 시안 기준). 바꾸지 마십시오(후불 경로는 전환 전 미청구분 정리용으로만 남아 있습니다)',
  '^PREPAID$', 'PREPAID'),
 ('lead.cash.min_charge', '10000', '리드 이용료 1회 충전 최소 금액(원)', '^[0-9]+$', '10000'),
 ('lead.cash.max_charge', '2000000', '리드 이용료 1회 충전 최대 금액(원) — 선불 보관 규모를 묶어 두는 상한(법무 확인 전 잠정)', '^[0-9]+$', '2000000'),
 ('lead.cash.max_balance', '2000000', '파트너 한 곳의 유상 잔액 상한(원) — 이 금액을 넘게 충전할 수 없습니다(법무 확인 전 잠정)', '^[0-9]+$', '2000000')
ON CONFLICT (key) DO NOTHING;

-- 등급 할인(보너스) 비율 — 시안 「등급 할인 20%」. 시안에 값이 하나뿐이라 전 등급 같은 값으로 시작합니다(차등은 운영 결정).
CREATE TABLE public.lead_cash_bonus_rates (
  grade      text PRIMARY KEY CHECK (grade IN ('BRONZE','SILVER','GOLD','PLATINUM')),
  rate       numeric NOT NULL CHECK (rate >= 0 AND rate <= 0.5),
  note       text,
  updated_by uuid REFERENCES public.accounts(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.lead_cash_bonus_rates(grade, rate, note) VALUES
 ('BRONZE', 0.20, '시안 cash.log 「등급 할인 20%」 — 등급별 차등은 운영 결정'),
 ('SILVER', 0.20, '시안 cash.log 「등급 할인 20%」 — 등급별 차등은 운영 결정'),
 ('GOLD', 0.20, '시안 cash.log 「등급 할인 20%」 — 등급별 차등은 운영 결정'),
 ('PLATINUM', 0.20, '시안 cash.log 「등급 할인 20%」 — 등급별 차등은 운영 결정');

-- ---------------------------------------------------------------------
-- 1. 지갑 · 원장
-- ---------------------------------------------------------------------
CREATE TABLE public.lead_cash_wallets (
  partner_id      uuid PRIMARY KEY REFERENCES public.partners(id),
  paid_balance    bigint NOT NULL DEFAULT 0 CHECK (paid_balance >= 0),
  bonus_balance   bigint NOT NULL DEFAULT 0 CHECK (bonus_balance >= 0),
  auto_on         boolean NOT NULL DEFAULT false,
  auto_below      bigint CHECK (auto_below IS NULL OR auto_below > 0),
  auto_amount     bigint CHECK (auto_amount IS NULL OR auto_amount > 0),
  auto_failed_at  timestamptz,
  auto_fail_reason text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_lcw_auto CHECK (NOT auto_on OR (auto_below IS NOT NULL AND auto_amount IS NOT NULL))
);
COMMENT ON TABLE public.lead_cash_wallets IS
  '리드 이용료 선불 잔액(D070). 잔액은 lead_cash_lines 로만 움직입니다 — 직접 UPDATE 로 잔액을 바꾸면 불변식(v_lead_cash_invariants)이 잡습니다';

CREATE TABLE public.lead_cash_entries (
  id          bigserial PRIMARY KEY,
  partner_id  uuid NOT NULL REFERENCES public.partners(id),
  kind        text NOT NULL CHECK (kind IN ('CHARGE','BONUS','USE','RESTORE','REFUND_HOLD','REFUND_PAID',
                                            'REFUND_RETURN','BONUS_CLAWBACK','ADJUST')),
  ref_type    text CHECK (ref_type IN ('CHARGE','LEAD_FEE','REFUND','ADJUST')),
  ref_id      text,
  memo        text,
  created_by  uuid REFERENCES public.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_lce_partner ON public.lead_cash_entries(partner_id, created_at DESC);
/* 같은 근거로 같은 종류를 두 번 기입하지 않습니다 — 재시도 · 두 번 누름이 두 번 충전 · 두 번 환급이 되지 않게 */
CREATE UNIQUE INDEX uq_lce_once ON public.lead_cash_entries(kind, ref_type, ref_id)
  WHERE ref_id IS NOT NULL AND kind <> 'ADJUST';

CREATE TABLE public.lead_cash_lines (
  id        bigserial PRIMARY KEY,
  entry_id  bigint NOT NULL REFERENCES public.lead_cash_entries(id),
  account   text NOT NULL CHECK (account IN ('PARTNER_PAID','PARTNER_BONUS','PG_CLEARING','FEE_REVENUE',
                                             'PROMO_EXPENSE','REFUND_PAYABLE','ADJUSTMENT')),
  amount    bigint NOT NULL CHECK (amount <> 0)      -- 차변 + · 대변 −
);
CREATE INDEX idx_lcl_entry ON public.lead_cash_lines(entry_id);
COMMENT ON COLUMN public.lead_cash_lines.amount IS '차변 + · 대변 −. 파트너 잔액(PARTNER_PAID · PARTNER_BONUS)은 부채라 대변(−)이면 늘고 차변(+)이면 줄어듭니다';

-- 1-1. 고치거나 지우지 못합니다
CREATE FUNCTION public.fn_lead_cash_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'LEADCASH: 원장은 고치거나 지울 수 없습니다 — 바로잡기는 반대 기입(ADJUST)으로 하십시오';
END $$;
CREATE TRIGGER trg_lce_ro BEFORE UPDATE OR DELETE ON public.lead_cash_entries
  FOR EACH ROW EXECUTE FUNCTION public.fn_lead_cash_immutable();
CREATE TRIGGER trg_lcl_ro BEFORE UPDATE OR DELETE ON public.lead_cash_lines
  FOR EACH ROW EXECUTE FUNCTION public.fn_lead_cash_immutable();

-- 1-2. 줄이 들어오면 지갑을 움직입니다(파트너 계정만)
CREATE FUNCTION public.fn_lead_cash_line_apply() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_partner uuid;
BEGIN
  IF NEW.account NOT IN ('PARTNER_PAID','PARTNER_BONUS') THEN RETURN NEW; END IF;
  SELECT partner_id INTO v_partner FROM lead_cash_entries WHERE id = NEW.entry_id;
  INSERT INTO lead_cash_wallets(partner_id) VALUES (v_partner) ON CONFLICT DO NOTHING;
  IF NEW.account = 'PARTNER_PAID' THEN
    UPDATE lead_cash_wallets SET paid_balance = paid_balance - NEW.amount, updated_at = now() WHERE partner_id = v_partner;
  ELSE
    UPDATE lead_cash_wallets SET bonus_balance = bonus_balance - NEW.amount, updated_at = now() WHERE partner_id = v_partner;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_lcl_apply AFTER INSERT ON public.lead_cash_lines
  FOR EACH ROW EXECUTE FUNCTION public.fn_lead_cash_line_apply();

-- 1-3. 한 거래의 줄 합은 0 — 거래가 끝날 때(커밋 직전) 봅니다
CREATE FUNCTION public.fn_lead_cash_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_sum bigint; v_n int;
BEGIN
  SELECT coalesce(sum(amount),0), count(*) INTO v_sum, v_n FROM lead_cash_lines WHERE entry_id = NEW.entry_id;
  IF v_n < 2 OR v_sum <> 0 THEN
    RAISE EXCEPTION 'LEADCASH: 원장 거래 %의 차변 · 대변이 맞지 않습니다(줄 %개 · 합 %)', NEW.entry_id, v_n, v_sum;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trg_lcl_balanced AFTER INSERT ON public.lead_cash_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.fn_lead_cash_balanced();

-- 1-4. 기입 함수 — 지갑을 먼저 잠그고(같은 파트너의 동시 기입을 줄 세움) 거래 하나를 씁니다
CREATE FUNCTION public.fn_lead_cash_post(p_partner uuid, p_kind text, p_lines jsonb,
                                         p_ref_type text, p_ref_id text, p_memo text, p_actor uuid)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_id bigint; v_l jsonb;
BEGIN
  INSERT INTO lead_cash_wallets(partner_id) VALUES (p_partner) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM lead_cash_wallets WHERE partner_id = p_partner FOR UPDATE;
  INSERT INTO lead_cash_entries(partner_id, kind, ref_type, ref_id, memo, created_by)
  VALUES (p_partner, p_kind, p_ref_type, p_ref_id, p_memo, p_actor) RETURNING id INTO v_id;
  FOR v_l IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    IF coalesce((v_l->>'v')::bigint, 0) <> 0 THEN
      INSERT INTO lead_cash_lines(entry_id, account, amount) VALUES (v_id, v_l->>'a', (v_l->>'v')::bigint);
    END IF;
  END LOOP;
  RETURN v_id;
END $$;

-- ---------------------------------------------------------------------
-- 2. 충전
-- ---------------------------------------------------------------------
CREATE TABLE public.lead_cash_charges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id    uuid NOT NULL REFERENCES public.partners(id),
  order_id      text NOT NULL UNIQUE CHECK (order_id ~ '^lc-[A-Za-z0-9_-]{6,60}$'),
  amount        bigint NOT NULL CHECK (amount > 0),
  bonus_rate    numeric NOT NULL DEFAULT 0 CHECK (bonus_rate >= 0 AND bonus_rate <= 0.5),
  bonus_amount  bigint NOT NULL DEFAULT 0 CHECK (bonus_amount >= 0),
  source        text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','AUTO')),
  state         text NOT NULL DEFAULT 'READY' CHECK (state IN ('READY','DONE','FAILED','UNKNOWN')),
  payment_key   text,
  method        text,
  stub          boolean NOT NULL DEFAULT false,
  approved_at   timestamptz,
  fail_reason   text,
  refunded      bigint NOT NULL DEFAULT 0,
  requested_by  uuid REFERENCES public.accounts(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_lcc_refunded CHECK (refunded >= 0 AND refunded <= amount),
  CONSTRAINT ck_lcc_done CHECK (state <> 'DONE' OR (payment_key IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE UNIQUE INDEX uq_lcc_payment_key ON public.lead_cash_charges(payment_key) WHERE payment_key IS NOT NULL;
CREATE INDEX idx_lcc_partner ON public.lead_cash_charges(partner_id, created_at DESC);

/* 승인된 충전을 원장에 올립니다. 이미 올렸으면 그대로 돌려줍니다(재시도 안전). */
CREATE FUNCTION public.fn_lead_cash_charge_done(p_charge uuid, p_payment_key text, p_method text,
                                                p_stub boolean, p_actor uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE c lead_cash_charges%ROWTYPE;
BEGIN
  SELECT * INTO c FROM lead_cash_charges WHERE id = p_charge FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEADCASH: 없는 충전입니다'; END IF;
  IF c.state = 'DONE' THEN RETURN 'ALREADY'; END IF;
  IF c.state NOT IN ('READY','UNKNOWN') THEN
    RAISE EXCEPTION 'LEADCASH: 실패로 끝난 충전입니다 — 새로 충전해 주십시오';
  END IF;
  UPDATE lead_cash_charges SET state = 'DONE', payment_key = p_payment_key, method = p_method,
         stub = coalesce(p_stub, false), approved_at = now(), fail_reason = NULL
   WHERE id = c.id;
  PERFORM fn_lead_cash_post(c.partner_id, 'CHARGE',
    jsonb_build_array(jsonb_build_object('a','PG_CLEARING','v', c.amount),
                      jsonb_build_object('a','PARTNER_PAID','v', -c.amount)),
    'CHARGE', c.id::text, '이용료 충전' || CASE WHEN p_stub THEN ' (시험 결제)' ELSE '' END, p_actor);
  IF c.bonus_amount > 0 THEN
    PERFORM fn_lead_cash_post(c.partner_id, 'BONUS',
      jsonb_build_array(jsonb_build_object('a','PROMO_EXPENSE','v', c.bonus_amount),
                        jsonb_build_object('a','PARTNER_BONUS','v', -c.bonus_amount)),
      'CHARGE', c.id::text, '등급 할인 ' || round(c.bonus_rate * 100)::text || '%', p_actor);
  END IF;
  RETURN 'DONE';
END $$;

-- ---------------------------------------------------------------------
-- 3. 차감 · 환급 — lead_fees 에 붙입니다
-- ---------------------------------------------------------------------
ALTER TABLE public.lead_fees ADD COLUMN settle_mode text NOT NULL DEFAULT 'POSTPAID'
  CHECK (settle_mode IN ('POSTPAID','PREPAID'));
ALTER TABLE public.lead_fees ALTER COLUMN settle_mode SET DEFAULT 'PREPAID';
ALTER TABLE public.lead_fees ADD COLUMN bonus_part bigint CHECK (bonus_part IS NULL OR bonus_part >= 0);
ALTER TABLE public.lead_fees ADD COLUMN paid_part  bigint CHECK (paid_part IS NULL OR paid_part >= 0);
COMMENT ON COLUMN public.lead_fees.settle_mode IS
  'POSTPAID: 10/10 전환 전 후불 청구분(그대로 청구) · PREPAID: 선불 잔액에서 차감(state=BILLED 는 「차감 완료」)';

/* 차감 — 연락처를 여는 순간(lead_fees INSERT) 잔액에서 뺍니다. 보너스 먼저, 그다음 유상.
 * 모자라면 막습니다 — 열람(viewed_at)도 같은 거래라 함께 되돌아갑니다. */
CREATE FUNCTION public.fn_lead_fee_prepaid_use() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE w lead_cash_wallets%ROWTYPE; v_amt bigint; v_b bigint; v_p bigint;
BEGIN
  IF NEW.settle_mode <> 'PREPAID' THEN RETURN NEW; END IF;
  IF NEW.amount <> trunc(NEW.amount) THEN
    RAISE EXCEPTION 'LEADCASH: 이용료는 원 단위여야 합니다(%)', NEW.amount;
  END IF;
  v_amt := NEW.amount::bigint;
  INSERT INTO lead_cash_wallets(partner_id) VALUES (NEW.partner_id) ON CONFLICT DO NOTHING;
  SELECT * INTO w FROM lead_cash_wallets WHERE partner_id = NEW.partner_id FOR UPDATE;
  IF w.paid_balance + w.bonus_balance < v_amt THEN
    RAISE EXCEPTION 'LEADCASH: 리드 이용료 잔액이 부족합니다 — 남은 잔액 %원 · 필요 %원. 충전하신 뒤 다시 여십시오',
      to_char(w.paid_balance + w.bonus_balance, 'FM999,999,999,990'), to_char(v_amt, 'FM999,999,999,990');
  END IF;
  v_b := least(w.bonus_balance, v_amt);
  v_p := v_amt - v_b;
  PERFORM fn_lead_cash_post(NEW.partner_id, 'USE',
    jsonb_build_array(jsonb_build_object('a','PARTNER_BONUS','v', v_b),
                      jsonb_build_object('a','PARTNER_PAID','v', v_p),
                      jsonb_build_object('a','FEE_REVENUE','v', -v_amt)),
    'LEAD_FEE', NEW.id::text, '리드 확인', NULL);
  NEW.bonus_part := v_b; NEW.paid_part := v_p;
  NEW.state := 'BILLED'; NEW.billed_at := now();
  RETURN NEW;
END $$;
/* 이름이 z 로 시작해 다른 BEFORE 트리거(열람 확인 · 무효 규칙) 뒤에 돕니다 */
CREATE TRIGGER trg_lead_fee_zcash BEFORE INSERT ON public.lead_fees
  FOR EACH ROW EXECUTE FUNCTION public.fn_lead_fee_prepaid_use();

/* 환급 — 선불로 차감한 이용료가 무효(반려 인정 · 위험감지)가 되면 뺀 그대로 돌려줍니다 */
CREATE FUNCTION public.fn_lead_fee_prepaid_restore() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.settle_mode = 'PREPAID' AND NEW.state = 'VOIDED' AND OLD.state <> 'VOIDED' THEN
    PERFORM fn_lead_cash_post(NEW.partner_id, 'RESTORE',
      jsonb_build_array(jsonb_build_object('a','FEE_REVENUE','v', coalesce(NEW.bonus_part,0) + coalesce(NEW.paid_part,0)),
                        jsonb_build_object('a','PARTNER_BONUS','v', -coalesce(NEW.bonus_part,0)),
                        jsonb_build_object('a','PARTNER_PAID','v', -coalesce(NEW.paid_part,0))),
      'LEAD_FEE', NEW.id::text, '확인비용 환급 — ' || coalesce(NEW.void_rule, ''), NULL);
  END IF;
  IF NEW.settle_mode = 'PREPAID' AND OLD.state = 'VOIDED' AND NEW.state <> 'VOIDED' THEN
    RAISE EXCEPTION 'LEADCASH: 환급한 이용료를 되살릴 수 없습니다';
  END IF;
  IF NEW.settle_mode <> OLD.settle_mode OR NEW.bonus_part IS DISTINCT FROM OLD.bonus_part
     OR NEW.paid_part IS DISTINCT FROM OLD.paid_part OR (NEW.settle_mode = 'PREPAID' AND NEW.amount <> OLD.amount) THEN
    RAISE EXCEPTION 'LEADCASH: 차감한 이용료의 금액 · 방식은 바꿀 수 없습니다';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_lead_fee_zcash_restore AFTER UPDATE ON public.lead_fees
  FOR EACH ROW EXECUTE FUNCTION public.fn_lead_fee_prepaid_restore();

-- ---------------------------------------------------------------------
-- 4. 환불(유상 잔액만)
-- ---------------------------------------------------------------------
CREATE TABLE public.lead_cash_refunds (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id    uuid NOT NULL REFERENCES public.partners(id),
  amount        bigint NOT NULL CHECK (amount > 0),
  reason        text NOT NULL CHECK (btrim(reason) <> ''),
  state         text NOT NULL DEFAULT 'REQUESTED' CHECK (state IN ('REQUESTED','DONE','PARTIAL','FAILED')),
  refunded      bigint NOT NULL DEFAULT 0 CHECK (refunded >= 0),
  clawback      bigint NOT NULL DEFAULT 0 CHECK (clawback >= 0),
  detail        text,
  requested_by  uuid REFERENCES public.accounts(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  done_at       timestamptz,
  CONSTRAINT ck_lcr_refunded CHECK (refunded <= amount)
);
CREATE INDEX idx_lcr_partner ON public.lead_cash_refunds(partner_id, created_at DESC);
CREATE TABLE public.lead_cash_refund_parts (
  refund_id    uuid NOT NULL REFERENCES public.lead_cash_refunds(id),
  charge_id    uuid NOT NULL REFERENCES public.lead_cash_charges(id),
  amount       bigint NOT NULL CHECK (amount > 0),
  ok           boolean,
  detail       text,
  transaction_key text,
  PRIMARY KEY (refund_id, charge_id)
);

/* 접수 — 유상 잔액을 묶어 둡니다(취소가 도는 동안 그 돈으로 리드를 열 수 없게) */
CREATE FUNCTION public.fn_lead_cash_refund_hold(p_partner uuid, p_amount bigint, p_reason text, p_actor uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE w lead_cash_wallets%ROWTYPE; v_id uuid; v_refundable bigint;
BEGIN
  INSERT INTO lead_cash_wallets(partner_id) VALUES (p_partner) ON CONFLICT DO NOTHING;
  SELECT * INTO w FROM lead_cash_wallets WHERE partner_id = p_partner FOR UPDATE;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'LEADCASH: 환불 금액을 넣어 주십시오'; END IF;
  IF w.paid_balance < p_amount THEN
    RAISE EXCEPTION 'LEADCASH: 환불할 수 있는 유상 잔액은 %원입니다 — 등급 할인(보너스) 잔액은 환불하지 않습니다',
      to_char(w.paid_balance, 'FM999,999,999,990');
  END IF;
  SELECT coalesce(sum(amount - refunded),0) INTO v_refundable FROM lead_cash_charges
   WHERE partner_id = p_partner AND state = 'DONE';
  IF v_refundable < p_amount THEN
    RAISE EXCEPTION 'LEADCASH: 결제 취소로 돌려드릴 수 있는 금액은 %원입니다', to_char(v_refundable, 'FM999,999,999,990');
  END IF;
  IF EXISTS (SELECT 1 FROM lead_cash_refunds WHERE partner_id = p_partner AND state = 'REQUESTED') THEN
    RAISE EXCEPTION 'LEADCASH: 처리 중인 환불이 있습니다 — 끝난 뒤 다시 신청해 주십시오';
  END IF;
  INSERT INTO lead_cash_refunds(partner_id, amount, reason, requested_by)
  VALUES (p_partner, p_amount, btrim(p_reason), p_actor) RETURNING id INTO v_id;
  PERFORM fn_lead_cash_post(p_partner, 'REFUND_HOLD',
    jsonb_build_array(jsonb_build_object('a','PARTNER_PAID','v', p_amount),
                      jsonb_build_object('a','REFUND_PAYABLE','v', -p_amount)),
    'REFUND', v_id::text, '환불 접수', p_actor);
  RETURN v_id;
END $$;

/* 마감 — 결제 취소가 된 만큼 확정, 안 된 만큼 잔액으로 되돌림, 보너스 회수 */
CREATE FUNCTION public.fn_lead_cash_refund_close(p_refund uuid, p_actor uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE r lead_cash_refunds%ROWTYPE; v_ok bigint; v_claw bigint; v_bonus bigint;
BEGIN
  SELECT * INTO r FROM lead_cash_refunds WHERE id = p_refund FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEADCASH: 없는 환불입니다'; END IF;
  IF r.state <> 'REQUESTED' THEN RETURN r.state; END IF;
  SELECT coalesce(sum(p.amount) FILTER (WHERE p.ok), 0),
         coalesce(sum(round(p.amount * c.bonus_rate)) FILTER (WHERE p.ok), 0)::bigint
    INTO v_ok, v_claw
    FROM lead_cash_refund_parts p JOIN lead_cash_charges c ON c.id = p.charge_id
   WHERE p.refund_id = r.id;
  IF v_ok > 0 THEN
    PERFORM fn_lead_cash_post(r.partner_id, 'REFUND_PAID',
      jsonb_build_array(jsonb_build_object('a','REFUND_PAYABLE','v', v_ok),
                        jsonb_build_object('a','PG_CLEARING','v', -v_ok)),
      'REFUND', r.id::text, '환불 — 결제 취소', p_actor);
  END IF;
  IF r.amount - v_ok > 0 THEN
    PERFORM fn_lead_cash_post(r.partner_id, 'REFUND_RETURN',
      jsonb_build_array(jsonb_build_object('a','REFUND_PAYABLE','v', r.amount - v_ok),
                        jsonb_build_object('a','PARTNER_PAID','v', -(r.amount - v_ok))),
      'REFUND', r.id::text, '환불 안 된 금액 — 잔액으로 되돌림', p_actor);
  END IF;
  SELECT bonus_balance INTO v_bonus FROM lead_cash_wallets WHERE partner_id = r.partner_id FOR UPDATE;
  v_claw := least(v_claw, v_bonus);
  IF v_claw > 0 THEN
    PERFORM fn_lead_cash_post(r.partner_id, 'BONUS_CLAWBACK',
      jsonb_build_array(jsonb_build_object('a','PARTNER_BONUS','v', v_claw),
                        jsonb_build_object('a','PROMO_EXPENSE','v', -v_claw)),
      'REFUND', r.id::text, '환불한 충전의 등급 할인 회수', p_actor);
  END IF;
  UPDATE lead_cash_refunds
     SET state = CASE WHEN v_ok = r.amount THEN 'DONE' WHEN v_ok > 0 THEN 'PARTIAL' ELSE 'FAILED' END,
         refunded = v_ok, clawback = v_claw, done_at = now()
   WHERE id = r.id;
  RETURN CASE WHEN v_ok = r.amount THEN 'DONE' WHEN v_ok > 0 THEN 'PARTIAL' ELSE 'FAILED' END;
END $$;

-- ---------------------------------------------------------------------
-- 5. 불변식 — 0줄이 정상입니다
-- ---------------------------------------------------------------------
CREATE VIEW public.v_lead_cash_invariants AS
  /* I1 거래마다 차변 = 대변 */
  SELECT 'I1_UNBALANCED'::text AS code, e.partner_id, e.id::text AS ref,
         '줄 합 ' || coalesce(sum(l.amount),0)::text AS detail
    FROM lead_cash_entries e LEFT JOIN lead_cash_lines l ON l.entry_id = e.id
   GROUP BY e.id, e.partner_id HAVING coalesce(sum(l.amount),0) <> 0 OR count(l.id) < 2
  UNION ALL
  /* I2 · I3 지갑 잔액 = 원장 합 */
  SELECT 'I2_PAID_MISMATCH', w.partner_id, NULL,
         '지갑 ' || w.paid_balance || ' · 원장 ' || coalesce(-x.paid,0)
    FROM lead_cash_wallets w
    LEFT JOIN (SELECT e.partner_id,
                      sum(l.amount) FILTER (WHERE l.account='PARTNER_PAID')  AS paid,
                      sum(l.amount) FILTER (WHERE l.account='PARTNER_BONUS') AS bonus
                 FROM lead_cash_lines l JOIN lead_cash_entries e ON e.id = l.entry_id
                GROUP BY e.partner_id) x ON x.partner_id = w.partner_id
   WHERE w.paid_balance <> coalesce(-x.paid,0)
  UNION ALL
  SELECT 'I3_BONUS_MISMATCH', w.partner_id, NULL,
         '지갑 ' || w.bonus_balance || ' · 원장 ' || coalesce(-x.bonus,0)
    FROM lead_cash_wallets w
    LEFT JOIN (SELECT e.partner_id,
                      sum(l.amount) FILTER (WHERE l.account='PARTNER_BONUS') AS bonus
                 FROM lead_cash_lines l JOIN lead_cash_entries e ON e.id = l.entry_id
                GROUP BY e.partner_id) x ON x.partner_id = w.partner_id
   WHERE w.bonus_balance <> coalesce(-x.bonus,0)
  UNION ALL
  /* I4 승인된 충전 = 원장 충전 금액 */
  SELECT 'I4_CHARGE_NOT_POSTED', c.partner_id, c.id::text, '충전 ' || c.amount || ' · 원장 ' || coalesce(-x.v,0)
    FROM lead_cash_charges c
    LEFT JOIN (SELECT e.ref_id, sum(l.amount) AS v FROM lead_cash_entries e
                 JOIN lead_cash_lines l ON l.entry_id = e.id AND l.account = 'PARTNER_PAID'
                WHERE e.kind = 'CHARGE' GROUP BY e.ref_id) x ON x.ref_id = c.id::text
   WHERE (c.state = 'DONE') <> (x.v IS NOT NULL) OR (c.state = 'DONE' AND -x.v <> c.amount)
  UNION ALL
  /* I5 선불 이용료 = 원장 차감(무효면 환급까지) */
  SELECT 'I5_FEE_NOT_POSTED', f.partner_id, f.id::text,
         '이용료 ' || f.amount || ' · 차감 ' || coalesce(u.v,0) || ' · 환급 ' || coalesce(r.v,0)
    FROM lead_fees f
    LEFT JOIN (SELECT e.ref_id, -sum(l.amount) AS v FROM lead_cash_entries e
                 JOIN lead_cash_lines l ON l.entry_id = e.id AND l.account = 'FEE_REVENUE'
                WHERE e.kind = 'USE' GROUP BY e.ref_id) u ON u.ref_id = f.id::text
    LEFT JOIN (SELECT e.ref_id, sum(l.amount) AS v FROM lead_cash_entries e
                 JOIN lead_cash_lines l ON l.entry_id = e.id AND l.account = 'FEE_REVENUE'
                WHERE e.kind = 'RESTORE' GROUP BY e.ref_id) r ON r.ref_id = f.id::text
   WHERE f.settle_mode = 'PREPAID'
     AND (coalesce(u.v,0) <> f.amount
          OR coalesce(f.bonus_part,0) + coalesce(f.paid_part,0) <> f.amount
          OR (f.state = 'VOIDED') <> (r.v IS NOT NULL)
          OR (r.v IS NOT NULL AND r.v <> f.amount))
  UNION ALL
  /* I6 결제사 정산 계정 = 승인 충전 − 환불 확정 */
  SELECT 'I6_PG_CLEARING', c.partner_id, NULL, '충전−환불 ' || c.net || ' · 원장 ' || coalesce(x.v,0)
    FROM (SELECT partner_id, sum(amount - refunded) AS net FROM lead_cash_charges WHERE state = 'DONE' GROUP BY partner_id) c
    LEFT JOIN (SELECT e.partner_id, sum(l.amount) AS v FROM lead_cash_entries e
                 JOIN lead_cash_lines l ON l.entry_id = e.id AND l.account = 'PG_CLEARING'
                GROUP BY e.partner_id) x ON x.partner_id = c.partner_id
   WHERE c.net <> coalesce(x.v,0)
  UNION ALL
  /* I7 처리 중인 환불만 묶인 돈이 있습니다 */
  SELECT 'I7_REFUND_PAYABLE', r.partner_id, r.id::text, '묶인 금액 ' || coalesce(-x.v,0)
    FROM lead_cash_refunds r
    LEFT JOIN (SELECT e.ref_id, sum(l.amount) AS v FROM lead_cash_entries e
                 JOIN lead_cash_lines l ON l.entry_id = e.id AND l.account = 'REFUND_PAYABLE'
                WHERE e.ref_type = 'REFUND' GROUP BY e.ref_id) x ON x.ref_id = r.id::text
   WHERE (r.state = 'REQUESTED' AND coalesce(-x.v,0) <> r.amount)
      OR (r.state <> 'REQUESTED' AND coalesce(x.v,0) <> 0);
COMMENT ON VIEW public.v_lead_cash_invariants IS '리드 이용료 원장 불변식(D070) — 0줄이어야 정상. 한 줄이라도 나오면 운영 화면에 빨간 경고';

-- ---------------------------------------------------------------------
-- 6. 리드 수신 · 후보 판정 — 미납 한도(후불 잔여분) + 선불 잔액
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_partner_eligible AS
 SELECT p.id AS partner_id,
        p.grade,
        p.unpaid_cap,
        COALESCE(sum(f.amount) FILTER (WHERE f.state = 'PENDING'), 0::numeric) AS unpaid,
        COALESCE(sum(f.amount) FILTER (WHERE f.state = 'PENDING'), 0::numeric) < p.unpaid_cap
          AND coalesce(max(w.paid_balance + w.bonus_balance), 0) > 0 AS can_receive,
        coalesce(max(w.paid_balance + w.bonus_balance), 0)::bigint AS balance
   FROM partners p
     LEFT JOIN lead_fees f ON f.partner_id = p.id
     LEFT JOIN lead_cash_wallets w ON w.partner_id = p.id
  WHERE p.status = 'ACTIVE'
    AND EXISTS (SELECT 1 FROM partner_services s WHERE s.partner_id = p.id AND s.status = 'APPROVED')
    AND EXISTS (SELECT 1 FROM partner_regions r WHERE r.partner_id = p.id)
  GROUP BY p.id, p.grade, p.unpaid_cap;

-- ---------------------------------------------------------------------
-- 7. 후보 판정(fn_lead_candidates) — 「미납 한도」 대신 「선불 잔액 − 열지 않은 배정 몫 ≥ 이 리드 이용료」
--    반환 칸은 그대로입니다(운영 「리드 배정」 화면 · fn_lead_assign 이 같은 이름으로 씁니다).
--    unpaid · unpaid_cap 은 전환 전 후불 미청구분이 남은 파트너만 0 이 아닙니다.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_lead_candidates(p_lead uuid)
 RETURNS TABLE(partner_id uuid, company text, grade text, partner_status text, service_ok boolean, qual_ok boolean, region_ok boolean, cap_ok boolean, already boolean, self_deal boolean, eligible boolean, reasons text[], unpaid numeric, unpaid_cap numeric, reserved numeric, fee numeric, recent_30d integer, last_assigned_at timestamp with time zone, weight numeric, score numeric, axis_ok boolean)
 LANGUAGE sql
 STABLE
AS $function$
  WITH s AS (
    SELECT (SELECT value::numeric FROM site_settings
             WHERE key = 'lead.default_fee' AND value ~ '^[0-9]+$') AS dfee
  ), l AS (
    SELECT l.id, l.category_id, l.sido, l.sigungu, l.requester_account_id,
           coalesce(c.lead_fee, s.dfee, 0) AS fee,
           r.mode AS rmode, coalesce(r.qual_code, r.code) AS qual
      FROM leads l
      JOIN categories c ON c.id = l.category_id
      CROSS JOIN s
      LEFT JOIN restricted_industries r
        ON r.code = c.restricted_code AND r.gwan_code = c.gwan_code AND r.is_active
     WHERE l.id = p_lead
  ), pool AS (
    SELECT DISTINCT ps.partner_id FROM partner_services ps JOIN l ON ps.category_id = l.category_id
    UNION
    SELECT d.partner_id FROM lead_deliveries d WHERE d.lead_id = p_lead
  ), x AS (
    SELECT p.id AS pid, b.company_name AS company, p.grade, p.status AS pstatus,
           EXISTS (SELECT 1 FROM partner_services ps
                    WHERE ps.partner_id = p.id AND ps.category_id = l.category_id
                      AND ps.status = 'APPROVED') AS service_ok,
           (l.rmode IS DISTINCT FROM 'GATED' OR EXISTS (
              SELECT 1 FROM qualification_reviews q
               WHERE q.business_id = p.business_id AND q.category_code = l.qual
                 AND q.state = 'APPROVED')) AS qual_ok,
           EXISTS (SELECT 1 FROM partner_regions g
                    WHERE g.partner_id = p.id AND g.sido = l.sido
                      AND (l.sigungu IS NULL OR g.sigungu = l.sigungu OR g.sigungu IN ('전체','*'))) AS region_ok,
           EXISTS (SELECT 1 FROM lead_deliveries d
                    WHERE d.lead_id = l.id AND d.partner_id = p.id) AS already,
           (l.requester_account_id IS NOT NULL AND b.account_id = l.requester_account_id) AS self_deal,
           coalesce((SELECT sum(f.amount) FROM lead_fees f
                      WHERE f.partner_id = p.id AND f.state = 'PENDING'), 0) AS unpaid,
           p.unpaid_cap,
           /* D070 — 선불 잔액(유상 + 보너스) */
           coalesce((SELECT cw.paid_balance + cw.bonus_balance FROM lead_cash_wallets cw
                      WHERE cw.partner_id = p.id), 0) AS balance,
           /* 아직 열지 않은 배정도 열면 청구됩니다 — 그만큼 한도를 잡아 둡니다 */
           coalesce((SELECT sum(coalesce(c2.lead_fee, s.dfee, 0))
                       FROM lead_deliveries d
                       JOIN leads l2 ON l2.id = d.lead_id
                       LEFT JOIN categories c2 ON c2.id = l2.category_id
                      WHERE d.partner_id = p.id AND d.state = 'DELIVERED'
                        AND d.expires_at IS NOT NULL AND d.expires_at > now()), 0) AS reserved,
           l.fee,
           (SELECT count(*)::int FROM lead_deliveries d
             WHERE d.partner_id = p.id AND d.state <> 'REVOKED'
               AND d.delivered_at > now() - interval '30 days') AS recent_30d,
           (SELECT max(d.delivered_at) FROM lead_deliveries d WHERE d.partner_id = p.id) AS last_at,
           coalesce(w.weight, 1) AS weight,
           EXISTS (SELECT 1 FROM mal_partner_axes ax
                    WHERE ax.business_id = p.business_id AND ax.axis = 'CONSULT'
                      AND ax.state = 'APPROVED') AS axis_ok
      FROM pool
      JOIN partners p   ON p.id = pool.partner_id
      JOIN businesses b ON b.id = p.business_id
      CROSS JOIN l CROSS JOIN s
      LEFT JOIN lead_assign_weights w ON w.grade = p.grade
  )
  SELECT x.pid, x.company, x.grade, x.pstatus,
         x.service_ok, x.qual_ok, x.region_ok,
         (x.unpaid < x.unpaid_cap AND x.balance - x.reserved >= x.fee) AS cap_ok,
         x.already, x.self_deal,
         (x.pstatus = 'ACTIVE' AND x.axis_ok AND x.service_ok AND x.qual_ok AND x.region_ok
          AND x.unpaid < x.unpaid_cap AND x.balance - x.reserved >= x.fee
          AND NOT x.already AND NOT x.self_deal) AS eligible,
         array_remove(ARRAY[
           CASE WHEN x.pstatus <> 'ACTIVE' THEN '활동 중 아님(' || x.pstatus || ')' END,
           CASE WHEN NOT x.axis_ok    THEN '상담 축 입점 승인 없음' END,
           CASE WHEN NOT x.service_ok THEN '이 업종의 승인된 서비스 없음' END,
           CASE WHEN NOT x.qual_ok    THEN '자격 심사 미통과' END,
           CASE WHEN NOT x.region_ok  THEN '활동 지역 밖' END,
           CASE WHEN x.unpaid >= x.unpaid_cap THEN '이전 후불 미납 한도 초과' END,
           CASE WHEN x.balance - x.reserved < x.fee THEN '리드 이용료 잔액 부족' END,
           CASE WHEN x.already        THEN '이미 배정함' END,
           CASE WHEN x.self_deal      THEN '신청자 본인 업체' END], NULL) AS reasons,
         x.unpaid, x.unpaid_cap, x.reserved, x.fee,
         x.recent_30d, x.last_at, x.weight,
         round(x.recent_30d / x.weight, 4) AS score,
         x.axis_ok
    FROM x
   ORDER BY 11 DESC, 20 ASC, 18 ASC NULLS FIRST, 1
$function$;

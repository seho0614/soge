-- =====================================================================
-- D190 — 포인트 출금(현금 지급) (v10.219 · 2026-11-09)
--
--   대표 「포인트 현금 가능」(11/9) → 대상 「현금화 가능 포인트 모두」 · 최소 출금 10,000원 · 원천징수는 운영 화면에서 비율(SUPER · 처음 값 3.3% — 대표 11/9) ·
--   운영 반영은 v10.216 → v10.219 한 번에(11/9 「승인」).
--
--   ① 추천 보상(REFERRAL_DIRECT)을 현금화 가능으로 — 가입한 분의 본인인증이 곧 확인이라 유효 연결(needs_valid)을 묻지 않음.
--      point_ledger 는 고칠 수 없는 표라 이미 쌓인 줄은 그대로(운영은 보상이 꺼져 있어 줄 없음) · 새 줄부터 redeemable true.
--   ② 설정 point.cashout_min(10000) · point.cashout_tax_rate(3.3 · 대표 11/9 「원천징수율 3.3」 · 비우면 출금 신청 막힘 · 바꾸기 SUPER).
--   ③ point_cashouts — 회원 출금 신청. 회사가 자기 돈(마케팅비)으로 보내는 것이라 소개비가 아님 →
--      원천징수 칸은 제휴(partner_) · 퍼블리셔(adx_) 정산과 같은 까닭으로 INV-9 예외(fn_is_fee_exempt).
--      계좌번호는 두지 않음(INV-11) — payout_accounts 를 가리키고 은행 이름 · 뒤 4자리 · 예금주만 신청 때 값으로 남김.
--   ④ DB 가 막는 것 — 잔액보다 많이 · 최소 미만 · 처리 중인 신청이 있는데 또 · 확인 안 된 계좌 · 남의 계좌 · 본인인증 전 ·
--      원천징수율 비어 있음 · 상태 건너뛰기 · 확정한 사람이 지급(2인 원칙 fn_payout_two_person) · 끝난 줄 고치기 · 지우기.
--   ⑤ 지급 데스크 대기열(v_payout_queue)에 POINT.
-- =====================================================================

-- ① 추천 보상 현금화 ----------------------------------------------------------
UPDATE public.point_rules SET needs_valid = false WHERE code = 'REFERRAL_DIRECT';

CREATE OR REPLACE FUNCTION public.fn_referral_reward(p_invitee uuid) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v_rule point_rules%ROWTYPE; v_ref introducer_referrals%ROWTYPE; v_month int;
BEGIN
  SELECT * INTO v_rule FROM point_rules WHERE code = 'REFERRAL_DIRECT';
  IF NOT FOUND OR NOT v_rule.is_active THEN RETURN false; END IF;
  SELECT * INTO v_ref FROM introducer_referrals WHERE invitee_id = p_invitee AND rewarded_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_rule.monthly_cap IS NOT NULL THEN
    SELECT count(*) INTO v_month FROM point_ledger
     WHERE account_id = v_ref.inviter_id AND rule_code = 'REFERRAL_DIRECT'
       AND earned_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul';
    IF v_month >= v_rule.monthly_cap THEN RETURN false; END IF;
  END IF;
  PERFORM set_config('sgb.referral_reward', p_invitee::text, true);
  /* D190 — 현금화 가능(redeemable true) · 전에는 false */
  INSERT INTO point_ledger (account_id, rule_code, points, redeemable, memo)
  VALUES (v_ref.inviter_id, 'REFERRAL_DIRECT', v_rule.points, true, 'invitee ' || p_invitee::text);
  PERFORM set_config('sgb.referral_reward', '', true);
  UPDATE introducer_referrals SET rewarded_at = now() WHERE id = v_ref.id;
  RETURN true;
END $$;

-- ② 설정 ------------------------------------------------------------------------
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('point.cashout_min', '10000', 'GLOBAL',
        '포인트 출금 최소 금액(원 · 1포인트 = 1원 · v10.219 · D190 · docs/352) — 바꾸기는 SUPER.',
        false, '^[1-9][0-9]{3,6}$', '10000'),
       ('point.cashout_tax_rate', '3.3', 'GLOBAL',
        '포인트 출금 원천징수율(% · 0 ~ 50 · 소수 한 자리 · v10.219 · D190 · 처음 값 3.3 — 대표 11/9) — 비어 있으면 출금 신청을 받지 않음. 바꾸기 SUPER. 신청 때 값이 그 신청에 남음.',
        false, '^(50(\.0)?|[1-4]?[0-9](\.[0-9])?)$', '8.8')
ON CONFLICT (key) DO NOTHING;

-- ③ INV-9 예외 — 회사가 내는 돈(소개비 아님) ----------------------------------------
CREATE OR REPLACE FUNCTION public.fn_is_fee_exempt(p_table text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT p_table ~ '^(hlt_|v_hlt_)'              -- 건강몰 직판 대금
      OR p_table ~ '^(affiliate_|v_affiliate_)'   -- 제휴 마케팅비
      OR p_table ~ '^(partner_|v_p(order|stl|artner)_)'   -- 파트너 트랙
      OR p_table ~ '^(adx_|v_adx_)'               -- v10.31 외부 송출 퍼블리셔 수익(원천징수 — 소개비 아님)
      OR p_table ~ '^(point_cashouts)$';          -- v10.219 포인트 출금(회사 마케팅비 · 원천징수 — 소개비 아님)
$function$;

-- ③ 출금 신청 --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.point_cashouts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES public.accounts(id),
  points            integer NOT NULL CHECK (points > 0),
  tax_rate          numeric(3,1) NOT NULL CHECK (tax_rate >= 0 AND tax_rate <= 50),
  withholding       integer NOT NULL CHECK (withholding >= 0),
  net_amount        integer NOT NULL CHECK (net_amount > 0),
  payout_account_id uuid NOT NULL REFERENCES public.payout_accounts(id),
  bank_name         text NOT NULL,
  account_last4     text,
  holder_name       text NOT NULL,
  status            text NOT NULL DEFAULT 'REQUESTED'
                    CHECK (status IN ('REQUESTED', 'CONFIRMED', 'PAID', 'REJECTED', 'CANCELED')),
  requested_at      timestamptz NOT NULL DEFAULT now(),
  confirmed_by      uuid REFERENCES public.accounts(id),
  confirmed_at      timestamptz,
  paid_by           uuid REFERENCES public.accounts(id),
  paid_at           timestamptz,
  paid_ref          text,
  closed_by         uuid REFERENCES public.accounts(id),
  closed_at         timestamptz,
  closed_reason     text,
  CHECK (withholding + net_amount = points)
);
CREATE INDEX IF NOT EXISTS ix_point_cashouts_account ON public.point_cashouts (account_id, requested_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ux_point_cashouts_open ON public.point_cashouts (account_id)
  WHERE status IN ('REQUESTED', 'CONFIRMED');
COMMENT ON TABLE public.point_cashouts IS
  '포인트 출금 신청(D190) — 회사가 자기 돈으로 보내는 현금 지급(소개비 아님). REQUESTED → CONFIRMED(ADMIN) → PAID(PAYOUT · 다른 사람) · 반려 · 취소. 계좌번호 없음(payout_accounts 참조 · 뒤 4자리만 남김) · 지울 수 없음';

/* 현금으로 바꿀 수 있는 포인트 — 현금화 가능 줄 합계 − 신청 · 확정 · 지급된 출금 */
CREATE OR REPLACE FUNCTION public.fn_point_cashable(p_account uuid) RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT (coalesce((SELECT sum(points) FROM point_ledger WHERE account_id = p_account AND redeemable), 0)
        - coalesce((SELECT sum(points) FROM point_cashouts WHERE account_id = p_account
                     AND status IN ('REQUESTED', 'CONFIRMED', 'PAID')), 0))::integer;
$$;

CREATE OR REPLACE FUNCTION public.fn_point_cashout_new() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_rate text; v_min int; v_acc payout_accounts%ROWTYPE; v_left int;
BEGIN
  /* 같은 회원의 신청이 동시에 들어와도 잔액을 두 번 쓰지 않게 회원 줄을 잠금 */
  PERFORM 1 FROM accounts WHERE id = NEW.account_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND identity_verified_at IS NOT NULL) THEN
    RAISE EXCEPTION 'POINT: 본인인증을 마친 뒤 출금을 신청할 수 있습니다.';
  END IF;
  v_rate := nullif(btrim(coalesce((SELECT value FROM site_settings WHERE key = 'point.cashout_tax_rate'), '')), '');
  IF v_rate IS NULL THEN
    RAISE EXCEPTION 'POINT: 출금 기준(원천징수율)이 아직 정해지지 않아 신청을 받지 않습니다.';
  END IF;
  v_min := coalesce(nullif((SELECT value FROM site_settings WHERE key = 'point.cashout_min'), '')::int, 10000);
  IF NEW.points < v_min THEN
    RAISE EXCEPTION 'POINT: 최소 출금 금액은 %원입니다.', v_min;
  END IF;
  IF EXISTS (SELECT 1 FROM point_cashouts WHERE account_id = NEW.account_id AND status IN ('REQUESTED', 'CONFIRMED')) THEN
    RAISE EXCEPTION 'POINT: 처리 중인 출금 신청이 있습니다. 끝난 뒤에 다시 신청해 주십시오.';
  END IF;
  v_left := fn_point_cashable(NEW.account_id);
  IF NEW.points > v_left THEN
    RAISE EXCEPTION 'POINT: 출금할 수 있는 포인트(%)보다 많습니다.', v_left;
  END IF;
  SELECT * INTO v_acc FROM payout_accounts WHERE id = NEW.payout_account_id AND account_id = NEW.account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'POINT: 본인의 받을 계좌가 아닙니다.'; END IF;
  IF NOT v_acc.verified THEN RAISE EXCEPTION 'POINT: 확인을 마친 계좌로만 받을 수 있습니다.'; END IF;

  NEW.status := 'REQUESTED'; NEW.requested_at := now();
  NEW.confirmed_by := NULL; NEW.confirmed_at := NULL; NEW.paid_by := NULL; NEW.paid_at := NULL; NEW.paid_ref := NULL;
  NEW.closed_by := NULL; NEW.closed_at := NULL; NEW.closed_reason := NULL;
  NEW.tax_rate := v_rate::numeric;
  /* 원천징수 세액은 10원 미만 버림 */
  NEW.withholding := (floor(NEW.points * NEW.tax_rate / 1000) * 10)::int;
  NEW.net_amount := NEW.points - NEW.withholding;
  NEW.bank_name := v_acc.bank_name; NEW.account_last4 := v_acc.account_last4; NEW.holder_name := v_acc.holder_name;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_point_cashout_new ON public.point_cashouts;
CREATE TRIGGER trg_point_cashout_new BEFORE INSERT ON public.point_cashouts
  FOR EACH ROW EXECUTE FUNCTION public.fn_point_cashout_new();

CREATE OR REPLACE FUNCTION public.fn_point_cashout_flow() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'POINT: 출금 기록은 지울 수 없습니다.'; END IF;
  IF OLD.status IN ('PAID', 'REJECTED', 'CANCELED') THEN
    RAISE EXCEPTION 'POINT: 끝난 출금 신청은 고칠 수 없습니다.';
  END IF;
  IF (NEW.account_id, NEW.points, NEW.tax_rate, NEW.withholding, NEW.net_amount, NEW.payout_account_id,
      NEW.bank_name, NEW.account_last4, NEW.holder_name, NEW.requested_at)
     IS DISTINCT FROM
     (OLD.account_id, OLD.points, OLD.tax_rate, OLD.withholding, OLD.net_amount, OLD.payout_account_id,
      OLD.bank_name, OLD.account_last4, OLD.holder_name, OLD.requested_at) THEN
    RAISE EXCEPTION 'POINT: 신청한 금액 · 계좌는 바꿀 수 없습니다. 취소하고 다시 신청해 주십시오.';
  END IF;
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF OLD.status = 'REQUESTED' AND NEW.status = 'CONFIRMED' THEN
    IF NEW.confirmed_by IS NULL THEN RAISE EXCEPTION 'POINT: 확정한 사람을 남겨야 합니다.'; END IF;
    NEW.confirmed_at := now();
  ELSIF OLD.status = 'CONFIRMED' AND NEW.status = 'PAID' THEN
    IF NEW.paid_by IS NULL OR coalesce(btrim(NEW.paid_ref), '') = '' THEN
      RAISE EXCEPTION 'POINT: 지급한 사람과 이체 참조를 남겨야 합니다.';
    END IF;
    NEW.paid_at := now();
  ELSIF NEW.status = 'CANCELED' AND OLD.status = 'REQUESTED' THEN
    NEW.closed_at := now();
  ELSIF NEW.status = 'REJECTED' AND OLD.status IN ('REQUESTED', 'CONFIRMED') THEN
    IF NEW.closed_by IS NULL OR length(btrim(coalesce(NEW.closed_reason, ''))) < 2 THEN
      RAISE EXCEPTION 'POINT: 반려한 사람과 사유(2자 이상)를 남겨야 합니다.';
    END IF;
    NEW.closed_at := now();
  ELSE
    RAISE EXCEPTION 'POINT: % 에서 % 로 바꿀 수 없습니다.', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_point_cashout_flow ON public.point_cashouts;
CREATE TRIGGER trg_point_cashout_flow BEFORE UPDATE OR DELETE ON public.point_cashouts
  FOR EACH ROW EXECUTE FUNCTION public.fn_point_cashout_flow();
DROP TRIGGER IF EXISTS trg_point_cashout_two_person ON public.point_cashouts;
CREATE TRIGGER trg_point_cashout_two_person BEFORE UPDATE ON public.point_cashouts
  FOR EACH ROW EXECUTE FUNCTION public.fn_payout_two_person();

-- ⑤ 지급 데스크 대기열 ----------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_payout_queue AS
SELECT 'PARTNER'::text AS kind, s.id, s.track AS sub, b.company_name AS payee,
       s.period_from, s.period_to, s.net_amount AS amount, s.state AS status,
       s.confirmed_by, s.confirmed_at,
       (a.verified_at IS NOT NULL) AS ready,
       CASE WHEN a.id IS NULL THEN '정산 계좌 없음'
            WHEN a.verified_at IS NULL THEN '계좌 1원 인증 전'
            ELSE NULL END AS blocker,
       a.bank_name, a.account_last4, a.holder_name
  FROM partner_settlements s
  JOIN partners p ON p.id = s.partner_id
  JOIN businesses b ON b.id = p.business_id
  LEFT JOIN partner_settlement_accounts a ON a.partner_id = s.partner_id
 WHERE s.state = 'CONFIRMED'
UNION ALL
SELECT 'HEALTH', h.id, sl.type, sl.name,
       h.period_from, h.period_to, h.net_amount, h.status,
       h.confirmed_by, h.confirmed_at,
       (h.net_amount >= 0 AND (sl.type = 'DIRECT' OR coalesce(btrim(sl.submerchant_id),'') <> '')),
       CASE WHEN h.net_amount < 0 THEN '정산액 음수 — 이월 대상'
            WHEN NOT (sl.type = 'DIRECT' OR coalesce(btrim(sl.submerchant_id),'') <> '') THEN '하위가맹점 ID 없음'
            ELSE NULL END,
       NULL, NULL, NULL
  FROM hlt_settlements h
  JOIN hlt_sellers sl ON sl.id = h.seller_id
 WHERE h.status = 'CONFIRMED'
UNION ALL
SELECT 'POINT', c.id, 'MEMBER', ac.name,
       (c.requested_at AT TIME ZONE 'Asia/Seoul')::date, NULL::date, c.net_amount::bigint, c.status,
       c.confirmed_by, c.confirmed_at,
       coalesce(pa.verified, false),
       CASE WHEN NOT coalesce(pa.verified, false) THEN '받을 계좌 확인이 풀림' ELSE NULL END,
       c.bank_name, c.account_last4, c.holder_name
  FROM point_cashouts c
  JOIN accounts ac ON ac.id = c.account_id
  LEFT JOIN payout_accounts pa ON pa.id = c.payout_account_id
 WHERE c.status = 'CONFIRMED';

COMMENT ON VIEW public.v_payout_queue IS
  'Q1(2026-10-01): 지급 담당 대기열. 제휴 파트너(PARTNER) · 건강몰 판매자(HEALTH) · 포인트 출금(POINT · D190). ready=false 면 blocker 를 해소해야 지급됩니다.';

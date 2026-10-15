-- 개발 · 시연용 (운영 DB 에 돌리지 마십시오) — v10.31 (W5 · D070)
--
-- 리드 이용료가 선불 충전으로 바뀌어, 잔액이 0인 파트너에게는 상담이 배정되지 않습니다.
-- 개발 DB 의 활동 중 파트너 가운데 잔액이 없는 곳에 **시험 결제(스텁)** 충전 한 건씩을 넣습니다 — 원장 · 불변식을 그대로 탑니다.
--   psql "$DATABASE_URL" -v amount=300000 -f scripts/seed-lead-cash-dev.sql
\set ON_ERROR_STOP on
\if :{?amount}
\else
  \set amount 300000
\endif

CREATE TEMP TABLE _seed_amount AS SELECT :amount::bigint AS v;

DO $$
DECLARE r record; v_id uuid; v_rate numeric; v_amt bigint;
BEGIN
  SELECT v INTO v_amt FROM _seed_amount;
  FOR r IN SELECT p.id, p.grade FROM partners p
             LEFT JOIN lead_cash_wallets w ON w.partner_id = p.id
            WHERE p.status = 'ACTIVE' AND coalesce(w.paid_balance,0) + coalesce(w.bonus_balance,0) = 0 LOOP
    SELECT coalesce(rate,0) INTO v_rate FROM lead_cash_bonus_rates WHERE grade = r.grade;
    INSERT INTO lead_cash_charges(partner_id, order_id, amount, bonus_rate, bonus_amount, source)
    VALUES (r.id, 'lc-seed' || replace(gen_random_uuid()::text, '-', ''), v_amt, coalesce(v_rate,0), floor(v_amt * coalesce(v_rate,0)), 'MANUAL')
    RETURNING id INTO v_id;
    PERFORM fn_lead_cash_charge_done(v_id, 'stub_seed_' || v_id::text, 'STUB', true, NULL);
  END LOOP;
END $$;

SELECT count(*) AS "충전한 파트너", (SELECT count(*) FROM v_lead_cash_invariants) AS "불변식 위반(0이어야 함)"
  FROM lead_cash_charges WHERE order_id LIKE 'lc-seed%';

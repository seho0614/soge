-- v10.31 (10/10 「시안 기준」 · 서버 자료가 없던 구역은 서버까지) — 운영 대시보드 「활주로」(SB-ADM-DSH-010)
--   시안은 가정치(시나리오 B)였습니다. 지시 「숫자를 지어내지 않음 — 실제 자료로 계산」에 따라
--   매출은 DB 에 실제로 들어온 돈으로, 비용은 운영이 입력한 월 비용으로 계산합니다.
--   · v_monthly_revenue  — 한국 시간 월별 실제 매출(구독 − 환불 · 소개코드 추가분 · 리드 이용료(취소 제외) · 광고비 입금 · 법률·세무 노출료 · 소개몰 수수료)
--   · ops_monthly_costs  — 운영이 넣는 월 비용(항목별). 비어 있으면 활주로는 「비용 입력 전」으로 나옵니다.
--   · finance.opening_cash — 첫 달 시작 현금(운영 설정). 비어 있으면 최저 현금 칸은 누적 손익만 보여 줍니다.
--   소개비는 당사자끼리 직접 주고받으므로 매출이 아닙니다(INV-11).

CREATE TABLE IF NOT EXISTS ops_monthly_costs (
  month      date NOT NULL CHECK (month = date_trunc('month', month)::date),
  category   text NOT NULL CHECK (category IN ('PAYROLL','RENT','INFRA','MARKETING','PG_FEE','OUTSOURCE','TAX','ETC')),
  amount     bigint NOT NULL CHECK (amount >= 0),
  memo       text,
  entered_by uuid REFERENCES accounts(id),
  entered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (month, category)
);
COMMENT ON TABLE ops_monthly_costs IS 'v10.31 — 운영이 입력하는 월 비용(활주로 계산용). 매출은 v_monthly_revenue(실제 입금)';

INSERT INTO code_labels (domain, code, label, sort_order, audience) VALUES
  ('finance.cost','PAYROLL','인건비',1,'ADMIN'), ('finance.cost','RENT','임차료',2,'ADMIN'),
  ('finance.cost','INFRA','서버 · 인프라',3,'ADMIN'), ('finance.cost','MARKETING','마케팅',4,'ADMIN'),
  ('finance.cost','PG_FEE','결제 수수료',5,'ADMIN'), ('finance.cost','OUTSOURCE','외주 · 용역',6,'ADMIN'),
  ('finance.cost','TAX','세금 · 공과',7,'ADMIN'), ('finance.cost','ETC','기타',8,'ADMIN')
ON CONFLICT (domain, code) DO NOTHING;

INSERT INTO site_settings (key, value, description, is_required_for_open, value_pattern, value_example) VALUES
  ('finance.opening_cash', NULL, '활주로 — 첫 기록 달의 시작 현금(원). 비우면 최저 현금 대신 누적 손익만 계산합니다', false, '^[0-9]{1,13}$', '300000000')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE VIEW v_monthly_revenue AS
WITH src AS (
  SELECT date_trunc('month', paid_at AT TIME ZONE 'Asia/Seoul')::date AS month, 'SUBSCRIPTION' AS kind, amount::numeric AS amount
    FROM subscription_invoices WHERE paid_at IS NOT NULL
  UNION ALL
  SELECT date_trunc('month', coalesce(completed_at, processed_at) AT TIME ZONE 'Asia/Seoul')::date, 'SUBSCRIPTION', -amount
    FROM subscription_refunds WHERE state = 'SUCCEEDED' AND coalesce(completed_at, processed_at) IS NOT NULL
  UNION ALL
  SELECT date_trunc('month', paid_at AT TIME ZONE 'Asia/Seoul')::date, 'REFCODE', amount
    FROM referral_code_payments WHERE paid_at IS NOT NULL
  UNION ALL
  SELECT date_trunc('month', coalesce(billed_at, incurred_at) AT TIME ZONE 'Asia/Seoul')::date, 'LEAD_FEE', amount
    FROM lead_fees WHERE voided_at IS NULL AND state <> 'VOIDED'
  UNION ALL
  SELECT date_trunc('month', paid_at AT TIME ZONE 'Asia/Seoul')::date, 'AD', amount
    FROM ad_payments WHERE paid_at IS NOT NULL
  UNION ALL
  SELECT date_trunc('month', coalesce(paid_from::timestamptz, decided_at) AT TIME ZONE 'Asia/Seoul')::date, 'DIRECTORY', monthly_fee
    FROM consult_directory_entries WHERE payment_ref IS NOT NULL AND monthly_fee IS NOT NULL
  UNION ALL
  SELECT date_trunc('month', period_to)::date, 'HEALTH_COMMISSION', commission
    FROM hlt_settlements WHERE status IN ('CONFIRMED','PAID','CARRIED')
)
SELECT month, kind, sum(amount)::bigint AS amount FROM src WHERE month IS NOT NULL GROUP BY month, kind;
COMMENT ON VIEW v_monthly_revenue IS 'v10.31 — 월별 실제 매출(한국 시간). 소개비는 매출이 아님(INV-11)';

-- =====================================================================
-- E010 (e3.6 · docs/011) 회계 정기 작업 18개를 ERP 작업 실행기에 — 소개뱅크 job_schedules 와 같은 주기 · 시각(한국 시각)
--   돌리는 것은 erp.jobs_owner = ERP 일 때만(지금 SGB — 소개뱅크가 돌림 · E7 에서 넘김 · 같은 날 두 번 돌지 않음)
--   함수는 api/src/modules/acct/acct-jobs.ts(소개뱅크 scheduler 의 case 'acct_*' 와 같은 순서)
-- =====================================================================
INSERT INTO public.erp_jobs (name, schedule, description) VALUES
  ('acct_accrual', 'daily 01:20', '회계(e3.6) — 고정비 자동 전표(D257) — 매일 01:20 · 이번 달 줄 만들기 · 매입 맞춤 · 빠진 매입 알림 · acct.contract_accrue off 면 맞춤만'),
  ('acct_aging', 'daily 09:25', '회계(e3.6) — 받을 돈 · 갚을 돈 기간 분석 — 매일 09:25 · acct.aging_alert_days 넘은 외상매출금 · 미지급금 ACCT_AGING_OVER(거래처 · 계정마다 한 번 · 사라지면 풀림) · D247 · v10.401'),
  ('acct_bank_feed', 'daily 06:40', '회계(e3.6) — 은행 거래내역 자동 조회 — 매일 06:40 · 등록한 회사 계좌(acct.bank_feed on 일 때) · 은행 맞추기에 들여옴 · D264 · v10.467'),
  ('acct_biz_check', 'daily 06:10', '회계(e3.6) — 거래처 휴폐업 다시 조회(acct.biz_status_check on 일 때만 · 30일 지난 50곳 · 휴업 · 폐업 ACCT_PARTY_CLOSED) · D254 · v10.431'),
  ('acct_budget', 'daily 09:25', '회계(e3.6) — 예산 넘음 알림 — 매일 09:25 · 이번 달 · 지난달 비용 계정 실적 > 예산이면 ACCT_BUDGET_OVER · 예산을 올리면 풀림 · D246 · v10.399'),
  ('acct_card_limit', 'daily 09:40', '회계(e3.6) — 법인카드 한도 알림 — 매일 09:40 · 이번 달 사용이 기준을 넘은 카드(acct.card_alert on 일 때) · D261 · v10.453'),
  ('acct_cashflow', 'daily 09:20', '회계(e3.6) — 자금 흐름 90일 — 매일 09:20 · 가장 낮은 날 잔액이 acct.cash_floor 밑이면 ACCT_CASH_SHORT(하루 한 번 · 넉넉해지면 풀림) · D245 · v10.394'),
  ('acct_cashplan', 'daily 09:35', '회계(e3.6) — 12개월 자금 계획 — 매일 09:35 · 달 말 예상 잔액이 acct.cash_floor 밑인 첫 달 ACCT_CASHPLAN_SHORT(넉넉해지면 풀림) · D266 · v10.476'),
  ('acct_contracts', 'daily 09:25', '회계(e3.6) — 계약 만기 N일 전 운영 알림 ACCT_CONTRACT_DUE(같은 계약 · 만기 한 번 · 지나면 풀림) · D249 · v10.409'),
  ('acct_deadline', 'daily 09:15', '회계(e3.6) — 신고 기한 · 마감 알림 — 매일 09:15 · 원천세(10일) · 부가세(25일) N일 전 ACCT_DEADLINE · 지난달 마감 안 함 ACCT_UNCLOSED · D244 · v10.390'),
  ('acct_depreciation', 'daily 03:40', '회계(e3.6) — 감가상각 — 매일 03:40 · 끝난 달까지 자산마다 한 번(같은 달 두 번 없음) · 전표는 acct_journal 이 DEPRECIATION 으로 · D246 · v10.398'),
  ('acct_dunning', 'daily 09:35', '회계(e3.6) — 미수금 독촉(acct.dunning on 일 때만 메일) · 입금 예정 지난 것 BROKEN 표시 · D256 · v10.436'),
  ('acct_insurance', 'daily 09:35', '회계(e3.6) — 4대보험 취득 · 상실 신고 기한 알림 ACCT_INSURANCE_DUE(같은 건 한 번 · 처리함 누르면 풀림) · D252 · v10.422'),
  ('acct_journal', 'every 60m', '회계(e3.6) — 자동 전표 — 시작일 뒤 아직 전표가 없는 돈 흐름을 전표로(같은 근거는 한 번 · 마감한 달이면 오늘 날짜) · D242 · v10.382'),
  ('acct_pg_check', 'daily 09:25', '회계(e3.6) — PG 정산 안 들어온 결제 알림 — 매일 09:25 · PG 정산 받을 돈 전표가 acct.pg_unsettled_days 지나도 PG 정산 줄과 맞지 않으면 ACCT_PG_UNSETTLED · D248 · v10.404'),
  ('acct_reorder', 'every 60m', '회계(e3.6) — 안전 재고 · 재주문 — 매시간 · 판매용 재고 + 발주 중 < 최소면 STOCK_REORDER · 매입처별 재주문 초안(자동 발주 없음) · D266 · v10.478'),
  ('acct_stock', 'every 60m', '회계(e3.6) — 직판 재고 수불부 — 결제 승인 → 출고 · 취소 · 반품 → 반입(이동평균 원가) · 재고 없이 나가면 STOCK_NEGATIVE · D245 · v10.395'),
  ('acct_taxinbox', 'daily 08:10', '회계(e3.6) — 매입 세금계산서 가져오기 — 매일 08:10 지난 7일(acct.taxinbox 가 on 일 때만) · D255 · v10.432')
ON CONFLICT (name) DO NOTHING;

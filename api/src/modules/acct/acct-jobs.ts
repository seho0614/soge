/* ---------------------------------------------------------------------
 * e3.6 (docs/011) 회계 정기 작업 18개 — 소개뱅크 src/worker/scheduler.service.ts 의 case 'acct_*' 를 같은 함수 · 같은 순서로
 *   ERP 작업 실행기(modules/jobs/job-runner.ts)가 erp.jobs_owner = ERP 일 때만 돌림(지금 SGB · E7 에서 넘김 → 같은 날 두 번 돌지 않음)
 *   알림은 ERP ops_alerts(보낼 알림 표 · E007) — 소개뱅크 alertOnce · resolveAlert 와 같은 SQL
 *   시각 · 주기는 E010 erp_jobs(소개뱅크 job_schedules 와 같은 값 · 한국 시각)
 * ------------------------------------------------------------------- */
import type { DatabaseService } from '../../db/database.service';
import { MailService } from '../../common/mail/mail.service';
import { runJournal } from './journal';
import { ALL_SOURCES } from './sources';
import { acctCashflowJob } from './cashflow';
import { stockJob } from './stock';
import { acctCashPlanJob } from './cashplan';
import { acctReorderJob } from './reorder';
import { depreciationJob } from './assets';
import { budgetJob } from './budget';
import { acctAgingJob } from './aging';
import { acctPgCheckJob } from './pgsettle';
import { acctContractsJob } from './contracts';
import { acctTaxInboxJob } from './taxinbox';
import { acctInsuranceJob } from './filings';
import { dunningJob } from './dunning';
import { acctAccrualJob } from './accrual';
import { acctCardLimitJob } from './cardlimit';
import { acctBankFeedJob } from './bankfeed';
import { acctBizCheckJob } from './bizcheck';
import { acctDeadlineJob } from './month';

const short = (r: unknown) => JSON.stringify(r ?? {}).slice(0, 450);

async function alertOnce(db: DatabaseService, code: string, severity: 'INFO' | 'WARN' | 'CRITICAL', title: string, detail: unknown) {
  const r = await db.query(
    `INSERT INTO ops_alerts (alert_code, severity, title, detail)
     SELECT $1, $2, $3, $4::jsonb WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = $1 AND resolved_at IS NULL)
     ON CONFLICT DO NOTHING RETURNING id`, [code, severity, title, JSON.stringify(detail)]);
  return r.length > 0;
}
const resolveAlert = (db: DatabaseService, code: string, note: string) =>
  db.query(`UPDATE ops_alerts SET resolved_at = now(), resolve_note = $2 WHERE alert_code = $1 AND resolved_at IS NULL`, [code, note]);

export const ACCT_JOBS: Record<string, (db: DatabaseService) => Promise<string>> = {
  acct_journal: async (db) => {
    await stockJob(db);   // 재고 출고 · 반입을 먼저(소개뱅크와 같은 순서)
    const r = await runJournal(db, ALL_SOURCES);
    if (r.failedCount) await alertOnce(db, 'ACCT_JOURNAL_FAIL', 'WARN', `자동 전표 ${r.failedCount}건을 만들지 못했습니다 — ${r.failed.slice(0, 3).map((f: any) => `${f.source}: ${f.why}`).join(' · ')}`.slice(0, 200), r);
    else await resolveAlert(db, 'ACCT_JOURNAL_FAIL', '자동 전표 실패 없음');
    return short(r);
  },
  acct_deadline: async (db) => short(await acctDeadlineJob(db)),
  acct_cashflow: async (db) => short(await acctCashflowJob(db)),
  acct_depreciation: async (db) => short(await depreciationJob(db)),
  acct_budget: async (db) => short(await budgetJob(db)),
  acct_aging: async (db) => short(await acctAgingJob(db)),
  acct_pg_check: async (db) => short(await acctPgCheckJob(db)),
  acct_taxinbox: async (db) => short(await acctTaxInboxJob(db)),
  acct_contracts: async (db) => short(await acctContractsJob(db)),
  acct_insurance: async (db) => short(await acctInsuranceJob(db)),
  acct_biz_check: async (db) => short(await acctBizCheckJob(db)),
  acct_dunning: async (db) => short(await dunningJob(db, new MailService())),
  acct_bank_feed: async (db) => short(await acctBankFeedJob(db)),
  acct_card_limit: async (db) => short(await acctCardLimitJob(db)),
  acct_accrual: async (db) => short(await acctAccrualJob(db)),
  acct_stock: async (db) => short(await stockJob(db)),
  acct_cashplan: async (db) => short(await acctCashPlanJob(db)),
  acct_reorder: async (db) => short(await acctReorderJob(db)),
};

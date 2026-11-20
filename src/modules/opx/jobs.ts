import { DatabaseService } from '../../db/database.service';
import { archiveJob } from './archive';
import { riskDailyJob, riskEventsJob } from './risk';

/* v10.509 · 510 (D275) — scheduler.service 가 부르는 정기 작업 셋(스위치가 꺼져 있으면 아무것도 안 함) */
export async function opxArchiveJob(db: DatabaseService) { return archiveJob(db, null); }
export async function opxRiskEventsJob(db: DatabaseService) { return riskEventsJob(db); }
export async function opxRiskDailyJob(db: DatabaseService) { return riskDailyJob(db); }

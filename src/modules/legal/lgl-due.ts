import { DatabaseService } from '../../db/database.service';
import { alertDays, daysBetween, kstToday, raiseOnce, resolveOthers, stageOf } from './lgl-common';

/* ---------------------------------------------------------------------
 * ㊴ 법무 (D269 · docs/624 ~ 627) — 기한 알림 정기 작업 하나 · 다가오는 기한 · 사내 일정(㉜) 항목
 *   정기 작업 lgl_due(매일 09:50 · job_schedules · worker 허용 목록 · scheduler case):
 *     인허가   다음 갱신일 60 · 30 · 7일 전(lgl.license_alert_days) LGL_LICENSE_DUE — 열쇠 LIC:{번호}:{갱신일}:{차례} · 7일 이하 · 지남은 급함
 *     사건 기일 7 · 1일 전(lgl.hearing_alert_days) LGL_HEARING_DUE — 열쇠 HEAR:{번호}:{날짜}:{차례} · 1일 이하는 급함
 *     보험     만기 30일 전(lgl.insurance_alert_days) 갱신 증권 없으면 LGL_INSURANCE_DUE — 열쇠 INS:{번호}:{만기일}(:X 지남 · 급함)
 *     검토     검토 희망일 지남 · 결정 안 남 LGL_REVIEW_LATE — 열쇠 REV:{번호}
 *   열쇠마다 한 번(풀린 뒤 같은 열쇠는 다시 안 뜸 · 날짜 · 차례가 바뀌면 새 열쇠) · 새 차례가 뜨면 앞 차례는 풀림 · 처리(갱신 · 끝남 · 결정)하면 풀림.
 *   제목에는 사건 상대 이름 · 금액을 넣지 않음(운영 알림은 운영 관리자 모두가 봄) — 화면 위치만.
 * ------------------------------------------------------------------- */


export async function legalDueJob(db: DatabaseService) {
  const today = kstToday();
  let made = 0, resolved = 0;

  /* ① 인허가 */
  const lDays = await alertDays(db, 'lgl.license_alert_days', [60, 30, 7]);
  const lics = await db.query<{ id: string; title: string; due: string }>(
    `SELECT id::text AS id, title, next_due_on::text AS due FROM lgl_licenses WHERE state = 'ACTIVE' AND next_due_on IS NOT NULL
        AND next_due_on <= (now() AT TIME ZONE 'Asia/Seoul')::date + $1::int ORDER BY next_due_on LIMIT 300`, [lDays[0] ?? 60]);
  const licKeep = new Set<string>();
  for (const l of lics) {
    const left = daysBetween(today, l.due);
    const stage = left < 0 ? 0 : stageOf(left, lDays);
    if (stage == null) continue;
    const key = `LIC:${l.id}:${l.due}:${stage}`;
    licKeep.add(l.id);
    resolved += await resolveOthers(db, 'LGL_LICENSE_DUE', `LIC:${l.id}:`, key, '다음 차례');
    made += await raiseOnce(db, 'LGL_LICENSE_DUE', stage <= 7 ? 'CRITICAL' : 'WARN',
      left < 0 ? `인허가 「${l.title}」 갱신일 ${l.due} 지남 — 사무 › 인허가` : `인허가 「${l.title}」 갱신일 ${l.due}(${left}일 남음) — 사무 › 인허가`,
      key, { licenseId: l.id, dueOn: l.due, stage, daysLeft: left });
  }
  /* 다음 갱신일이 바뀌었거나(멀어짐) 끝낸 인허가의 열린 알림 풀기 */
  const openLic = await db.query<{ id: string; key: string }>(
    `SELECT id::text AS id, detail->>'key' AS key FROM ops_alerts WHERE alert_code = 'LGL_LICENSE_DUE' AND resolved_at IS NULL`);
  for (const a of openLic) {
    const lid = String(a.key ?? '').split(':')[1] ?? '';
    if (!licKeep.has(lid)) resolved += (await db.query(`UPDATE ops_alerts SET resolved_at = now(), resolve_note = '갱신일 바뀜 · 끝냄' WHERE id = $1::bigint AND resolved_at IS NULL RETURNING id`, [a.id])).length;
  }

  /* ② 사건 기일 */
  const hDays = await alertDays(db, 'lgl.hearing_alert_days', [7, 1]);
  const hears = await db.query<{ id: string; caseId: string; title: string; day: string; hm: string }>(
    `SELECT h.id::text AS id, h.case_id::text AS "caseId", c.title, (h.held_at AT TIME ZONE 'Asia/Seoul')::date::text AS day,
            to_char(h.held_at AT TIME ZONE 'Asia/Seoul', 'HH24:MI') AS hm
       FROM lgl_case_hearings h JOIN lgl_cases c ON c.id = h.case_id
      WHERE h.state = 'PLANNED' AND c.state = 'OPEN' AND (h.held_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN (now() AT TIME ZONE 'Asia/Seoul')::date
            AND (now() AT TIME ZONE 'Asia/Seoul')::date + $1::int ORDER BY h.held_at LIMIT 300`, [hDays[0] ?? 7]);
  for (const h of hears) {
    const left = daysBetween(today, h.day);
    const stage = stageOf(left, hDays);
    if (stage == null) continue;
    const key = `HEAR:${h.id}:${h.day}:${stage}`;
    resolved += await resolveOthers(db, 'LGL_HEARING_DUE', `HEAR:${h.id}:`, key, '다음 차례');
    made += await raiseOnce(db, 'LGL_HEARING_DUE', stage <= 1 ? 'CRITICAL' : 'WARN',
      `사건 「${h.title}」 기일 ${h.day} ${h.hm}${left === 0 ? '(오늘)' : `(${left}일 남음)`} — 사무 › 소송 · 분쟁`, key, { caseId: h.caseId, hearingId: h.id, day: h.day, stage });
  }
  /* 지난 기일(어제 이전) · 끝남 · 취소 · 사건 끝남 → 풀기 */
  resolved += (await db.query(
    `UPDATE ops_alerts a SET resolved_at = now(), resolve_note = '기일 지남 · 처리'
      WHERE a.alert_code = 'LGL_HEARING_DUE' AND a.resolved_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM lgl_case_hearings h JOIN lgl_cases c ON c.id = h.case_id
                         WHERE h.id::text = split_part(a.detail->>'key', ':', 2) AND h.state = 'PLANNED' AND c.state = 'OPEN'
                           AND (h.held_at AT TIME ZONE 'Asia/Seoul')::date >= (now() AT TIME ZONE 'Asia/Seoul')::date)
      RETURNING a.id`)).length;

  /* ③ 보험 만기 */
  const [iDays] = await alertDays(db, 'lgl.insurance_alert_days', [30]);
  const pols = await db.query<{ id: string; title: string; ends: string }>(
    `SELECT p.id::text AS id, p.title, p.ends_on::text AS ends FROM lgl_insurance_policies p
      WHERE p.state = 'ACTIVE' AND p.ends_on <= (now() AT TIME ZONE 'Asia/Seoul')::date + $1::int
        AND NOT EXISTS (SELECT 1 FROM lgl_insurance_policies n WHERE n.renewed_from = p.id) ORDER BY p.ends_on LIMIT 300`, [iDays ?? 30]);
  const insKeep = new Set<string>();
  for (const p of pols) {
    const left = daysBetween(today, p.ends);
    const key = left < 0 ? `INS:${p.id}:${p.ends}:X` : `INS:${p.id}:${p.ends}`;
    insKeep.add(p.id);
    resolved += await resolveOthers(db, 'LGL_INSURANCE_DUE', `INS:${p.id}:`, key, '만기 지남');
    made += await raiseOnce(db, 'LGL_INSURANCE_DUE', left < 0 ? 'CRITICAL' : 'WARN',
      left < 0 ? `회사 보험 「${p.title}」 만기 ${p.ends} 지남 · 갱신 없음 — 사무 › 회사 보험` : `회사 보험 「${p.title}」 만기 ${p.ends}(${left}일 남음) — 사무 › 회사 보험`,
      key, { policyId: p.id, endsOn: p.ends, daysLeft: left });
  }
  const openIns = await db.query<{ id: string; key: string }>(
    `SELECT id::text AS id, detail->>'key' AS key FROM ops_alerts WHERE alert_code = 'LGL_INSURANCE_DUE' AND resolved_at IS NULL`);
  for (const a of openIns) {
    const pid = String(a.key ?? '').split(':')[1] ?? '';
    if (!insKeep.has(pid)) resolved += (await db.query(`UPDATE ops_alerts SET resolved_at = now(), resolve_note = '갱신 · 끝냄' WHERE id = $1::bigint AND resolved_at IS NULL RETURNING id`, [a.id])).length;
  }

  /* ④ 계약 검토 늦음 */
  const late = await db.query<{ id: string; title: string; wanted: string }>(
    `SELECT id::text AS id, title, wanted_on::text AS wanted FROM lgl_contract_reviews
      WHERE state IN ('REQUESTED', 'REVIEWED') AND wanted_on < (now() AT TIME ZONE 'Asia/Seoul')::date ORDER BY wanted_on LIMIT 300`);
  for (const r of late) {
    made += await raiseOnce(db, 'LGL_REVIEW_LATE', 'WARN', `계약 검토 「${r.title}」 희망일 ${r.wanted} 지남 — 사무 › 계약 검토`, `REV:${r.id}`, { reviewId: r.id, wantedOn: r.wanted });
  }
  resolved += (await db.query(
    `UPDATE ops_alerts a SET resolved_at = now(), resolve_note = '결정 · 취소'
      WHERE a.alert_code = 'LGL_REVIEW_LATE' AND a.resolved_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM lgl_contract_reviews r WHERE r.id::text = split_part(a.detail->>'key', ':', 2) AND r.state IN ('REQUESTED', 'REVIEWED'))
      RETURNING a.id`)).length;

  return { made, resolved, licenses: lics.length, hearings: hears.length, policies: pols.length, lateReviews: late.length, licenseDays: lDays, hearingDays: hDays, insuranceDays: iDays ?? 30 };
}

/** 다가오는 법무 기한(오늘 ~ N일 · 지난 것 포함) — GET /admin/legal/due · 사내 일정(㉜ ofc-calendar)이 같은 모양으로 씀 */
export interface LegalDueItem { key: string; kind: 'LICENSE' | 'HEARING' | 'INSURANCE' | 'REVIEW'; title: string; day: string; time: string | null; tab: string; overdue: boolean }
export async function legalDueItems(db: DatabaseService, from: string, to: string): Promise<LegalDueItem[]> {
  const today = kstToday();
  const out: LegalDueItem[] = [];
  const lics = await db.query<{ id: string; title: string; d: string }>(
    `SELECT id::text AS id, title, next_due_on::text AS d FROM lgl_licenses WHERE state = 'ACTIVE' AND next_due_on BETWEEN $1::date AND $2::date ORDER BY next_due_on LIMIT 300`, [from, to]);
  for (const l of lics) out.push({ key: `LGL:LIC:${l.id}`, kind: 'LICENSE', title: `인허가 갱신 — ${l.title}`, day: l.d, time: null, tab: 'lgl-licenses', overdue: l.d < today });
  const hears = await db.query<{ id: string; title: string; d: string; hm: string; kind: string }>(
    `SELECT h.id::text AS id, c.title, (h.held_at AT TIME ZONE 'Asia/Seoul')::date::text AS d, to_char(h.held_at AT TIME ZONE 'Asia/Seoul', 'HH24:MI') AS hm, h.kind
       FROM lgl_case_hearings h JOIN lgl_cases c ON c.id = h.case_id
      WHERE h.state = 'PLANNED' AND (h.held_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN $1::date AND $2::date ORDER BY h.held_at LIMIT 300`, [from, to]);
  for (const h of hears) out.push({ key: `LGL:HEAR:${h.id}`, kind: 'HEARING', title: `${h.kind === 'DEADLINE' ? '사건 기한' : '사건 기일'} — ${h.title}`, day: h.d, time: h.hm, tab: 'lgl-cases', overdue: h.d < today });
  const pols = await db.query<{ id: string; title: string; d: string }>(
    `SELECT p.id::text AS id, p.title, p.ends_on::text AS d FROM lgl_insurance_policies p
      WHERE p.state = 'ACTIVE' AND p.ends_on BETWEEN $1::date AND $2::date AND NOT EXISTS (SELECT 1 FROM lgl_insurance_policies n WHERE n.renewed_from = p.id)
      ORDER BY p.ends_on LIMIT 300`, [from, to]);
  for (const p of pols) out.push({ key: `LGL:INS:${p.id}`, kind: 'INSURANCE', title: `보험 만기 — ${p.title}`, day: p.d, time: null, tab: 'lgl-insurance', overdue: p.d < today });
  const revs = await db.query<{ id: string; title: string; d: string }>(
    `SELECT id::text AS id, title, wanted_on::text AS d FROM lgl_contract_reviews WHERE state IN ('REQUESTED', 'REVIEWED') AND wanted_on BETWEEN $1::date AND $2::date ORDER BY wanted_on LIMIT 300`, [from, to]);
  for (const r of revs) out.push({ key: `LGL:REV:${r.id}`, kind: 'REVIEW', title: `계약 검토 희망일 — ${r.title}`, day: r.d, time: null, tab: 'lgl-reviews', overdue: r.d < today });
  return out.sort((a, b) => (a.day + (a.time ?? '')).localeCompare(b.day + (b.time ?? '')));
}

/** GET /admin/legal/due?days= — 지난 것(30일 안) + 앞으로 N일(1 ~ 365 · 처음 60) */
export async function legalDue(db: DatabaseService, daysIn?: string) {
  const n = Number(daysIn);
  const days = Number.isInteger(n) && n >= 1 && n <= 365 ? n : 60;
  const today = kstToday();
  const from = new Date(Date.parse(today) - 30 * 86400e3).toISOString().slice(0, 10);
  const to = new Date(Date.parse(today) + days * 86400e3).toISOString().slice(0, 10);
  const items = await legalDueItems(db, from, to);
  return { from, to, days, items, overdue: items.filter((x) => x.overdue).length,
           note: '인허가 갱신 · 사건 기일 · 보험 만기 · 계약 검토 희망일을 한 줄로 모았습니다 — 사내 일정(사무 › 사내 일정)에도 같은 항목이 보입니다(㉜ 합친 뒤).' };
}

import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { csxMail } from '../csx/mail-templates';   // v10.530 (D280) 메일 문구 템플릿

/* ---------------------------------------------------------------------
 * v10.519 (D277 · docs/657) 광고 성과 보고서 — 광고주별 기간(하루 · 주 · 달) 노출 · 클릭 · 비용
 *   새 추적 없음: 노출 · 클릭 = 기존 ad_events(과금 근거 · 고치지 않음) · 비용 = 기존 ad_invoices(VOID 뺌 · 그 기간에 걸친 날수로 나눔).
 *   소재 → 광고주: prx_ad_owner(운영자가 이음) · 없으면 소재의 광고주 이름 = 광고주 이름(대소문자 · 앞뒤 빈칸 무시).
 *   숫자만 — 회원 · 세그먼트 · 연락처는 보고서에 넣지 않음(v_ad_stats_for_advertiser 와 같은 원칙).
 *   대표 11/20 「법무 확인 · 메일 허용 · 매일 허용」:
 *     · 보내는 주기 prx.ad_report_cycle = DAILY(어제 하루) · WEEKLY(지난주 월 ~ 일) · MONTHLY(지난달 · 처음 값)
 *     · 기간 열쇠 period_key — DAILY '2026-11-19' · WEEKLY 'W2026-11-16'(그 주 월요일) · MONTHLY '2026-10' · 광고주마다 한 줄(UNIQUE) = 같은 기간 두 번 안 보냄
 *     · 메일 prx.ad_report_mail 은 처음 off 그대로 · 켜기는 운영 화면에서 SUPER(메일 준비가 된 뒤) · 기존 메일 길(MailService.ready · send) · 보낸 주소는 가린 값만
 *   인쇄 PDF: 운영 화면이 printDoc(openPrint)로 그림(서버 PDF 라이브러리 없음).
 *   정기 작업 prx_ad_report — 매일 08:10 · 주기의 지난 기간 보고서가 없는 광고주만 만듦 · 스위치 on 이면 아직 안 보낸 것 메일.
 * ------------------------------------------------------------------- */

export interface Mailer { ready(): Promise<boolean>; send(m: { to: string; subject: string; text: string }): Promise<{ ok: boolean; error?: string; errorKind?: string }> }

export const REPORT_CYCLES = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;
export type ReportCycle = (typeof REPORT_CYCLES)[number];
/** DB CHECK(prx_ad_reports.period_key)와 같은 정규식 */
export const PERIOD_KEY_RE = /^(W?20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])|20[0-9]{2}-(0[1-9]|1[0-2]))$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const mask = (e: string) => { const [u, d] = e.split('@'); return `${(u ?? '').slice(0, 2)}***@${d ?? ''}`; };
const won = (x: number) => Math.round(x).toLocaleString('ko-KR');
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => ymd(new Date(Date.parse(`${s}T00:00:00Z`) + n * 86400e3));

export interface ReportPeriod { cycle: ReportCycle; key: string; from: string; to: string; label: string }

/** 기간 열쇠 → 주기 · 첫날 · 끝날(포함) · 이름 — 바르지 않으면 422 */
export function parsePeriod(key: string): ReportPeriod {
  const k = String(key ?? '').trim();
  if (!PERIOD_KEY_RE.test(k)) throw new PolicyViolation('PRX_PERIOD', '기간은 2026-11-19(하루) · W2026-11-16(그 주 월요일) · 2026-10(달) 모양입니다.');
  if (k.length === 7) {
    const [y, m] = k.split('-').map(Number) as [number, number];
    const from = `${k}-01`, to = ymd(new Date(Date.UTC(y, m, 0)));
    return { cycle: 'MONTHLY', key: k, from, to, label: `${k}(달)` };
  }
  const day = k.startsWith('W') ? k.slice(1) : k;
  const t = Date.parse(`${day}T00:00:00Z`);
  if (isNaN(t) || ymd(new Date(t)) !== day) throw new PolicyViolation('PRX_PERIOD', '없는 날짜입니다.');
  if (k.startsWith('W')) {
    if (new Date(t).getUTCDay() !== 1) throw new PolicyViolation('PRX_PERIOD', '주 보고서는 그 주 월요일 날짜로 적습니다(W2026-11-16).');
    return { cycle: 'WEEKLY', key: k, from: day, to: addDays(day, 6), label: `${day} ~ ${addDays(day, 6)}(주)` };
  }
  return { cycle: 'DAILY', key: k, from: day, to: day, label: `${day}(하루)` };
}

/** 주기의 「지난 기간」 열쇠(한국 날짜 기준) — DAILY 어제 · WEEKLY 지난주 월요일 · MONTHLY 지난달 */
export function lastPeriodKey(cycle: ReportCycle, now = Date.now()) {
  const today = ymd(new Date(now + 9 * 3600e3));
  if (cycle === 'DAILY') return addDays(today, -1);
  if (cycle === 'WEEKLY') {
    const dow = new Date(`${today}T00:00:00Z`).getUTCDay();   // 0 = 일
    return `W${addDays(today, -((dow + 6) % 7) - 7)}`;
  }
  const [y, m] = today.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

async function reportSettings(db: DatabaseService) {
  const s = await db.query<{ key: string; value: string | null }>(`SELECT key, value FROM site_settings WHERE key IN ('prx.ad_report_mail', 'prx.ad_report_cycle')`);
  const v = (k: string) => s.find((x) => x.key === k)?.value ?? null;
  const c = v('prx.ad_report_cycle');
  return { mailOn: v('prx.ad_report_mail') === 'on', cycle: ((REPORT_CYCLES as readonly string[]).includes(c ?? '') ? c : 'MONTHLY') as ReportCycle };
}

/** 클릭률 · 클릭당 · 천 회 노출당 */
export function rates(impr: number, clicks: number, cost: number) {
  return {
    ctr: impr ? Math.round((10000 * clicks) / impr) / 100 : null,
    cpc: clicks ? Math.round(cost / clicks) : null,
    cpm: impr ? Math.round((1000 * cost) / impr) : null,
  };
}

/** 소재 → 광고주(이은 것 먼저 · 없으면 이름) */
async function creatives(db: DatabaseService) {
  return db.query<{ id: string; code: string | null; advertiser: string | null; slot: string | null; adv: string | null; linked: boolean }>(
    `SELECT p.id::text AS id, p.creative_code AS code, p.advertiser, p.slot_code AS slot,
            coalesce(o.advertiser_id, (SELECT a.id FROM advertisers a WHERE p.advertiser IS NOT NULL AND lower(btrim(a.name)) = lower(btrim(p.advertiser))
                                        ORDER BY a.created_at LIMIT 1))::text AS adv,
            (o.advertiser_id IS NOT NULL) AS linked
       FROM ad_placements p LEFT JOIN prx_ad_owner o ON o.creative_id = p.id
      ORDER BY p.creative_code NULLS LAST`);
}

/** 한 광고주 · 한 기간 숫자(저장 안 함) — 기간은 한국 날짜 첫날 0시 ~ 끝날 다음 날 0시 */
export async function computeReport(db: DatabaseService, advertiserId: string, p: ReportPeriod) {
  const mine = (await creatives(db)).filter((c) => c.adv === advertiserId);
  const ids = mine.map((c) => c.id);
  const ev = ids.length ? await db.query<{ id: string; impr: string; clicks: string }>(
    `SELECT e.creative_id::text AS id,
            count(*) FILTER (WHERE e.event_type = 'IMPRESSION') AS impr,
            count(*) FILTER (WHERE e.event_type = 'CLICK') AS clicks
       FROM ad_events e
      WHERE e.creative_id = ANY($1::uuid[])
        AND e.occurred_at >= ($2::date)::timestamp AT TIME ZONE 'Asia/Seoul'
        AND e.occurred_at <  ($3::date + 1)::timestamp AT TIME ZONE 'Asia/Seoul'
      GROUP BY e.creative_id`, [ids, p.from, p.to]) : [];
  const [c] = await db.query<{ cost: string; total: string; n: number }>(
    `SELECT coalesce(sum(round(i.amount::numeric * (least(i.period_to, $3::date) - greatest(i.period_from, $2::date) + 1) / (i.period_to - i.period_from + 1))), 0) AS cost,
            coalesce(sum(round(i.total::numeric  * (least(i.period_to, $3::date) - greatest(i.period_from, $2::date) + 1) / (i.period_to - i.period_from + 1))), 0) AS total,
            count(*)::int AS n
       FROM ad_invoices i
      WHERE i.advertiser_id = $1::uuid AND i.status <> 'VOID' AND i.period_from <= $3::date AND i.period_to >= $2::date`, [advertiserId, p.from, p.to]);
  const by = new Map(ev.map((x) => [x.id, x]));
  const lines = mine.map((m) => {
    const x = by.get(m.id);
    const impr = Number(x?.impr ?? 0), clicks = Number(x?.clicks ?? 0);
    return { code: m.code, slot: m.slot, impressions: impr, clicks, ctr: rates(impr, clicks, 0).ctr };
  }).filter((l) => l.impressions || l.clicks);
  const impressions = lines.reduce((s, l) => s + l.impressions, 0), clicks = lines.reduce((s, l) => s + l.clicks, 0);
  return { impressions, clicks, cost: Number(c?.cost ?? 0), costTotal: Number(c?.total ?? 0), invoices: c?.n ?? 0, lines, creatives: mine.length };
}

/** 보고서 만들기(이미 보낸 것은 그대로) — advertiserId 없으면 그 기간에 숫자가 있는 모든 광고주 · onlyMissing 이면 없는 것만 */
export async function makeReports(db: DatabaseService, key: string, advertiserId?: string | null, onlyMissing = false) {
  const p = parsePeriod(key);
  if (p.from > ymd(new Date(Date.now() + 9 * 3600e3))) throw new PolicyViolation('PRX_PERIOD', '아직 시작하지 않은 기간입니다.');
  if (advertiserId && !UUID_RE.test(advertiserId)) throw new NotFound('없는 광고주입니다.');
  const advs = await db.query<{ id: string; has: boolean }>(
    `SELECT a.id::text AS id, EXISTS (SELECT 1 FROM prx_ad_reports r WHERE r.advertiser_id = a.id AND r.period_key = $2) AS has
       FROM advertisers a WHERE ($1::uuid IS NULL OR a.id = $1::uuid) ORDER BY a.name`, [advertiserId ?? null, p.key]);
  if (advertiserId && !advs.length) throw new NotFound('없는 광고주입니다.');
  const me = RequestCtx.actorId() ?? null;
  let made = 0, kept = 0, empty = 0;
  for (const a of advs) {
    if (onlyMissing && a.has) { kept++; continue; }
    const r = await computeReport(db, a.id, p);
    if (!advertiserId && !r.impressions && !r.clicks && !r.cost) { empty++; continue; }
    const up = await db.query(
      `INSERT INTO prx_ad_reports (advertiser_id, cycle, period_key, period_from, period_to, impressions, clicks, cost, cost_total, lines, made_by)
       VALUES ($1::uuid, $2, $3, $4::date, $5::date, $6::bigint, $7::bigint, $8::bigint, $9::bigint, $10::jsonb, $11)
       ON CONFLICT (advertiser_id, period_key) DO UPDATE SET impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks, cost = EXCLUDED.cost,
              cost_total = EXCLUDED.cost_total, lines = EXCLUDED.lines, made_at = now(), made_by = EXCLUDED.made_by
        WHERE prx_ad_reports.mail_state IS DISTINCT FROM 'SENT'
       RETURNING id`,
      [a.id, p.cycle, p.key, p.from, p.to, r.impressions, r.clicks, r.cost, r.costTotal, JSON.stringify(r.lines), me]);
    if (up.length) made++; else kept++;
  }
  return { ok: true, period: p.key, cycle: p.cycle, made, kept, empty,
    note: `${p.label} 보고서 ${made}건을 만들었습니다(보낸 것 · 그대로 둔 것 ${kept} · 숫자 없음 ${empty}).` };
}

/** GET /admin/prx/ad-reports?period= — 비우면 지금 주기의 지난 기간 */
export async function listReports(db: DatabaseService, keyIn?: string) {
  const st = await reportSettings(db);
  const p = parsePeriod(keyIn && PERIOD_KEY_RE.test(keyIn) ? keyIn : lastPeriodKey(st.cycle));
  const rows = await db.query<Record<string, any>>(
    `SELECT r.id::text AS id, r.advertiser_id::text AS "advertiserId", a.name AS advertiser, a.code, r.cycle, r.period_key AS period,
            r.impressions, r.clicks, r.cost, r.cost_total AS "costTotal",
            r.made_at AS "madeAt", r.mail_state AS "mailState", r.mailed_at AS "mailedAt", r.to_masked AS "to",
            (a.contact_email IS NOT NULL AND a.contact_email <> '') AS "hasMail"
       FROM prx_ad_reports r JOIN advertisers a ON a.id = r.advertiser_id WHERE r.period_key = $1 ORDER BY a.name`, [p.key]);
  for (const r of rows) Object.assign(r, rates(Number(r.impressions), Number(r.clicks), Number(r.cost)));
  const cr = await creatives(db);
  const advs = await db.query<{ id: string; name: string; code: string }>(`SELECT id::text AS id, name, code FROM advertisers ORDER BY name`);
  return {
    period: p.key, cycle: p.cycle, label: p.label, settings: st, lastKeys: { DAILY: lastPeriodKey('DAILY'), WEEKLY: lastPeriodKey('WEEKLY'), MONTHLY: lastPeriodKey('MONTHLY') },
    items: rows, advertisers: advs,
    creatives: cr.map((c) => ({ id: c.id, code: c.code, advertiser: c.advertiser, slot: c.slot, advertiserId: c.adv, linked: c.linked })),
    unlinked: cr.filter((c) => !c.adv).length,
    note: '노출 · 클릭은 광고 기록(ad_events), 비용은 청구서를 그 기간에 걸친 날수로 나눈 값입니다. 광고주를 찾지 못한 소재는 보고서에 들어가지 않습니다 — 아래에서 이어 주십시오.',
  };
}

/** GET /admin/prx/ad-reports/{id} — 인쇄 · 미리 보기 */
export async function reportDetail(db: DatabaseService, id: string) {
  if (!/^\d{1,18}$/.test(id)) throw new NotFound('없는 보고서입니다.');
  const [r] = await db.query<Record<string, any>>(
    `SELECT r.id::text AS id, r.cycle, r.period_key AS period, a.name AS advertiser, a.code, a.biz_reg_no AS "bizRegNo", r.impressions, r.clicks, r.cost, r.cost_total AS "costTotal", r.lines,
            r.made_at AS "madeAt", r.mail_state AS "mailState", r.mailed_at AS "mailedAt", r.to_masked AS "to"
       FROM prx_ad_reports r JOIN advertisers a ON a.id = r.advertiser_id WHERE r.id = $1::bigint`, [id]);
  if (!r) throw new NotFound('없는 보고서입니다.');
  const label = parsePeriod(String(r.period)).label;
  return { ...r, label, ...rates(Number(r.impressions), Number(r.clicks), Number(r.cost)), mailText: mailText(r, label) };
}

function mailText(r: Record<string, any>, label: string) {
  const x = rates(Number(r.impressions), Number(r.clicks), Number(r.cost));
  const lines = (Array.isArray(r.lines) ? r.lines : []) as Array<{ code: string | null; slot: string | null; impressions: number; clicks: number; ctr: number | null }>;
  return [
    `${r.advertiser} 담당자님께`, '',
    `${label} 소개뱅크 광고 성과를 알려 드립니다.`, '',
    `· 노출 ${won(Number(r.impressions))}회 · 클릭 ${won(Number(r.clicks))}회 · 클릭률 ${x.ctr ?? '-'}`,
    `· 광고비(그 기간 몫 · 부가세 별도) ${won(Number(r.cost))}원 · 부가세 포함 ${won(Number(r.costTotal))}원`,
    `· 클릭당 ${x.cpc == null ? '-' : won(x.cpc) + '원'} · 노출 천 회당 ${x.cpm == null ? '-' : won(x.cpm) + '원'}`, '',
    '소재별', ...lines.map((l) => `  ${l.code ?? '-'} (${l.slot ?? '-'}) 노출 ${won(l.impressions)} · 클릭 ${won(l.clicks)} · 클릭률 ${l.ctr ?? '-'}`), '',
    '숫자는 소개뱅크 광고 기록과 청구서로 셈했으며, 이용자 개인 정보는 들어 있지 않습니다.',
    '궁금한 점은 이 메일에 답장 주십시오.',
  ].join('\n');
}

/** POST /admin/prx/ad-reports/{id}/send — 지금 보내기(SUPER) · 정기 작업도 같은 길 · 같은 기간 두 번 안 보냄 */
export async function sendReport(db: DatabaseService, mail: Mailer, id: string) {
  const r = (await reportDetail(db, id)) as Record<string, any>;   // 보고서 줄 + 셈 칸(mailState · advertiser · label · mailText)
  if (r.mailState === 'SENT') throw new StateConflict('PRX_REPORT_SENT', '이미 보낸 보고서입니다.');
  const [st] = await db.query<{ sw: string | null; email: string | null }>(
    `SELECT (SELECT value FROM site_settings WHERE key = 'prx.ad_report_mail') AS sw, nullif(btrim(a.contact_email), '') AS email
       FROM prx_ad_reports x JOIN advertisers a ON a.id = x.advertiser_id WHERE x.id = $1::bigint`, [id]);
  const mark = (state: string, to: string | null) => db.query(
    `UPDATE prx_ad_reports SET mail_state = $2, mailed_at = CASE WHEN $2 = 'SENT' THEN now() ELSE mailed_at END, to_masked = $3
      WHERE id = $1::bigint AND mail_state IS DISTINCT FROM 'SENT' RETURNING id`, [id, state, to]);
  if (st?.sw !== 'on') throw new StateConflict('PRX_MAIL_OFF', '광고 성과 보고서 메일이 꺼져 있습니다(prx.ad_report_mail) — 인쇄 PDF 로 전달하거나 메일을 켜십시오.');
  if (!st?.email) { await mark('NO_ADDRESS', null); return { ok: false, result: 'NO_ADDRESS', note: '광고주 담당 메일이 없습니다(광고 과금 › 광고주).' }; }
  if (!(await mail.ready())) { await mark('NOT_READY', mask(st.email)); return { ok: false, result: 'NOT_READY', note: '메일 준비가 되지 않았습니다(보내는 주소 · 설정).' }; }
  const tm = await csxMail(db, 'AD_REPORT', { label: r.label, advertiser: r.advertiser, report: String(r.mailText) },
    { subject: `[소개뱅크] ${r.label} 광고 성과 보고서 — ${r.advertiser}`, text: String(r.mailText) });   // v10.530 (D280)
  const res = await mail.send({ to: st.email, subject: tm.subject, text: tm.text });
  await mark(res.ok ? 'SENT' : 'FAILED', mask(st.email));
  return { ok: res.ok, result: res.ok ? 'SENT' : 'FAILED', note: res.ok ? `${r.advertiser} 에 ${r.label} 보고서를 보냈습니다.` : '메일을 보내지 못했습니다.' };
}

/** PUT /admin/prx/ad-owners/{creativeId} — 소재 → 광고주 잇기(빈 값이면 끊음 → 이름으로) */
export async function setOwner(db: DatabaseService, creativeId: string, advertiserId: string | null) {
  if (!UUID_RE.test(creativeId)) throw new NotFound('없는 광고 소재입니다.');
  const [p] = await db.query(`SELECT 1 FROM ad_placements WHERE id = $1::uuid`, [creativeId]);
  if (!p) throw new NotFound('없는 광고 소재입니다.');
  if (!advertiserId) {
    await db.query(`DELETE FROM prx_ad_owner WHERE creative_id = $1::uuid`, [creativeId]);
    return { ok: true, note: '이음을 끊었습니다 — 소재의 광고주 이름으로 찾습니다.' };
  }
  if (!UUID_RE.test(advertiserId)) throw new NotFound('없는 광고주입니다.');
  const [a] = await db.query(`SELECT 1 FROM advertisers WHERE id = $1::uuid`, [advertiserId]);
  if (!a) throw new NotFound('없는 광고주입니다.');
  await db.query(
    `INSERT INTO prx_ad_owner (creative_id, advertiser_id, set_by) VALUES ($1::uuid, $2::uuid, $3)
     ON CONFLICT (creative_id) DO UPDATE SET advertiser_id = EXCLUDED.advertiser_id, set_by = EXCLUDED.set_by, set_at = now()`,
    [creativeId, advertiserId, RequestCtx.actorId() ?? null]);
  return { ok: true, note: '소재를 광고주에 이었습니다 — 다음에 만드는 보고서부터 들어갑니다.' };
}

/** PUT /admin/prx/ad-reports/switch — 메일 켜기 · 끄기 · 보내는 주기(SUPER · 사유) */
export async function setReportSettings(db: DatabaseService, d: { on?: boolean; cycle?: string; reason: string }) {
  const why = String(d.reason ?? '').replace(/\s+/g, ' ').trim();
  if (why.length < 2 || why.length > 200) throw new PolicyViolation('PRX_REASON', '사유는 2 ~ 200자입니다.');
  const set: Array<[string, string]> = [];
  if (d.on !== undefined) set.push(['prx.ad_report_mail', d.on ? 'on' : 'off']);
  if (d.cycle !== undefined) {
    if (!(REPORT_CYCLES as readonly string[]).includes(d.cycle)) throw new PolicyViolation('PRX_CYCLE', '주기는 DAILY · WEEKLY · MONTHLY 중 하나입니다.');
    set.push(['prx.ad_report_cycle', d.cycle]);
  }
  if (!set.length) throw new PolicyViolation('PRX_NOTHING', '바꿀 것이 없습니다.');
  await db.transaction(async () => {
    await db.query(`SELECT set_config('app.setting_reason', $1, true)`, [why]);
    for (const [k, v] of set) await db.query(`UPDATE site_settings SET value = $2, updated_by = $3, updated_at = now() WHERE key = $1`, [k, v, RequestCtx.actorId() ?? null]);
  });
  const st = await reportSettings(db);
  return { ok: true, ...st, note: '보고서 설정(메일 · 보내는 주기)을 바꿨습니다.' };
}

/** 정기 작업 prx_ad_report(매일 08:10) — 주기의 지난 기간 없는 보고서 만들기 · 스위치 on 이면 아직 안 보낸 것 */
export async function adReportJob(db: DatabaseService, mail: Mailer) {
  const st = await reportSettings(db);
  const key = lastPeriodKey(st.cycle);
  const m = await makeReports(db, key, null, true);
  if (!st.mailOn) return { cycle: st.cycle, period: key, made: m.made, on: false, sent: 0, failed: 0 };
  const todo = await db.query<{ id: string }>(`SELECT id::text AS id FROM prx_ad_reports WHERE period_key = $1 AND mail_state IS NULL ORDER BY id LIMIT 200`, [key]);
  let sent = 0, failed = 0;
  for (const t of todo) {
    const r = await sendReport(db, mail, t.id).catch(() => ({ ok: false }));
    if (r.ok) sent++; else failed++;
  }
  return { cycle: st.cycle, period: key, made: m.made, on: true, sent, failed };
}

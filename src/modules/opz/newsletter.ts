import { DatabaseService } from '../../db/database.service';
import { Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { MailService } from '../../common/mail/mail.service';
import {
  campaignAudience, campaignSettings, cancelCampaign, createCampaign, renderCampaign, sendCampaign, testCampaign, updateCampaign,
} from '../marketing/campaign';
import { renderMailTemplate } from '../csx/mail-render';   // ㊿ (D280 · b280) 메일 문구 템플릿 채우기 — 한 번만 바꿈 · 제목 줄바꿈 없앰
import { OPZ_YM_RE, opzAudit, opzSettings, opzYm } from './opz-settings';

/* ---------------------------------------------------------------------
 * v10.556 (D288 · docs/694) 월간 뉴스레터 — 대표 11/21 「(58) ① 뉴스레터」
 *
 *   달마다 한 호(opz_nl_issues · 취소한 호 빼고 한 달 하나) — 공지 · 인기 매물 · 이벤트 후보를 서버가 골라 두고(처음 opz.nl_items 개씩)
 *   운영자가 고르고 · 틀(자리값 글)을 고치고 · 미리보기(광고 표기 · 보낸 곳 · 수신 거부 자리까지) · 나에게 시험 → SUPER 가 보내기.
 *
 *   ★ 새 발송 길을 만들지 않음 — 보내기 · 시험은 ㊳ 캠페인(D268 · src/modules/marketing/campaign.ts)에 EMAIL · 대상 ALL 캠페인 한 줄로 넘김:
 *     · 받는 사람 = 마케팅 수신 동의 유효 · 2년 넘은 동의 뺌 · 반송 · 수신 거부 주소 뺌 · 21 ~ 8시는 야간 동의자만(그쪽 서버 · DB 트리거)
 *     · 제목 앞 「(광고)」 · 끝에 보낸 곳 · 연락처 · 무료 수신 거부 링크(그쪽 renderCampaign) · campaign.enabled · campaign.send_mode(처음 ASSUME) 그대로
 *     · 그래서 이 화면의 스위치(opz.nl_enabled · 처음 off)와 캠페인 스위치가 모두 켜져야 실제로 나감
 *   ★ 틀 채우기는 ㊿ 메일 문구 템플릿의 renderMailTemplate 재사용(자리값 {month} {intro} {notices} {listings} {events} {base} · 한 번만 바꿈)
 *     틀 검사(checkNlFrame) = DB CHECK opz_nl_issues.frame(10 ~ 1,200자 · 주소 직접 쓰기 금지 https?://) + 자리값 · 중괄호 · 수신 거부 글 금지
 *   ★ 본문(채운 틀)은 캠페인 글 한도와 같은 2,000자 — 넘으면 저장은 하되 본문 없음(시험 · 보내기 막음 OPZ_NL_LONG)
 *   공지는 손님에게도 보이는 것만(fn_notice_grades(NULL) · 관리자 등급 뺌) · 매물은 게시 중 · 켜진 관 · 최근 opz.nl_listing_days 일 · 이벤트는 게시 중 · 안 끝남
 * ------------------------------------------------------------------- */

export const NL_VARS = ['month', 'intro', 'notices', 'listings', 'events', 'base'] as const;
export const NL_FRAME_MIN = 10;
export const NL_FRAME_MAX = 1200;
export const NL_BODY_MAX = 2000;                       // DB CHECK opz_nl_issues.body · mkt_campaigns.body 와 같음
export const NL_URL_RE = /https?:\/\//i;               // DB CHECK frame !~* 'https?://' 와 같음
const TOKEN_G = /\{([a-z_]+)\}/g;
const OPTOUT_RE = /무료\s*거부|수신\s*거부/;

export const NL_FRAME_DEFAULT = [
  '{intro}',
  '',
  '■ 이달의 공지',
  '{notices}',
  '',
  '■ 인기 매물',
  '{listings}',
  '',
  '■ 진행 중인 이벤트',
  '{events}',
  '',
  '소개뱅크 바로 가기: {base}',
].join('\n');

const GWAN_PATH: Record<string, string> = { MNY: 'money', MAL: 'mall', BIZ: 'biz', HLT: 'health', LED: 'lead' };   // 사용자 웹 lib/format.ts GWAN_PATH 와 같음

/** 틀 검사 — 문제 글 목록(없으면 []) */
export function checkNlFrame(frame: string, intro = ''): string[] {
  const f = String(frame ?? ''), out: string[] = [];
  if (f.trim().length < NL_FRAME_MIN || f.length > NL_FRAME_MAX) out.push(`틀은 ${NL_FRAME_MIN} ~ ${NL_FRAME_MAX.toLocaleString('ko-KR')}자입니다.`);
  if (NL_URL_RE.test(f) || NL_URL_RE.test(intro)) out.push('주소(http · https)는 글에 직접 쓰지 말고 자리값으로만 넣습니다.');
  if (/[{}]/.test(f.replace(TOKEN_G, '')) || /[{}]/.test(intro)) out.push('중괄호는 틀의 자리값에만 씁니다.');
  const bad = [...new Set([...f.matchAll(TOKEN_G)].map((m) => m[1]!).filter((v) => !(NL_VARS as readonly string[]).includes(v)))];
  for (const v of bad) out.push(`쓸 수 없는 자리값이 있습니다 — ${v}`);
  if (OPTOUT_RE.test(f) || OPTOUT_RE.test(intro)) out.push('수신 거부 안내는 보낼 때 서버가 끝에 붙입니다 — 글에서 빼 주십시오.');
  return out;
}

export interface NlNotice { id: string; title: string; publishedAt: string }
export interface NlListing { id: string; title: string; gwanCode: string; gwanName: string; viewCount: number; likeCount: number }
export interface NlEvent { id: string; title: string; startsAt: string; endsAt: string }

const NOTICE_SQL = `
  SELECT n.id::text AS id, n.title, n.published_at AS "publishedAt"
    FROM notices n
   WHERE n.published_at IS NOT NULL AND n.published_at <= now() AND (n.ends_at IS NULL OR n.ends_at > now())
     AND n.grades && array_remove(public.fn_notice_grades(NULL::uuid), 'STAFF')
     AND ($1::uuid[] IS NULL OR n.id = ANY($1::uuid[]))
     AND ($1::uuid[] IS NOT NULL OR n.published_at > now() - interval '62 days')
   ORDER BY n.is_pinned DESC, n.published_at DESC LIMIT 20`;
const LISTING_SQL = `
  SELECT l.id::text AS id, l.title, l.gwan_code AS "gwanCode", g.name AS "gwanName", l.view_count::int AS "viewCount", l.like_count::int AS "likeCount"
    FROM listings l JOIN gwans g ON g.code = l.gwan_code AND g.is_active
   WHERE l.status = 'PUBLISHED'
     AND ($1::uuid[] IS NULL OR l.id = ANY($1::uuid[]))
     AND ($1::uuid[] IS NOT NULL OR l.published_at > now() - make_interval(days => $2::int))
   ORDER BY (l.like_count::numeric * 1000000 + least(l.view_count, 999999)) DESC, l.published_at DESC LIMIT 20`;
const EVENT_SQL = `
  SELECT e.id::text AS id, e.title, e.starts_at AS "startsAt", e.ends_at AS "endsAt"
    FROM events e
   WHERE e.status = 'PUBLISHED' AND e.ends_at > now()
     AND ($1::uuid[] IS NULL OR e.id = ANY($1::uuid[]))
   ORDER BY e.starts_at, e.id LIMIT 20`;

async function candidates(db: DatabaseService, listingDays: number) {
  const [notices, listings, events] = await Promise.all([
    db.query<NlNotice>(NOTICE_SQL, [null]),
    db.query<NlListing>(LISTING_SQL, [null, listingDays]),
    db.query<NlEvent>(EVENT_SQL, [null]),
  ]);
  return { notices, listings, events };
}

/** 고른 것 — 지금도 보일 수 있는 것만 · 고른 차례 그대로 */
async function picked(db: DatabaseService, ids: { notices: string[]; listings: string[]; events: string[] }) {
  const order = <T extends { id: string }>(rows: T[], want: string[]) => want.map((id) => rows.find((r) => r.id === id)).filter((r): r is T => !!r);
  const [n, l, e] = await Promise.all([
    ids.notices.length ? db.query<NlNotice>(NOTICE_SQL, [ids.notices]) : Promise.resolve([] as NlNotice[]),
    ids.listings.length ? db.query<NlListing>(LISTING_SQL, [ids.listings, 90]) : Promise.resolve([] as NlListing[]),
    ids.events.length ? db.query<NlEvent>(EVENT_SQL, [ids.events]) : Promise.resolve([] as NlEvent[]),
  ]);
  return { notices: order(n, ids.notices), listings: order(l, ids.listings), events: order(e, ids.events) };
}

const oneLine = (s: string, max = 80) => { const t = String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/[{}]/g, '').trim(); return t.length > max ? `${t.slice(0, max - 1)}…` : t; };
const mmdd = (v: string | Date) => { const d = new Date(new Date(v).getTime() + 9 * 3600e3); return `${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCDate()).padStart(2, '0')}`; };
const EMPTY = '(이번 달은 없습니다)';

export interface NlRendered { text: string | null; length: number; tooLong: boolean; counts: { notices: number; listings: number; events: number } }

/** 틀 채우기 — renderMailTemplate(㊿) 재사용 · 주소는 서버가 만든 것만 */
export async function renderNl(db: DatabaseService, row: { ym: string; intro: string; frame: string; noticeIds: string[]; listingIds: string[]; eventIds: string[] }): Promise<NlRendered> {
  const base = (await campaignSettings(db)).baseUrl;
  const p = await picked(db, { notices: row.noticeIds, listings: row.listingIds, events: row.eventIds });
  const [y, m] = row.ym.split('-');
  const vars = {
    month: `${y}년 ${Number(m)}월`,
    intro: String(row.intro ?? '').replace(/\r/g, '').trim().slice(0, 500) || `소개뱅크 ${Number(m)}월 소식을 전해 드립니다.`,
    notices: p.notices.length ? p.notices.map((x) => `· ${oneLine(x.title)} — ${base}/community?board=NOTICE#n-${x.id}`).join('\n') : EMPTY,
    listings: p.listings.length ? p.listings.map((x) => `· [${oneLine(x.gwanName, 20)}] ${oneLine(x.title)} — ${base}/${GWAN_PATH[x.gwanCode] ?? 'money'}/${x.id}`).join('\n') : EMPTY,
    events: p.events.length ? p.events.map((x) => `· ${oneLine(x.title)} (${mmdd(x.startsAt)} ~ ${mmdd(x.endsAt)}) — ${base}/money/event`).join('\n') : EMPTY,
    base,
  };
  const text = renderMailTemplate('뉴스레터', row.frame, vars).text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  const tooLong = text.length > NL_BODY_MAX;
  return { text: tooLong || text.length < 10 ? null : text, length: text.length, tooLong, counts: { notices: p.notices.length, listings: p.listings.length, events: p.events.length } };
}

export interface IssueRow {
  id: string; ym: string; title: string; subject: string; intro: string; frame: string; noticeIds: string[]; listingIds: string[]; eventIds: string[];
  body: string | null; state: 'DRAFT' | 'QUEUED' | 'CANCELED'; campaignId: string | null;
}

async function issueRow(db: DatabaseService, id: string): Promise<IssueRow> {
  if (!/^\d{1,18}$/.test(String(id))) throw new NotFound('없는 뉴스레터입니다.');
  const [r] = await db.query<IssueRow>(
    `SELECT id::text AS id, ym, title, subject, intro, frame, notice_ids::text[] AS "noticeIds", listing_ids::text[] AS "listingIds", event_ids::text[] AS "eventIds",
            body, state, campaign_id::text AS "campaignId"
       FROM opz_nl_issues WHERE id = $1::bigint`, [id]);
  if (!r) throw new NotFound('없는 뉴스레터입니다.');
  return r;
}

/* ── 운영 화면 ── */
export async function listNl(db: DatabaseService) {
  const s = await opzSettings(db);
  const cs = await campaignSettings(db);
  const items = await db.query(
    `SELECT i.id::text AS id, i.ym, i.title, i.state, i.campaign_id::text AS "campaignId", i.created_at AS "createdAt", i.queued_at AS "queuedAt",
            c.state AS "campaignState", c.send_mode AS "sendMode", c.finished_at AS "finishedAt",
            x.total, x.sent, x.assumed, x.skipped, x.failed,
            (SELECT count(*)::int FROM mkt_unsubscribes u WHERE u.campaign_id = i.campaign_id) AS unsubscribed
       FROM opz_nl_issues i
       LEFT JOIN mkt_campaigns c ON c.id = i.campaign_id
       LEFT JOIN LATERAL (SELECT count(*) FILTER (WHERE NOT s.test)::int AS total,
                                 count(*) FILTER (WHERE NOT s.test AND s.state = 'SENT')::int AS sent,
                                 count(*) FILTER (WHERE NOT s.test AND s.state = 'ASSUMED')::int AS assumed,
                                 count(*) FILTER (WHERE NOT s.test AND s.state = 'SKIPPED')::int AS skipped,
                                 count(*) FILTER (WHERE NOT s.test AND s.state = 'FAILED')::int AS failed
                            FROM mkt_campaign_sends s WHERE s.campaign_id = i.campaign_id) x ON true
      ORDER BY i.ym DESC, i.id DESC LIMIT 36`);
  return {
    settings: s, ym: opzYm(), items,
    campaign: { enabled: cs.enabled, mode: cs.mode, contactSet: !!cs.contact },
    canSend: RequestCtx.get()?.actorRole === 'SUPER',
    note: '보내기는 문자 · 메일 캠페인(마케팅 동의자 · (광고) · 수신 거부)으로 넘깁니다. 이 스위치와 캠페인 스위치가 모두 켜져야 실제로 나갑니다.',
  };
}

export async function nlDetail(db: DatabaseService, id: string) {
  const r = await issueRow(db, id);
  const s = await opzSettings(db);
  const cs = await campaignSettings(db);
  const [cand, rendered] = await Promise.all([candidates(db, s.nlListingDays), renderNl(db, r)]);
  const mark = <T extends { id: string }>(rows: T[], ids: string[]) => rows.map((x) => ({ ...x, picked: ids.includes(x.id) }));
  const [camp] = r.campaignId ? await db.query<{ state: string; sendMode: string | null; queuedAt: string | null; finishedAt: string | null; lastNote: string | null }>(
    `SELECT state, send_mode AS "sendMode", queued_at AS "queuedAt", finished_at AS "finishedAt", last_note AS "lastNote" FROM mkt_campaigns WHERE id = $1::bigint`, [r.campaignId]) : [];
  const audience = r.campaignId && camp?.state === 'DRAFT' ? await campaignAudience(db, r.campaignId).catch(() => null) : null;
  const preview = rendered.text ? renderCampaign({ channel: 'EMAIL', subject: r.subject, body: rendered.text }, cs, null) : null;
  return {
    issue: r, settings: s, campaign: camp ?? null, audience,
    candidates: { notices: mark(cand.notices, r.noticeIds), listings: mark(cand.listings, r.listingIds), events: mark(cand.events, r.eventIds) },
    rendered: { length: rendered.length, tooLong: rendered.tooLong, counts: rendered.counts, max: NL_BODY_MAX },
    preview, problems: checkNlFrame(r.frame, r.intro), vars: NL_VARS, frameDefault: NL_FRAME_DEFAULT,
    campaignReady: { enabled: cs.enabled, mode: cs.mode, contactSet: !!cs.contact },
    canSend: RequestCtx.get()?.actorRole === 'SUPER',
  };
}

const cleanIds = (v: unknown, code: string): string[] => {
  const list = [...new Set((Array.isArray(v) ? v : []).map((x) => String(x)))];
  if (list.length > 10) throw new PolicyViolation(code, '묶음마다 10개까지 고릅니다.');
  if (list.some((x) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x))) throw new PolicyViolation(code, '고른 항목 번호가 맞지 않습니다.');
  return list;
};

async function checkPicks(db: DatabaseService, ids: { notices: string[]; listings: string[]; events: string[] }) {
  const p = await picked(db, ids);
  if (p.notices.length !== ids.notices.length || p.listings.length !== ids.listings.length || p.events.length !== ids.events.length) {
    throw new PolicyViolation('OPZ_NL_PICK', '고를 수 없는 항목이 있습니다 — 게시 중인 공지(모두에게 보임) · 매물 · 이벤트만 고릅니다.');
  }
}

export async function createNl(db: DatabaseService, d: { ym?: string; title?: string }) {
  const ym = d.ym !== undefined ? String(d.ym) : opzYm();
  if (!OPZ_YM_RE.test(ym)) throw new PolicyViolation('OPZ_NL_YM', '달은 YYYY-MM 입니다.');
  const [dup] = await db.query(`SELECT 1 FROM opz_nl_issues WHERE ym = $1 AND state <> 'CANCELED'`, [ym]);
  if (dup) throw new StateConflict('OPZ_NL_EXISTS', '이 달 뉴스레터가 이미 있습니다 — 그 호를 고치거나 취소한 뒤 새로 만드십시오.');
  const s = await opzSettings(db);
  const m = Number(ym.slice(5));
  const title = d.title !== undefined ? String(d.title).replace(/\s+/g, ' ').trim() : `소개뱅크 ${m}월 소식`;
  if (title.length < 2 || title.length > 60) throw new PolicyViolation('OPZ_NL_TITLE', '호 이름은 2 ~ 60자입니다.');
  const cand = await candidates(db, s.nlListingDays);
  const row = {
    ym, intro: '', frame: NL_FRAME_DEFAULT,
    noticeIds: cand.notices.slice(0, s.nlItems).map((x) => x.id), listingIds: cand.listings.slice(0, s.nlItems).map((x) => x.id), eventIds: cand.events.slice(0, s.nlItems).map((x) => x.id),
  };
  const rd = await renderNl(db, row);
  const me = RequestCtx.actorId() ?? null;
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO opz_nl_issues (ym, title, subject, intro, frame, notice_ids, listing_ids, event_ids, body, created_by, updated_by)
     VALUES ($1, $2, $3, '', $4, $5::uuid[], $6::uuid[], $7::uuid[], $8, $9, $9) RETURNING id::text AS id`,
    [ym, title, `소개뱅크 ${m}월 소식`, row.frame, row.noticeIds, row.listingIds, row.eventIds, rd.text, me]);
  return { ok: true, id: r.id, length: rd.length, tooLong: rd.tooLong,
    note: rd.tooLong ? `초안을 만들었습니다 — 본문이 ${rd.length}자로 2,000자를 넘습니다. 고른 항목을 줄이십시오.` : '초안을 만들었습니다 — 고른 항목 · 틀을 확인하고 「나에게 시험」으로 보십시오.' };
}

export async function updateNl(db: DatabaseService, id: string, d: { title?: string; subject?: string; intro?: string; frame?: string; noticeIds?: string[]; listingIds?: string[]; eventIds?: string[] }) {
  const r = await issueRow(db, id);
  if (r.state !== 'DRAFT') throw new StateConflict('OPZ_NL_STATE', '초안일 때만 고칩니다(보냈거나 취소한 호는 새로 만드십시오).');
  /* DTO 의 빠진 칸은 undefined — 옛 값 위에 덮지 않음(규칙 11) */
  const title = d.title !== undefined ? String(d.title).replace(/\s+/g, ' ').trim() : r.title;
  const subject = d.subject !== undefined ? String(d.subject).replace(/[\r\n]+/g, ' ').trim() : r.subject;
  const intro = d.intro !== undefined ? String(d.intro).replace(/\r/g, '').trim() : r.intro;
  const frame = d.frame !== undefined ? String(d.frame).replace(/\r/g, '') : r.frame;
  const ids = {
    notices: d.noticeIds !== undefined ? cleanIds(d.noticeIds, 'OPZ_NL_PICK') : r.noticeIds,
    listings: d.listingIds !== undefined ? cleanIds(d.listingIds, 'OPZ_NL_PICK') : r.listingIds,
    events: d.eventIds !== undefined ? cleanIds(d.eventIds, 'OPZ_NL_PICK') : r.eventIds,
  };
  if (title.length < 2 || title.length > 60) throw new PolicyViolation('OPZ_NL_TITLE', '호 이름은 2 ~ 60자입니다.');
  if (subject.length < 1 || subject.length > 90) throw new PolicyViolation('OPZ_NL_SUBJECT', '메일 제목은 1 ~ 90자입니다(앞에 「(광고)」가 붙음).');
  if (intro.length > 500) throw new PolicyViolation('OPZ_NL_INTRO', '첫 인사는 500자까지입니다.');
  const problems = checkNlFrame(frame, intro);
  if (problems.length) throw new PolicyViolation('OPZ_NL_FRAME', problems[0]!, { problems });
  await checkPicks(db, ids);
  const rd = await renderNl(db, { ym: r.ym, intro, frame, noticeIds: ids.notices, listingIds: ids.listings, eventIds: ids.events });
  await db.query(
    `UPDATE opz_nl_issues SET title = $2, subject = $3, intro = $4, frame = $5, notice_ids = $6::uuid[], listing_ids = $7::uuid[], event_ids = $8::uuid[], body = $9, updated_by = $10
      WHERE id = $1::bigint AND state = 'DRAFT'`,
    [r.id, title, subject, intro, frame, ids.notices, ids.listings, ids.events, rd.text, RequestCtx.actorId() ?? null]);
  return { ok: true, id: r.id, length: rd.length, tooLong: rd.tooLong,
    note: rd.tooLong ? `저장했습니다 — 본문이 ${rd.length}자로 2,000자를 넘어 시험 · 보내기가 막힙니다. 고른 항목을 줄이십시오.` : '저장했습니다.' };
}

/** 캠페인 초안 맞추기 — 없거나 초안이 아니면(캠페인 화면에서 취소 등) 새로 만듦 · 초안이면 글을 고침 */
async function syncCampaign(db: DatabaseService, r: IssueRow, actor: string | null): Promise<string> {
  if (!r.body) throw new PolicyViolation('OPZ_NL_LONG', '본문이 비었거나 2,000자를 넘습니다 — 고른 항목 · 틀을 줄이십시오.');
  const title = `뉴스레터 ${r.ym} · ${r.title}`.slice(0, 80);
  if (r.campaignId) {
    const [c] = await db.query<{ state: string }>(`SELECT state FROM mkt_campaigns WHERE id = $1::bigint`, [r.campaignId]);
    if (c?.state === 'DRAFT') {
      await updateCampaign(db, r.campaignId, { title, subject: r.subject, body: r.body }, actor);
      return r.campaignId;
    }
  }
  const c = await createCampaign(db, { title, channel: 'EMAIL', subject: r.subject, body: r.body, audience: 'ALL' }, actor);
  await db.query(`UPDATE opz_nl_issues SET campaign_id = $2::bigint, updated_by = $3 WHERE id = $1::bigint AND state = 'DRAFT'`, [r.id, c.id, actor]);
  return c.id;
}

/** 나에게 시험 — 캠페인 시험 그대로(운영자 본인 메일 · 지금 방식 · ASSUME 이면 기록만 · 하루 20번) */
export async function testNl(db: DatabaseService, mail: MailService, id: string) {
  const r = await issueRow(db, id);
  if (r.state !== 'DRAFT') throw new StateConflict('OPZ_NL_STATE', '초안일 때만 시험합니다.');
  const actor = RequestCtx.actorId() ?? null;
  const campaignId = await syncCampaign(db, r, actor);
  const t = await testCampaign(db, mail, campaignId, actor);
  return { ...t, issueId: r.id, campaignId };
}

/** 보내기(SUPER) — 이 스위치 · 캠페인 보내기(켜짐 · 확인 「보내기」 · 법정 표기 · 방식 준비 · 받는 사람 고정 · 예약) */
export async function sendNl(db: DatabaseService, mail: MailService, id: string, d: { confirm?: string; scheduledAt?: string }) {
  const r = await issueRow(db, id);
  if (r.state !== 'DRAFT') throw new StateConflict('OPZ_NL_STATE', '초안만 보낼 수 있습니다.');
  const s = await opzSettings(db);
  if (!s.nlOn) throw new PolicyViolation('OPZ_NL_OFF', '뉴스레터 보내기가 꺼져 있습니다(opz.nl_enabled) — 최고 관리자가 설정에서 켜야 합니다.');
  const actor = RequestCtx.actorId() ?? null;
  const campaignId = await syncCampaign(db, r, actor);
  const out = await sendCampaign(db, mail, campaignId, { confirm: d.confirm, scheduledAt: d.scheduledAt }, actor);
  const [u] = await db.query(`UPDATE opz_nl_issues SET state = 'QUEUED', queued_by = $2, queued_at = now() WHERE id = $1::bigint AND state = 'DRAFT' RETURNING id`, [r.id, actor]);
  if (!u) throw new StateConflict('OPZ_NL_STATE', '다른 사람이 먼저 바꿨습니다 — 새로 고침 하십시오.');
  return { ...out, issueId: r.id, campaignId };
}

/** 취소 — 초안은 운영 관리자도 · 보낸(QUEUED) 호는 SUPER 만(캠페인을 함께 멈춤 · 이미 다 보낸 호는 못 취소) */
export async function cancelNl(db: DatabaseService, id: string, reasonIn: string) {
  const r = await issueRow(db, id);
  const why = String(reasonIn ?? '').replace(/\s+/g, ' ').trim();
  if (why.length < 2 || why.length > 200) throw new PolicyViolation('OPZ_NL_REASON', '취소 사유는 2 ~ 200자입니다.');
  if (r.state === 'CANCELED') throw new StateConflict('OPZ_NL_STATE', '이미 취소한 호입니다.');
  if (r.state === 'QUEUED' && RequestCtx.get()?.actorRole !== 'SUPER') throw new Forbidden('OPZ_NL_SUPER', '보낸 뉴스레터 취소는 최고 관리자만 합니다.');
  let stopped = 0;
  if (r.campaignId) {
    const [c] = await db.query<{ state: string }>(`SELECT state FROM mkt_campaigns WHERE id = $1::bigint`, [r.campaignId]);
    if (r.state === 'QUEUED' && c?.state === 'DONE') throw new StateConflict('OPZ_NL_DONE', '이미 다 보낸 뉴스레터는 취소하지 않습니다.');
    if (c && ['DRAFT', 'QUEUED', 'SENDING'].includes(c.state)) stopped = (await cancelCampaign(db, r.campaignId, `뉴스레터 취소 — ${why}`.slice(0, 200), RequestCtx.actorId() ?? null)).stopped;
  }
  const [u] = await db.query(`UPDATE opz_nl_issues SET state = 'CANCELED', canceled_at = now(), cancel_reason = $2 WHERE id = $1::bigint AND state <> 'CANCELED' RETURNING id`, [r.id, why]);
  if (!u) throw new StateConflict('OPZ_NL_STATE', '다른 사람이 먼저 바꿨습니다 — 새로 고침 하십시오.');
  await opzAudit(db, 'OPZ_NL_CANCEL_DONE', { issueId: r.id, ym: r.ym, was: r.state, stopped });
  return { ok: true, id: r.id, stopped, note: r.state === 'QUEUED' ? `취소했습니다 — 아직 안 보낸 ${stopped}명은 보내지 않습니다.` : '초안을 취소했습니다.' };
}

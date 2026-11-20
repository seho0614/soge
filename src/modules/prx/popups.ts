import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';

/* ---------------------------------------------------------------------
 * v10.517 (D277 · docs/655) 메인 팝업 공지
 *   운영(노출 › 메인 팝업): 제목 · 글 · 단추(주소 · 이름) · 기간 · 대상(GUEST · MEMBER · PARTNER) · 순서 · 켜기/끄기 · 미리 보기(화면이 그림)
 *   사용자 웹: GET /popups — 지금 기간 · 켜짐 · 내 대상에 맞는 것 · 순서(priority 작은 것 먼저 → 시작 늦은 것) · prx.popup_max 개까지
 *   「오늘 하루 안 보기」는 브라우저에만 적음(site/src/components/home/popupHide.ts) — 서버는 누가 닫았는지 모름(개인정보 새로 안 모음)
 * ------------------------------------------------------------------- */

export const POPUP_AUDIENCES = ['GUEST', 'MEMBER', 'PARTNER'] as const;
/** DB CHECK(ck · link_url)와 같은 정규식 */
export const POPUP_LINK_RE = /^(\/[A-Za-z0-9/_?=&#.-]{0,300}|https:\/\/[A-Za-z0-9.-]{3,100}(\/[A-Za-z0-9/_?=&#.%-]{0,300})?)$/;

export interface PopupInput {
  title: string; body?: string; linkUrl?: string; linkLabel?: string;
  audience: string[]; startsAt: string; endsAt: string; priority?: number;
}

function check(d: PopupInput) {
  const title = String(d.title ?? '').trim();
  if (title.length < 2 || title.length > 80) throw new PolicyViolation('PRX_POPUP', '제목은 2 ~ 80자입니다.');
  const body = String(d.body ?? '');
  if (body.length > 1000) throw new PolicyViolation('PRX_POPUP', '글은 1,000자까지입니다.');
  const link = (d.linkUrl ?? '').trim() || null;
  if (link && !POPUP_LINK_RE.test(link)) throw new PolicyViolation('PRX_POPUP_LINK', '단추 주소는 / 로 시작하는 사이트 안 주소나 https:// 주소입니다.');
  const label = (d.linkLabel ?? '').trim() || null;
  if (label && label.length > 20) throw new PolicyViolation('PRX_POPUP', '단추 이름은 20자까지입니다.');
  const aud = [...new Set((d.audience ?? []).map(String))];
  if (!aud.length || aud.some((a) => !(POPUP_AUDIENCES as readonly string[]).includes(a))) throw new PolicyViolation('PRX_POPUP_AUD', '대상을 하나 이상 고르십시오(비로그인 · 회원 · 파트너).');
  const s = new Date(d.startsAt), e = new Date(d.endsAt);
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e <= s) throw new PolicyViolation('PRX_POPUP_PERIOD', '끝 시각은 시작 시각보다 뒤여야 합니다.');
  if (e.getTime() - s.getTime() > 366 * 86400e3) throw new PolicyViolation('PRX_POPUP_PERIOD', '기간은 1년까지입니다.');
  const pr = d.priority ?? 100;
  if (!Number.isInteger(pr) || pr < 0 || pr > 999) throw new PolicyViolation('PRX_POPUP', '순서는 0 ~ 999 정수입니다(작을수록 먼저).');
  return { title, body, link, label, aud, s: s.toISOString(), e: e.toISOString(), pr };
}

/** GET /admin/prx/popups — 모두(지금 보이는 것 표시) */
export async function listPopups(db: DatabaseService) {
  const items = await db.query<Record<string, unknown>>(
    `SELECT id::text AS id, title, body, link_url AS "linkUrl", link_label AS "linkLabel", audience,
              starts_at AS "startsAt", ends_at AS "endsAt", priority, is_on AS "isOn", (is_on AND starts_at <= now() AND ends_at > now()) AS live, updated_at AS "updatedAt"
       FROM prx_popups ORDER BY (is_on AND ends_at > now()) DESC, priority, starts_at DESC, id DESC LIMIT 200`);
  const [m] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = 'prx.popup_max'`);
  return { items, max: Number(m?.v ?? 3) || 3, note: '순서가 작은 것부터 한 번에 최대 「max」 개 보입니다(설정 prx.popup_max). 「오늘 하루 안 보기」는 회원 브라우저에만 적힙니다.' };
}

/** POST /admin/prx/popups — 새로(처음 꺼짐) */
export async function addPopup(db: DatabaseService, d: PopupInput) {
  const c = check(d);
  const me = RequestCtx.actorId() ?? null;
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO prx_popups (title, body, link_url, link_label, audience, starts_at, ends_at, priority, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5::text[], $6::timestamptz, $7::timestamptz, $8::int, $9, $9) RETURNING id::text AS id`,
    [c.title, c.body, c.link, c.label, c.aud, c.s, c.e, c.pr, me]);
  return { ok: true, id: r!.id, note: '팝업을 만들었습니다(꺼진 채) — 미리 본 뒤 켜십시오.' };
}

/** PUT /admin/prx/popups/{id} */
export async function editPopup(db: DatabaseService, id: string, d: PopupInput) {
  if (!/^\d{1,18}$/.test(id)) throw new NotFound('없는 팝업입니다.');
  const c = check(d);
  const rows = await db.query(
    `UPDATE prx_popups SET title = $2, body = $3, link_url = $4, link_label = $5, audience = $6::text[], starts_at = $7::timestamptz, ends_at = $8::timestamptz,
            priority = $9::int, updated_by = $10, updated_at = now() WHERE id = $1::bigint RETURNING id`,
    [id, c.title, c.body, c.link, c.label, c.aud, c.s, c.e, c.pr, RequestCtx.actorId() ?? null]);
  if (!rows.length) throw new NotFound('없는 팝업입니다.');
  return { ok: true, note: '팝업을 고쳤습니다.' };
}

/** POST /admin/prx/popups/{id}/toggle — 켜기 · 끄기 */
export async function togglePopup(db: DatabaseService, id: string, on: boolean) {
  if (!/^\d{1,18}$/.test(id)) throw new NotFound('없는 팝업입니다.');
  const [p] = await db.query<{ ends_at: string; is_on: boolean }>(`SELECT ends_at, is_on FROM prx_popups WHERE id = $1::bigint`, [id]);
  if (!p) throw new NotFound('없는 팝업입니다.');
  if (on && new Date(p.ends_at) <= new Date()) throw new StateConflict('PRX_POPUP_ENDED', '끝 시각이 지난 팝업은 켤 수 없습니다 — 기간을 고친 뒤 켜십시오.');
  await db.query(`UPDATE prx_popups SET is_on = $2, updated_by = $3, updated_at = now() WHERE id = $1::bigint`, [id, !!on, RequestCtx.actorId() ?? null]);
  return { ok: true, isOn: !!on, note: on ? '팝업을 켰습니다(기간 안이면 바로 보입니다).' : '팝업을 껐습니다.' };
}

/** GET /popups — 사용자 웹 메인(보는 사람 기준 · 캐시 안 함) */
export async function publicPopups(db: DatabaseService) {
  return db.query<Record<string, unknown>>(
    `SELECT id::text AS id, title, body, link_url AS "linkUrl", link_label AS "linkLabel", ends_at AS "endsAt"
       FROM prx_popups
      WHERE is_on AND starts_at <= now() AND ends_at > now()
        AND audience && fn_prx_popup_audience($1::uuid)
      ORDER BY priority, starts_at DESC, id DESC
      LIMIT coalesce((SELECT CASE WHEN value ~ '^[1-5]$' THEN value::int END FROM site_settings WHERE key = 'prx.popup_max'), 3)`,
    [RequestCtx.actorId() ?? null]);
}

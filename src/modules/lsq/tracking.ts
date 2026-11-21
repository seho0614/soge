import { DatabaseService } from '../../db/database.service';
import { NotFound } from '../../core/errors';
import { assumeTrack, CarrierTrackHttp, TrackResult } from './carrier.adapter';
import { lsqSettings } from './common';

/* ---------------------------------------------------------------------
 * v10.607 (docs/749) ㉓ 배송 추적 연동 — 기존 발송 처리(hlt_shipments · 운영자 · 판매자가 택배사 · 송장번호를 넣음) 위에
 *   lsq_track(매시간) · lsq.track on 일 때만(처음 off): 배송중(SHIPPED) 주문의 마지막 송장을 200개까지 조회(같은 주문은 50분 안에 다시 묻지 않음)
 *     방식 lsq.track_mode — ASSUME(처음 · 간주 단계) · LIVE(택배사 조회 어댑터 · 키 없으면 NOT_READY 로 남기고 넘어감)
 *     단계는 lsq_track_events 에 쌓기만(같은 단계 · 같은 시각은 한 번)
 *     배송 완료 — lsq.track_auto_deliver on(처음 off) · LIVE 결과일 때만 기존 배송 기록에 DELIVERED 한 줄(트리거 fn_hlt_ship_apply 가 주문을 「배송 완료」로 ·
 *       구매확정 · 반품 기한이 그때부터) · 간주 결과로는 넣지 않음
 *   회원 「배송 조회」 화면에 택배사 단계(장소 · 시각)만 · 운영 화면 › 소개몰 › 배송 추적
 * ------------------------------------------------------------------- */

const POLL_MAX = 200;

export async function trackJob(db: DatabaseService, force = false, http = new CarrierTrackHttp()) {
  const s = await lsqSettings(db);
  if (!s.trackOn && !force) return { on: false, mode: s.trackMode, polled: 0, events: 0, delivered: 0, notReady: 0, errors: 0 };
  const rows = await db.query<{ order_id: string; carrier: string; tracking_no: string; picked_at: Date }>(
    `SELECT o.id::text AS order_id, sh.carrier, sh.tracking_no, coalesce(o.shipped_at, sh.happened_at) AS picked_at
       FROM hlt_orders o
       JOIN LATERAL (SELECT carrier, tracking_no, happened_at FROM hlt_shipments x WHERE x.order_id = o.id AND x.tracking_no IS NOT NULL
                      ORDER BY x.happened_at DESC, x.id DESC LIMIT 1) sh ON true
       LEFT JOIN lsq_track_polls p ON p.order_id = o.id
      WHERE o.status = 'SHIPPED' AND sh.carrier IS NOT NULL AND sh.tracking_no ~ '^[0-9]{10,14}$'
        AND (p.last_polled_at IS NULL OR p.last_polled_at < now() - interval '50 minutes' OR p.tracking_no <> sh.tracking_no)
      ORDER BY p.last_polled_at NULLS FIRST, o.shipped_at LIMIT $1::int`, [POLL_MAX]);
  let events = 0, delivered = 0, notReady = 0, errors = 0;
  for (const r of rows) {
    const res: TrackResult = s.trackMode === 'LIVE' ? await http.track(r.carrier, r.tracking_no) : assumeTrack(r.tracking_no, new Date(r.picked_at));
    if (res.source === 'NOT_READY') notReady++;
    if (res.source === 'ERROR') errors++;
    for (const e of res.source === 'ASSUME' || res.source === 'LIVE' ? res.events : []) {
      const ins = await db.query(
        `INSERT INTO lsq_track_events (order_id, carrier, tracking_no, status, place, detail, happened_at, source)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::timestamptz, $8) ON CONFLICT DO NOTHING RETURNING id`,
        [r.order_id, r.carrier.slice(0, 30), r.tracking_no, e.status, e.place, e.detail, e.at, res.source]);
      events += ins.length;
    }
    const last = res.events[res.events.length - 1];
    await db.query(
      `INSERT INTO lsq_track_polls (order_id, tracking_no, polls, last_polled_at, last_status, last_error) VALUES ($1::uuid, $2, 1, now(), $3, $4)
       ON CONFLICT (order_id) DO UPDATE SET tracking_no = EXCLUDED.tracking_no, polls = lsq_track_polls.polls + 1, last_polled_at = now(),
         last_status = coalesce(EXCLUDED.last_status, lsq_track_polls.last_status), last_error = EXCLUDED.last_error`,
      [r.order_id, r.tracking_no, last?.status ?? null, res.error ? res.error.slice(0, 200) : null]);
    if (res.delivered && res.source === 'LIVE' && s.trackAutoDeliver) {
      const at = res.events.find((e) => e.status === 'DELIVERED')?.at ?? new Date().toISOString();
      const done = await db.query(
        `INSERT INTO hlt_shipments (order_id, carrier, tracking_no, state, note, happened_at)
         SELECT o.id, $2, $3, 'DELIVERED', '택배사 조회 — 배송 완료', greatest(least($4::timestamptz, now()), coalesce(o.shipped_at, now()))
           FROM hlt_orders o WHERE o.id = $1::uuid AND o.status = 'SHIPPED' RETURNING id`,
        [r.order_id, r.carrier, r.tracking_no, at]);
      if (done.length) {
        delivered++;
        await db.query(`UPDATE lsq_track_polls SET delivered_applied_at = now() WHERE order_id = $1::uuid`, [r.order_id]);
      }
    }
  }
  if (notReady && s.trackOn) {
    await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
       SELECT 'LSQ_TRACK_NOT_READY', 'WARN', '배송 추적이 LIVE 인데 택배사 조회 키 · 주소가 없습니다 — 외부 연동 › 연동 키(CARRIER_TRACK_KEY) 또는 간주(ASSUME)로', $1::jsonb, clock_timestamp()
        WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'LSQ_TRACK_NOT_READY' AND raised_at > now() - interval '24 hours')
       ON CONFLICT DO NOTHING`, [JSON.stringify({ notReady })]);
  }
  return { on: s.trackOn, mode: s.trackMode, polled: rows.length, events, delivered, notReady, errors };
}

/** 회원 — 내 주문의 택배사 단계(장소 · 시각만) */
export async function myTracking(db: DatabaseService, me: string, no: string) {
  const [o] = await db.query<{ id: string; status: string }>(`SELECT id::text AS id, status FROM hlt_orders WHERE order_no = $1 AND account_id = $2::uuid`, [String(no ?? ''), me]);
  if (!o) throw new NotFound('없는 주문입니다.');
  const s = await lsqSettings(db);
  const events = await db.query(
    `SELECT status, place, detail, happened_at AS at, source FROM lsq_track_events WHERE order_id = $1::uuid ORDER BY happened_at DESC, id DESC LIMIT 50`, [o.id]);
  const [p] = await db.query(`SELECT last_polled_at AS "polledAt", last_status AS "lastStatus" FROM lsq_track_polls WHERE order_id = $1::uuid`, [o.id]);
  return { on: s.trackOn, mode: s.trackMode, orderStatus: o.status, polled: p ?? null, events };
}

/** 운영 — 설정 · 준비 상태 · 수 · 최근 조회 50 */
export async function adminTracking(db: DatabaseService) {
  const settings = await lsqSettings(db);
  const [c] = await db.query<Record<string, number>>(
    `SELECT (SELECT count(*)::int FROM hlt_orders WHERE status = 'SHIPPED') AS shipping,
            (SELECT count(*)::int FROM lsq_track_polls WHERE last_polled_at > now() - interval '24 hours') AS "polled24h",
            (SELECT count(*)::int FROM lsq_track_polls WHERE last_error IS NOT NULL) AS errors,
            (SELECT count(*)::int FROM lsq_track_polls WHERE delivered_applied_at > now() - interval '30 days') AS "delivered30",
            (SELECT count(*)::int FROM lsq_track_events WHERE created_at > now() - interval '24 hours') AS "events24h"`);
  const recent = await db.query(
    `SELECT o.order_no AS "orderNo", o.status, p.tracking_no AS "trackingNo", p.polls, p.last_polled_at AS "polledAt", p.last_status AS "lastStatus",
            p.last_error AS "lastError", p.delivered_applied_at AS "deliveredAppliedAt"
       FROM lsq_track_polls p JOIN hlt_orders o ON o.id = p.order_id ORDER BY p.last_polled_at DESC NULLS LAST LIMIT 50`);
  return { settings, ready: { mode: settings.trackMode, keySet: CarrierTrackHttp.ready(), notReady: settings.trackMode === 'LIVE' && !CarrierTrackHttp.ready() },
    counts: c, recent, note: '처음에는 간주(ASSUME) — 밖으로 부르지 않고 발송 뒤 지난 시간으로 단계를 만듭니다. 간주 결과로는 주문을 「배송 완료」로 바꾸지 않습니다.' };
}

/** 운영 — 주문 하나의 택배사 단계 */
export async function adminTrackingOrder(db: DatabaseService, no: string) {
  const [o] = await db.query<{ id: string; status: string }>(`SELECT id::text AS id, status FROM hlt_orders WHERE order_no = $1`, [String(no ?? '')]);
  if (!o) throw new NotFound('없는 주문입니다.');
  const events = await db.query(
    `SELECT status, place, detail, happened_at AS at, source, carrier, tracking_no AS "trackingNo" FROM lsq_track_events WHERE order_id = $1::uuid ORDER BY happened_at DESC, id DESC LIMIT 100`, [o.id]);
  return { orderNo: no, status: o.status, events };
}

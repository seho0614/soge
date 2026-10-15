import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';

/**
 * 이벤트.
 *
 * 규칙은 DB 에 있습니다(`fn_event_guard`·`fn_event_join_guard`).
 * 여기서는 읽고 넣는 일만 합니다 — 규칙을 앱에도 적으면 두 곳이
 * 갈라지고, 어느 쪽이 맞는지 모르게 됩니다.
 */
@Injectable()
export class EventService {
  constructor(private readonly db: DatabaseService) {}

  /** 진행 중인 이벤트. 기간 판정은 뷰가 합니다. */
  live(gwanCode?: string) {
    return this.db.query(
      `SELECT id, code, title, summary, benefit, gwan_code AS "gwanCode",
              join_type AS "joinType", max_joins AS "maxJoins", landing_url AS "landingUrl",
              starts_at AS "startsAt", ends_at AS "endsAt",
              joins, remain, days_left AS "daysLeft"
         FROM v_events_live
        WHERE gwan_code IS NULL OR gwan_code = $1`, [gwanCode ?? null]);
  }

  async detail(code: string) {
    const [e] = await this.db.query<any>(
      `SELECT * FROM v_events_live WHERE code = $1`, [code]);
    if (!e) throw new StateConflict('EVENT_NOT_LIVE', '진행 중인 이벤트가 아닙니다.');
    return e;
  }

  /**
   * 참여.
   *
   * 기간·정원은 트리거가 봅니다. 여기서 한 번 더 확인하는 것은
   * **사람이 읽을 메시지를 만들기 위해서**입니다.
   */
  async join(code: string) {
    const me = RequestCtx.actorId()!;
    const [e] = await this.db.query<any>(
      `SELECT id, join_type, benefit FROM events WHERE code = $1`, [code]);
    if (!e) throw new StateConflict('EVENT_NOT_FOUND', '없는 이벤트입니다.');
    if (e.join_type === 'NONE') {
      throw new PolicyViolation('NO_JOIN', '참여 신청을 받지 않는 이벤트입니다.');
    }

    const [dup] = await this.db.query<any>(
      `SELECT id FROM event_joins WHERE event_id = $1 AND account_id = $2`, [e.id, me]);
    if (dup) return { ok: true, already: true, note: '이미 참여하셨습니다.' };

    await this.db.query(
      `INSERT INTO event_joins (event_id, account_id) VALUES ($1,$2)`, [e.id, me]);

    /* 참여와 지급은 별개입니다 — 바로 받는 줄 알면 기다리다 항의합니다. */
    return { ok: true,
      note: `참여되었습니다. ${e.benefit} — 확인 후 드립니다.` };
  }

  /** 내가 참여한 이벤트. 받았는지도 함께 옵니다. */
  mine() {
    const me = RequestCtx.actorId()!;
    return this.db.query(
      `SELECT e.code, e.title, e.benefit, e.ends_at AS "endsAt",
              j.created_at AS "joinedAt", j.granted_at AS "grantedAt",
              j.grant_note AS "grantNote"
         FROM event_joins j
         JOIN events e ON e.id = j.event_id
        WHERE j.account_id = $1
        ORDER BY j.created_at DESC LIMIT 50`, [me]);
  }

  /* ── 운영 ──────────────────────────────────────────────────────── */

  all() {
    return this.db.query(
      `SELECT e.id, e.code, e.title, e.summary, e.benefit, e.status,
              e.gwan_code AS "gwanCode", e.join_type AS "joinType",
              e.max_joins AS "maxJoins",
              e.starts_at AS "startsAt", e.ends_at AS "endsAt",
              (SELECT count(*) FROM event_joins j WHERE j.event_id = e.id) AS joins,
              (SELECT count(*) FROM event_joins j
                WHERE j.event_id = e.id AND j.granted_at IS NULL) AS ungranted
         FROM events e
        ORDER BY e.starts_at DESC LIMIT 100`);
  }

  async create(d: any) {
    const [e] = await this.db.query<any>(
      `INSERT INTO events (code, title, summary, body, benefit, gwan_code,
                           starts_at, ends_at, join_type, max_joins, landing_url,
                           status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,coalesce($9,'NONE'),$10,$11,'DRAFT',$12)
       RETURNING id, code, title, status`,
      [d.code, d.title, d.summary ?? null, d.body, d.benefit, d.gwanCode ?? null,
       d.startsAt, d.endsAt, d.joinType ?? null, d.maxJoins ?? null,
       d.landingUrl ?? null, RequestCtx.actorId()]);
    return { ...e, note: '초안으로 만들었습니다. 확인 후 발행하십시오.' };
  }

  async setStatus(code: string, status: string) {
    const [e] = await this.db.query<any>(
      `UPDATE events SET status = $2 WHERE code = $1
       RETURNING id, code, title, status, starts_at AS "startsAt", ends_at AS "endsAt"`,
      [code, status]);
    if (!e) throw new StateConflict('EVENT_NOT_FOUND', '없는 이벤트입니다.');
    return e;
  }

  /** 지급 대기. 오래된 것이 위로 옵니다. */
  ungranted() {
    return this.db.query(
      `SELECT u.id, u.event_code AS "eventCode", u.title,
              u.account_id AS "accountId", a.name, a.email,
              u.created_at AS "joinedAt", u.waiting_days AS "waitingDays",
              e.benefit
         FROM v_event_ungranted u
         JOIN accounts a ON a.id = u.account_id
         JOIN events e ON e.id = u.event_id
        LIMIT 200`);
  }

  async grant(id: string, note: string) {
    const [r] = await this.db.query<any>(
      `UPDATE event_joins
          SET granted_at = now(), granted_by = $2, grant_note = $3
        WHERE id = $1 AND granted_at IS NULL
        RETURNING id`, [id, RequestCtx.actorId(), note]);
    if (!r) throw new StateConflict('ALREADY_GRANTED', '이미 처리했거나 없는 참여입니다.');

    /* 받으신 분에게 알립니다 — 조용히 주면 받은 줄 모릅니다. */
    await this.db.query(
      `INSERT INTO notifications (account_id, event_code, title, body, link_url)
       SELECT j.account_id, 'EVENT_GRANTED', '이벤트 혜택이 지급되었습니다',
              $2, '/my/events'
         FROM event_joins j WHERE j.id = $1`, [id, note]);

    return { ok: true, note: '지급 처리했습니다. 참여자에게 알림이 갑니다.' };
  }
}

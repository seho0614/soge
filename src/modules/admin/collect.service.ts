import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';

/**
 * 수집 관리.
 *
 * 게이트는 DB 가 집행합니다(`fn_collect_gate`). 여기서는 읽고 넣는
 * 일만 합니다 — 규칙을 앱에도 적으면 두 곳이 갈라집니다.
 */
@Injectable()
export class CollectService {
  constructor(private readonly db: DatabaseService) {}

  sources() {
    return this.db.query(
      `SELECT id, code, name, state,
              robots_ok AS "robotsOk", legal_ok AS "legalOk",
              interval_ms AS "intervalMs", last_run_at AS "lastRunAt", blocker
         FROM v_collect_gate_status ORDER BY code`);
  }

  async create(d: any) {
    const [s] = await this.db.query<any>(
      `INSERT INTO collect_sources (code, name, base_url, kind, interval_ms)
       VALUES ($1,$2,$3,coalesce($4,'PUBLIC_API'),coalesce($5,1000))
       RETURNING id, code, name, state`,
      [d.code, d.name, d.baseUrl, d.kind ?? null, d.intervalMs ?? null]);
    return { ...s,
      note: '등록했습니다. robots 확인과 법무 회신을 거쳐야 돌릴 수 있습니다.' };
  }

  /**
   * 게이트 통과 기록.
   *
   * **누가 언제 확인했는지 남습니다** — 나중에 문제가 되면
   * "확인하고 했다" 를 증명할 수 있어야 합니다.
   */
  async gate(code: string, d: { kind: string; note?: string }) {
    const me = RequestCtx.actorId();
    const col = d.kind === 'ROBOTS' ? 'robots' : 'legal';

    if (d.kind === 'LEGAL' && !d.note?.trim()) {
      throw new PolicyViolation('NOTE_REQUIRED',
        '법무 회신 요지를 적어 주십시오 — 무엇을 근거로 열었는지 남아야 합니다.');
    }

    const [s] = await this.db.query<any>(
      `UPDATE collect_sources
          SET ${col}_at = now(), ${col}_by = $2
              ${d.kind === 'LEGAL' ? ', legal_note = $3' : ''}
        WHERE code = $1
        RETURNING id, code, name, state,
                  (robots_at IS NOT NULL) AS "robotsOk",
                  (legal_at IS NOT NULL) AS "legalOk"`,
      d.kind === 'LEGAL' ? [code, me, d.note] : [code, me]);
    if (!s) throw new StateConflict('NOT_FOUND', '없는 수집 대상입니다.');
    return s;
  }

  async setState(code: string, d: { state: string; reason?: string }) {
    const me = RequestCtx.actorId();
    const [cur] = await this.db.query<any>(
      `SELECT state FROM collect_sources WHERE code = $1`, [code]);
    if (!cur) throw new StateConflict('NOT_FOUND', '없는 수집 대상입니다.');

    /* 차단을 풀 때는 누가 풀었는지 남깁니다(INV-C5). */
    const unblocking = cur.state === 'BLOCKED' && d.state === 'STOPPED';
    const [s] = await this.db.query<any>(
      `UPDATE collect_sources
          SET state = $2,
              blocked_reason = CASE WHEN $2 = 'BLOCKED' THEN $3 ELSE blocked_reason END,
              unblocked_by = CASE WHEN $4 THEN $5::uuid ELSE unblocked_by END,
              unblocked_at = CASE WHEN $4 THEN now() ELSE unblocked_at END
        WHERE code = $1
        RETURNING id, code, name, state`,
      [code, d.state, d.reason ?? null, unblocking, me]);

    return { ...s,
      note: unblocking
        ? '차단을 풀었습니다. 게이트를 다시 통과해야 READY 가 됩니다.'
        : null };
  }

  /**
   * 수집 실행.
   *
   * 실제 수집은 배치가 합니다. 여기서는 **실행 기록만 만듭니다** —
   * 그 기록이 있어야 데이터가 들어올 수 있습니다(INV-C6).
   */
  async run(code: string) {
    const [s] = await this.db.query<any>(
      `SELECT id, state, interval_ms FROM collect_sources WHERE code = $1`, [code]);
    if (!s) throw new StateConflict('NOT_FOUND', '없는 수집 대상입니다.');
    if (s.state !== 'READY') {
      throw new PolicyViolation('NOT_READY',
        '대상이 READY 가 아닙니다 — 게이트를 먼저 통과시키십시오.');
    }

    /* 이미 돌고 있으면 또 시작하지 않습니다(INV-C4 · 동시 1). */
    const [running] = await this.db.query<any>(
      `SELECT id FROM collect_fetches WHERE source_id = $1 AND status = 'RUNNING'`,
      [s.id]);
    if (running) {
      throw new StateConflict('ALREADY_RUNNING',
        '이미 돌고 있습니다 — 동시에 하나만 돕니다.');
    }

    const [f] = await this.db.query<any>(
      `INSERT INTO collect_fetches (source_id, run_by) VALUES ($1,$2)
       RETURNING id, started_at AS "startedAt"`, [s.id, RequestCtx.actorId()]);
    await this.db.query(
      `UPDATE collect_sources SET state='RUNNING', last_run_at=now() WHERE id=$1`,
      [s.id]);

    return { ...f, intervalMs: s.interval_ms,
      note: `시작했습니다. ${s.interval_ms}ms 간격으로 하나씩 가져옵니다.` };
  }

  fetches() {
    return this.db.query(
      `SELECT f.id, s.code, s.name, f.started_at AS "startedAt",
              f.ended_at AS "endedAt", f.status, f.items, f.errors, f.note
         FROM collect_fetches f
         JOIN collect_sources s ON s.id = f.source_id
        ORDER BY f.started_at DESC LIMIT 50`);
  }

  async health() {
    const rates = await this.db.query(
      `SELECT code, name, items, matched, unmatched, last_done AS "lastDone"
         FROM v_collect_match_rate ORDER BY code`);
    const stuck = await this.db.query(
      `SELECT id, code, name, started_at AS "startedAt",
              round(running_min) AS "runningMin"
         FROM v_collect_stuck`);
    const [n] = await this.db.query<any>(`
      SELECT (SELECT count(*) FROM collect_sources)                    AS sources,
             (SELECT count(*) FROM collect_sources WHERE state='READY') AS ready,
             (SELECT count(*) FROM collect_sources WHERE state='BLOCKED') AS blocked,
             (SELECT count(*) FROM ingredients)                        AS ingredients,
             (SELECT count(*) FROM collect_items)                      AS items`);
    return {
      sources: Number(n?.sources ?? 0),
      ready: Number(n?.ready ?? 0),
      blocked: Number(n?.blocked ?? 0),
      ingredients: Number(n?.ingredients ?? 0),
      items: Number(n?.items ?? 0),
      rates, stuck,
      note: stuck.length ? '2시간 넘게 안 끝난 수집이 있습니다 — 멈춘 것일 수 있습니다.' : null,
    };
  }
}

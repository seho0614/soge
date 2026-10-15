import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';

@Injectable()
export class LearnService {
  constructor(private readonly db: DatabaseService) {}
  private get me() { return RequestCtx.actorId()!; }

  async correct(dto: { logId: number; toCode: string; reason?: string }) {
    const [log] = await this.db.query(
      `SELECT id, input_text AS "text", suggested FROM classify_logs WHERE id = $1`,
      [dto.logId]);
    if (!log) return { ok: false, note: '없는 분류 기록입니다.' };
    if (log.suggested === dto.toCode) {
      return { ok: false, note: '같은 분류입니다 — 고칠 것이 없습니다.' };
    }

    /* ★ 글에서 단어를 뽑아 한 줄씩 쌓습니다.
     *   한 줄로는 아무것도 바뀌지 않습니다. */
    const [r] = await this.db.query(
      `WITH t AS (SELECT term FROM fn_classify_terms($1))
       INSERT INTO classify_signals (term, from_code, to_code, log_id, actor_id)
       SELECT t.term, $2, $3, $4, $5 FROM t
       RETURNING (SELECT count(*) FROM t) AS n`,
      [log.text, log.suggested ?? null, dto.toCode, dto.logId, this.me]);

    await this.db.query(
      `UPDATE classify_logs SET chosen = $2 WHERE id = $1`, [dto.logId, dto.toCode]);

    const [min] = await this.db.query(
      `SELECT coalesce(value,'3') AS v FROM site_settings
        WHERE key = 'classify.learn.min_signals'`);
    return {
      ok: true, terms: r?.n ?? 0,
      note: `단어 ${r?.n ?? 0}개를 기록했습니다. ` +
            `같은 방향으로 ${min?.v ?? 3}번 이상 쌓이면 어휘집에 반영됩니다.`,
    };
  }

  async learn() {
    const rows = await this.db.query(`SELECT * FROM fn_classify_learn()`);
    return {
      ok: true, applied: rows.length,
      items: rows.map((r: Record<string, unknown>) => ({
        term: r.out_term, code: r.out_code,
        before: r.out_before, after: r.out_after, signals: r.out_signals,
      })),
      note: rows.length
        ? `${rows.length}개 어휘를 반영했습니다. 다음 분류부터 적용됩니다.`
        : '반영할 것이 없습니다. 아직 신호가 모자랍니다.',
    };
  }

  async log() {
    const items = await this.db.query(
      `SELECT id, term, category_code AS code, before_w AS "before",
              after_w AS "after", signals, applied_at AS "appliedAt",
              reverted_at AS "revertedAt"
         FROM classify_learn_log
        ORDER BY applied_at DESC LIMIT 200`);
    const [burst] = await this.db.query(
      `SELECT count(*)::int AS n FROM v_classify_learn_burst`);
    return {
      items,
      note: (burst?.n ?? 0) > 0
        ? '하루에 50개 넘게 학습된 날이 있습니다 — 누가 일괄로 고쳤거나 오작동입니다.'
        : null,
    };
  }

  async revert(dto: { since: string }) {
    /* ★ 되돌리는 사이에 또 학습되면 끝이 없습니다. */
    const [on] = await this.db.query(
      `SELECT value FROM site_settings WHERE key = 'classify.learn.enabled'`);
    if (on?.value === 'on') {
      return {
        ok: false,
        note: '먼저 classify.learn.enabled 를 off 로 바꾸십시오 — ' +
              '되돌리는 사이에 또 학습되면 끝이 없습니다.',
      };
    }

    const rows = await this.db.query(
      `SELECT id, term, category_code AS code, before_w AS "before"
         FROM classify_learn_log
        WHERE applied_at >= $1::timestamptz AND reverted_at IS NULL
        ORDER BY applied_at DESC`, [dto.since]);

    for (const r of rows) {
      if (r.before === null) {
        await this.db.query(
          `DELETE FROM classify_vocab WHERE term = $1 AND category_code = $2`,
          [r.term, r.code]);
      } else {
        await this.db.query(
          `UPDATE classify_vocab SET weight = $3
            WHERE term = $1 AND category_code = $2`, [r.term, r.code, r.before]);
      }
      await this.db.query(
        `UPDATE classify_learn_log SET reverted_at = now(), reverted_by = $2
          WHERE id = $1`, [r.id, this.me]);
    }
    return {
      ok: true, reverted: rows.length,
      note: `${rows.length}건을 되돌렸습니다. 원인을 고친 뒤 학습을 다시 켜십시오.`,
    };
  }
}

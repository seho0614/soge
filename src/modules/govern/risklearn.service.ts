import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';

/* ★ 법이 정한 것이라 사람 판단으로 열 수 없습니다. */
const LAW_RULES = ['RSK-05', 'RSK-07'];

@Injectable()
export class RiskLearnService {
  constructor(private readonly db: DatabaseService) {}
  private get me() { return RequestCtx.actorId()!; }

  async learn() {
    const rows = await this.db.query(`SELECT * FROM fn_risk_learn()`);
    const [over] = await this.db.query(
      `SELECT count(*)::int AS n FROM v_risk_overexempted`);
    return {
      ok: true, applied: rows.length,
      items: rows.map((r: Record<string, unknown>) => ({
        rule: r.out_rule, subject: r.out_subject, signals: r.out_signals,
      })),
      note: (over?.n ?? 0) > 0
        ? '예외가 20건 넘는 규칙이 있습니다 — 예외를 늘리지 말고 규칙을 고치십시오.'
        : rows.length
          ? `${rows.length}건을 예외로 두었습니다. 기한이 지나면 다시 뜹니다.`
          : '예외로 둘 것이 없습니다.',
    };
  }

  async list() {
    const items = await this.db.query(
      `SELECT e.id, e.rule_code AS "rule", r.name AS "ruleName", e.subject,
              e.reason, e.signals, e.created_at AS "createdAt",
              e.expires_at AS "expiresAt",
              (e.expires_at IS NOT NULL AND e.expires_at <= now()) AS expired
         FROM risk_exemptions e
         LEFT JOIN risk_rules r ON r.code = e.rule_code
        WHERE e.revoked_at IS NULL
        ORDER BY e.created_at DESC LIMIT 200`);
    const [forever] = await this.db.query(
      `SELECT count(*)::int AS n FROM v_risk_exempt_forever`);
    return {
      items,
      note: (forever?.n ?? 0) > 0
        ? '기한 없는 예외가 있습니다 — 시간이 지나면 왜 뒀는지 모르게 됩니다.'
        : null,
    };
  }

  async add(dto: { ruleCode: string; subject: string; reason: string; days?: number }) {
    /* DB 제약이 이미 막지만, 여기서 먼저 알려 드립니다. */
    if (LAW_RULES.includes(dto.ruleCode)) {
      return {
        ok: false,
        note: `${dto.ruleCode} 은 법이 정한 규칙이라 예외를 둘 수 없습니다. ` +
              '제한업종과 광고 규제는 사람 판단으로 열 수 없습니다.',
      };
    }
    const [days] = await this.db.query(
      `SELECT coalesce(value,'90')::int AS v FROM site_settings
        WHERE key = 'risk.learn.expire_days'`);
    const [r] = await this.db.query(
      `INSERT INTO risk_exemptions (rule_code, subject, reason, expires_at)
       VALUES ($1, $2, $3, now() + ($4 || ' days')::interval)
       ON CONFLICT (rule_code, subject) DO UPDATE
         SET reason = excluded.reason, expires_at = excluded.expires_at,
             revoked_at = NULL
       RETURNING id, expires_at AS "expiresAt"`,
      [dto.ruleCode, dto.subject, dto.reason, dto.days ?? days?.v ?? 90]);
    return { ok: true, ...r, note: '예외로 두었습니다. 기한이 지나면 다시 뜹니다.' };
  }

  async revoke(id: string) {
    /* ★ 지우지 않습니다. 언제 누가 풀었는지 남겨야
     *   "왜 갑자기 다시 뜨지" 에 답할 수 있습니다. */
    const [r] = await this.db.query(
      `UPDATE risk_exemptions SET revoked_at = now(), revoked_by = $2
        WHERE id = $1 AND revoked_at IS NULL
        RETURNING rule_code AS "rule", subject`, [id, this.me]);
    return r
      ? { ok: true, ...r, note: '해제했습니다. 다음부터 다시 경보가 뜹니다.' }
      : { ok: false, note: '없거나 이미 해제된 예외입니다.' };
  }
}

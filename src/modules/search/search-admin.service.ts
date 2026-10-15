import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { NotFound } from '../../core/errors';

/** 검색 사전 · 성향 학습 (관리자). 규칙은 DB 제약·함수가 집행합니다. */
@Injectable()
export class SearchAdminService {
  constructor(private readonly db: DatabaseService) {}

  private async setting(key: string): Promise<string | null> {
    const [r] = await this.db.query<{ value: string }>(
      `SELECT value FROM site_settings WHERE key = $1`, [key]);
    return r?.value ?? null;
  }

  async terms() {
    const synonyms = await this.db.query(
      `SELECT id, term, canonical, kind, weight, created_at AS "createdAt"
         FROM search_synonyms ORDER BY kind, term LIMIT 1000`);
    const intents = await this.db.query(
      `SELECT term, field, operator, value, note FROM search_intents ORDER BY term`);
    const top = await this.db.query(
      `SELECT term, hits::int, zero_hits::int AS "zeroHits"
         FROM search_term_stats ORDER BY hits DESC, term LIMIT 50`);
    const zeroHit = await this.db.query(
      `SELECT term, hits::int, zero_hits::int AS "zeroHits"
         FROM search_term_stats WHERE zero_hits > 0
        ORDER BY zero_hits DESC, term LIMIT 50`);
    return { synonyms, intents, top, zeroHit };
  }

  async addSynonym(dto: { term: string; canonical: string; kind: string; weight?: number }) {
    /* 앞뒤 공백·대소문자가 다르면 같은 말이 두 줄이 됩니다 */
    const term = dto.term.trim().toLowerCase();
    const canonical = dto.canonical.trim();
    const [r] = await this.db.query<{ id: string }>(
      `INSERT INTO search_synonyms (term, canonical, kind, weight)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [term, canonical, dto.kind, dto.weight ?? 5]);
    return { ok: true, id: r.id };
  }

  async removeSynonym(id: string) {
    const rows = await this.db.query<{ id: string }>(
      `DELETE FROM search_synonyms WHERE id = $1 RETURNING id`, [id]);
    if (!rows.length) throw new NotFound('동의어를 찾을 수 없습니다.');
    return { ok: true, id };
  }

  async segCandidates() {
    const items = await this.db.query(
      `SELECT account_id AS "accountId", current_code AS "currentCode",
              to_code AS "toCode", clicks_from AS "clicksFrom", clicks_to AS "clicksTo"
         FROM v_segment_shift_candidates LIMIT 200`);
    const [nc] = await this.db.query<{ n: number }>(`SELECT count(*)::int n FROM v_segment_learn_no_consent`);
    const [th] = await this.db.query<{ n: number }>(`SELECT count(*)::int n FROM v_segment_shift_thrash`);
    return {
      enabled: (await this.setting('segment.learn.enabled')) === 'on',
      minClicks: Number((await this.setting('segment.learn.min_clicks')) ?? 5),
      ratio: Number((await this.setting('segment.learn.ratio')) ?? 3),
      items, noConsent: nc?.n ?? 0, thrash: th?.n ?? 0,
    };
  }

  async segLearn() {
    const enabled = (await this.setting('segment.learn.enabled')) === 'on';
    const rows = await this.db.query<Record<string, unknown>>(`SELECT * FROM fn_segment_learn()`);
    return {
      ok: true, applied: rows.length,
      items: rows.map((r) => ({
        accountId: r.out_account, currentCode: r.out_from, toCode: r.out_to,
        clicksFrom: r.out_cf, clicksTo: r.out_ct,
      })),
      note: !enabled
        ? '성향 학습이 꺼져 있습니다 (segment.learn.enabled=off). 바꾼 것이 없습니다.'
        : rows.length ? `${rows.length}명의 성향을 행동 기준으로 바꿨습니다. 기록이 남습니다.`
                      : '바꿀 대상이 없습니다.',
    };
  }
}

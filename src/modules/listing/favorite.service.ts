import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { clampLimit } from '../../core/pagination';

@Injectable()
export class FavoriteService {
  constructor(private readonly db: DatabaseService) {}

  list(limit?: number) {
    return this.db.query(
      `SELECT f.target_id AS "id", l.title, l.desired_fee AS "desiredFee",
              l.gwan_code AS "gwanCode", f.created_at AS "addedAt"
         FROM favorites f JOIN listings l ON l.id = f.target_id
        WHERE f.account_id = $1 AND f.target_type = 'LISTING'
          AND l.status = 'PUBLISHED'
        ORDER BY f.created_at DESC LIMIT $2`,
      [RequestCtx.actorId(), clampLimit(limit)]);
  }

  async add(targetId: string) {
    await this.db.transaction(async () => {
      await this.db.query(
        `INSERT INTO favorites (account_id, target_type, target_id)
         VALUES ($1,'LISTING',$2) ON CONFLICT DO NOTHING`,
        [RequestCtx.actorId(), targetId]);
      await this.db.query(
        `UPDATE listings SET like_count = like_count + 1 WHERE id = $1`, [targetId]);
    });
    return { liked: true };
  }

  async remove(targetId: string) {
    await this.db.transaction(async () => {
      const rows = await this.db.query(
        `DELETE FROM favorites
          WHERE account_id = $1 AND target_type='LISTING' AND target_id = $2
        RETURNING target_id`, [RequestCtx.actorId(), targetId]);
      if (rows.length)
        await this.db.query(
          `UPDATE listings SET like_count = greatest(like_count - 1, 0) WHERE id = $1`,
          [targetId]);
    });
    return { liked: false };
  }
}

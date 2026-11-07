import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { NotFound, PolicyViolation } from '../../core/errors';

/**
 * v10.206 (D183 · docs/330) — 공휴일(public_holidays)
 *
 *   영업일 계산(문의 「답변 예정」 fn_business_day_after · 검수 마감 fn_review_sla_due)이 주말과 이 표의 날을 건너뜁니다.
 *   처음 값은 2026-12-25 · 2027년(D183). 다음 해 공휴일은 운영이 넣습니다 — 다음 해 표가 비면 「운영 값 확인」에 나옴.
 *   파트너 등급 기준 금액(partner_grade_rules · 파트너센터 운영에서 고침)이 비어 있는지도 같은 곳에 보여 줌.
 */
@Injectable()
export class HolidayService {
  constructor(private readonly db: DatabaseService) {}

  async list() {
    const items = await this.db.query<{ day: string; name: string }>(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, name FROM public_holidays
        WHERE day >= (now() AT TIME ZONE 'Asia/Seoul')::date - 31 ORDER BY day`);
    const [c] = await this.db.query<{ thisYear: number; nextYear: number; year: number; gradeEmpty: number; nextBiz: string }>(
      `SELECT extract(year FROM (now() AT TIME ZONE 'Asia/Seoul'))::int AS year,
              (SELECT count(*)::int FROM public_holidays WHERE extract(year FROM day) = extract(year FROM (now() AT TIME ZONE 'Asia/Seoul'))) AS "thisYear",
              (SELECT count(*)::int FROM public_holidays WHERE extract(year FROM day) = extract(year FROM (now() AT TIME ZONE 'Asia/Seoul')) + 1) AS "nextYear",
              (SELECT count(*)::int FROM partner_grade_rules WHERE rank > 1 AND min_month_earned IS NULL) AS "gradeEmpty",
              to_char(fn_business_day_after(now()) AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS "nextBiz"`);
    const checks: string[] = [];
    if (c.nextYear === 0) checks.push(`${c.year + 1}년 공휴일이 없습니다 — 영업일 계산이 주말만 건너뜁니다(아래에서 넣으십시오)`);
    if (c.gradeEmpty > 0) checks.push(`파트너 등급 기준 금액 ${c.gradeEmpty}칸이 비어 있습니다 — 「다음 등급까지」를 셈하지 않습니다(파트너센터 운영 › 등급 기준)`);
    return { items, thisYear: c.thisYear, nextYear: c.nextYear, nextBusinessDay: c.nextBiz, checks };
  }

  async save(day: string, name: string) {
    const nm = (name ?? '').trim();
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) throw new PolicyViolation('HOLIDAY_DATE', '날짜는 YYYY-MM-DD 로 넣으십시오.');
    if (nm.length < 1 || nm.length > 40) throw new PolicyViolation('HOLIDAY_NAME', '이름은 1 ~ 40자로 넣으십시오.');
    const [r] = await this.db.query<{ day: string; name: string; created: boolean }>(
      `INSERT INTO public_holidays (day, name, created_by) VALUES ($1::date, $2, $3)
       ON CONFLICT (day) DO UPDATE SET name = EXCLUDED.name
       RETURNING to_char(day, 'YYYY-MM-DD') AS day, name, (xmax = 0) AS created`, [day, nm, RequestCtx.actorId() ?? null]);
    return { ok: true, day: r.day, name: r.name, created: r.created };
  }

  async remove(day: string) {
    const rows = await this.db.query(`DELETE FROM public_holidays WHERE day = $1::date RETURNING day`,
      [/^20\d{2}-\d{2}-\d{2}$/.test(day) ? day : '1900-01-01']);
    if (!rows.length) throw new NotFound('그 날짜는 공휴일 목록에 없습니다.');
    return { ok: true, day };
  }
}

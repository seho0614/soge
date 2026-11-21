import { DatabaseService } from '../../db/database.service';
import { cardUsage } from '../acct/cardlimit';
import { isOn, kstToday, setting, YM_RE } from './common';

/* ---------------------------------------------------------------------
 * v10.613 (docs/755) ㉙ 법인카드 사용 즉시 알림
 *   카드 이용 줄(acct_card_txns · ⑫ 카드 CSV · 다음에 카드사 승인 알림이 들어와도 같은 표)이 들어오는 순간 DB 트리거가 알림 대기 한 줄(bzx_card_notices)
 *   정기 작업 bzx_frequent(10분마다)가 bzx.card_notify on(처음 off) 일 때 대기 줄을 보냄:
 *     쓰는 사람(acct_card_limits.holder_id · D261 카드 한도에 정한 사람) — 회원 알림 BZX_CARD_USE(사용 한 건마다 · 금액 · 가맹점 · 이번 달 한도 몇 %)
 *     운영 알림 BZX_CARD_USE(WARN) — 규칙에 걸린 줄만 묶어 한 번(이번 차례):
 *       BIG 한 건 금액 ≥ bzx.card_big_amount(처음 500,000원) · HOLIDAY 주말 · 공휴일(public_holidays) 사용 · NO_LIMIT 한도에 없는 카드
 *       OVER 이번 달 한도를 넘김(D261 셈 cardUsage 재사용 · 기준 % 알림 ACCT_CARD_LIMIT 은 매일 09:40 그대로)
 *     취소(음수)는 CANCEL 표시만(운영 알림 없음)
 *   스위치가 꺼져 있는 동안 쌓인 줄은 사흘 지나면 SKIPPED(켤 때 옛 줄이 한꺼번에 가지 않게)
 *   카드 번호 전체 · 승인번호는 알림에 넣지 않음(끝 4자리만)
 * ------------------------------------------------------------------- */

export const CARD_RULES = ['BIG', 'HOLIDAY', 'NO_LIMIT', 'NEAR', 'OVER', 'CANCEL'] as const;
const RULE_KO: Record<string, string> = { BIG: '큰 금액', HOLIDAY: '주말 · 공휴일', NO_LIMIT: '한도 없는 카드', NEAR: '한도 기준 넘음', OVER: '한도 넘김', CANCEL: '취소' };
const ALERT_RULES = ['BIG', 'HOLIDAY', 'NO_LIMIT', 'OVER'];

/** GET /admin/bzx/card-notices?ym= */
export async function cardNotices(db: DatabaseService, ymIn?: string) {
  const ym = ymIn && YM_RE.test(ymIn) ? ymIn : kstToday().slice(0, 7);
  const items = await db.query(
    `SELECT n.id::text AS id, n.txn_id::text AS "txnId", n.card_tail AS tail, n.used_on::text AS "usedOn", n.merchant, n.amount::bigint AS amount,
            n.rules, n.state, n.sent_at AS "sentAt", n.created_at AS "createdAt", a.name AS holder, l.name AS "cardName"
       FROM bzx_card_notices n LEFT JOIN acct_card_limits l ON l.card_tail = n.card_tail LEFT JOIN accounts a ON a.id = n.holder_id
      WHERE n.used_on >= ($1 || '-01')::date AND n.used_on < (($1 || '-01')::date + interval '1 month')
      ORDER BY n.id DESC LIMIT 300`, [ym]);
  const [c] = await db.query<{ pending: number; sent: number; skipped: number }>(
    `SELECT count(*) FILTER (WHERE state = 'PENDING')::int AS pending, count(*) FILTER (WHERE state = 'SENT')::int AS sent,
            count(*) FILTER (WHERE state = 'SKIPPED')::int AS skipped FROM bzx_card_notices WHERE created_at > now() - interval '30 days'`);
  return { ym, items, counts: c, on: await isOn(db, 'bzx.card_notify'), bigAmount: await bigAmount(db), rules: RULE_KO,
    note: '카드 이용 줄이 들어오면 바로 대기에 쌓이고 10분 안에 쓰는 사람(카드 한도에 정한 사람)에게 알림이 갑니다. 큰 금액 · 주말 · 공휴일 · 한도 없는 카드 · 한도 넘김은 운영 알림도 뜹니다.' };
}

async function bigAmount(db: DatabaseService) {
  const v = Number(await setting(db, 'bzx.card_big_amount'));
  return Number.isInteger(v) && v > 0 ? v : 500000;
}

/** 정기 작업(bzx_frequent) · 「지금 보내기」 */
export async function cardNoticeJob(db: DatabaseService) {
  const skipped = (await db.query(`UPDATE bzx_card_notices SET state = 'SKIPPED' WHERE state = 'PENDING' AND created_at < now() - interval '3 days' RETURNING id`)).length;
  if (!(await isOn(db, 'bzx.card_notify'))) return { on: false, sent: 0, alerted: 0, skipped };
  const rows = await db.query<{ id: string; tail: string | null; used_on: string; merchant: string | null; amount: string; holder_id: string | null;
    has_limit: boolean; holiday: boolean }>(
    `SELECT n.id::text AS id, n.card_tail AS tail, n.used_on::text AS used_on, n.merchant, n.amount::text AS amount, n.holder_id::text AS holder_id,
            EXISTS (SELECT 1 FROM acct_card_limits l WHERE l.card_tail = n.card_tail AND l.active) AS has_limit,
            (extract(isodow FROM n.used_on) >= 6 OR EXISTS (SELECT 1 FROM public_holidays h WHERE h.day = n.used_on)) AS holiday
       FROM bzx_card_notices n WHERE n.state = 'PENDING' ORDER BY n.id LIMIT 500`);
  if (!rows.length) return { on: true, sent: 0, alerted: 0, skipped };
  const big = await bigAmount(db);
  const usage = new Map<string, Awaited<ReturnType<typeof cardUsage>>>();
  const hits: Array<{ id: string; tail: string; amount: number; rules: string[] }> = [];
  let sent = 0;
  for (const r of rows) {
    const amt = Number(r.amount), ym = r.used_on.slice(0, 7);
    if (!usage.has(ym)) usage.set(ym, await cardUsage(db, ym));
    const u = usage.get(ym)!.items.find((x) => x.tail === (r.tail || '(번호 없음)'));
    const rules: string[] = [];
    if (amt < 0) rules.push('CANCEL');
    if (Math.abs(amt) >= big && amt > 0) rules.push('BIG');
    if (r.holiday && amt > 0) rules.push('HOLIDAY');
    if (!r.has_limit) rules.push('NO_LIMIT');
    if (u?.level === 'OVER') rules.push('OVER'); else if (u?.level === 'NEAR') rules.push('NEAR');
    if (r.holder_id) {
      const pct = u?.pct != null ? ` · 이번 달 한도 ${u.pct}%` : '';
      await db.query(
        `INSERT INTO notifications (account_id, event_code, title, body, link_url) VALUES ($1::uuid, 'BZX_CARD_USE', $2, $3, NULL)`,
        [r.holder_id, `법인카드 ${amt < 0 ? '취소' : '사용'} ${Math.abs(amt).toLocaleString('ko-KR')}원`,
         `카드 끝 ${r.tail ?? '—'} · ${r.used_on} · ${String(r.merchant ?? '가맹점 모름').slice(0, 60)}${pct}${rules.filter((x) => x !== 'CANCEL').length ? ` · ${rules.filter((x) => x !== 'CANCEL').map((x) => RULE_KO[x]).join(' · ')}` : ''}`]).catch(() => undefined);
    }
    await db.query(`UPDATE bzx_card_notices SET state = 'SENT', sent_at = now(), rules = $2::text[] WHERE id = $1::bigint AND state = 'PENDING'`, [r.id, rules]);
    sent++;
    if (rules.some((x) => ALERT_RULES.includes(x))) hits.push({ id: r.id, tail: r.tail ?? '—', amount: amt, rules });
  }
  let alerted = 0;
  if (hits.length) {
    const head = hits.slice(0, 3).map((h) => `${h.tail} ${h.amount.toLocaleString('ko-KR')}원(${h.rules.filter((x) => ALERT_RULES.includes(x)).map((x) => RULE_KO[x]).join(' · ')})`).join(', ');
    await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at) VALUES ('BZX_CARD_USE', 'WARN', $1, $2::jsonb, clock_timestamp()) ON CONFLICT DO NOTHING`,
      [`법인카드 살펴볼 사용 ${hits.length}건 — ${head}${hits.length > 3 ? ' 외' : ''} — 회계 › 카드 사용 알림`.slice(0, 300), JSON.stringify({ items: hits.slice(0, 50) })]);
    alerted = hits.length;
  }
  return { on: true, sent, alerted, skipped };
}

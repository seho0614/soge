/**
 * 알림 메일 실제 발송 시험 (v10.85 · src/common/mail/notify-mail.ts).
 *
 * 진짜 DB(DATABASE_URL — 통합 검정은 sgb_check) 위에서 **거래 하나 안에서** 시험하고 되돌립니다(자료가 남지 않음).
 * SMTP 자체(인사 · 인증 · 본문)는 test-mail-offline.ts 가 봅니다 — 여기서는 가짜 발송기로 「무엇을 · 언제 · 어떻게 기록하는가」를 봅니다.
 *   ① 메일 설정 전(ready = false) → 아무것도 바뀌지 않음(QUEUED 그대로)
 *   ② 성공 → SENT · 보낸 시각 · SES · 메시지 번호 · 제목(줄바꿈 → 빈칸) · 본문에 바로 가기(사이트 안 주소만)
 *   ③ 받는 주소 거절 → FAILED(REJECTED)
 *   ④ 시간 초과 → RETRY 1 · RETRY 2 → 세 번째에 FAILED
 *   ⑤ 회원이 끔(정책이 허락) → 보내지 않고 FAILED(OPTED_OUT) · 끄기를 허락하지 않는 알림은 DB 가 끄기를 거절
 *   ⑥ 쓰지 않는 계정 · 3일 넘은 알림 → 보내지 않음
 *   ⑦ 바깥 주소 링크는 붙이지 않음
 *
 * 실행:  npx ts-node -P tsconfig.scripts.json scripts/test-notify-mail.ts
 */
import { Client } from 'pg';
import { NotifyMailSender, notifyMailText } from '../src/common/mail/notify-mail';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = '') => { cond ? pass++ : fail++; console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const db = { query: async (sql: string, p: unknown[] = []) => (await c.query(sql, p)).rows };
  await c.query('BEGIN');
  try {
    const [acc] = await db.query(`INSERT INTO accounts (email, password_hash, name, account_type, status)
      VALUES ('notify-test-' || gen_random_uuid() || '@t.local', 'x', '알림시험', 'PERSONAL', 'ACTIVE') RETURNING id`);
    const [off] = await db.query(`INSERT INTO accounts (email, password_hash, name, account_type, status)
      VALUES ('notify-off-' || gen_random_uuid() || '@t.local', 'x', '정지시험', 'PERSONAL', 'SUSPENDED') RETURNING id`);
    const [ev] = await db.query(`SELECT event_code FROM notification_event_policies WHERE optout_allowed ORDER BY event_code LIMIT 1`);
    const [evNo] = await db.query(`SELECT event_code FROM notification_event_policies WHERE NOT optout_allowed ORDER BY event_code LIMIT 1`);
    const evc = ev?.event_code ?? 'REPORT_RESOLVED';
    const mk = async (who: string, event: string, title: string, link: string | null, ageDays = 0) => {
      const [n] = await db.query(`INSERT INTO notifications (account_id, event_code, title, body, link_url, created_at)
        VALUES ($1, $2, $3, '시험 본문입니다', $4, now() - make_interval(days => $5)) RETURNING id`, [who, event, title, link, ageDays]);
      const [d] = await db.query(`INSERT INTO notification_deliveries (notification_id, channel, status, idempotency_key)
        VALUES ($1, 'EMAIL', 'QUEUED', gen_random_uuid()::text) RETURNING id`, [n.id]);
      return String(d.id);
    };
    const st = async (id: string) => (await db.query(`SELECT status, failed_reason AS r, provider, provider_msg_id AS m, sent_at IS NOT NULL AS sent FROM notification_deliveries WHERE id = $1`, [id]))[0];
    /* 다른 대기 건이 섞이지 않게 — 이 거래 안에서만 기존 QUEUED 메일을 잠시 FAILED 로(되돌림) */
    await db.query(`UPDATE notification_deliveries SET status = 'FAILED', failed_reason = 'test-hold' WHERE channel = 'EMAIL' AND status = 'QUEUED'`);

    const sentMail: { to: string; subject: string; text: string }[] = [];
    let mode: 'ok' | 'reject' | 'timeout' = 'ok', ready = false;
    const mailer = { ready: async () => ready, send: async (m: { to: string; subject: string; text: string }) => {
      sentMail.push(m);
      return mode === 'ok' ? { ok: true, messageId: '<test@mail>' } : mode === 'reject' ? { ok: false, errorKind: 'REJECTED' as const, error: '550 no such user' }
        : { ok: false, errorKind: 'TIMEOUT' as const, error: '응답 없음' };
    } };
    const s = new NotifyMailSender(db, mailer);

    const a1 = await mk(acc.id, evc, '거래가\r\n확정되었습니다', '/my/deals');
    let r = await s.run();
    ok('① 메일 설정 전 → 아무것도 안 함', !r.ready && (await st(a1)).status === 'QUEUED' && sentMail.length === 0, JSON.stringify(r));

    ready = true; r = await s.run(); const x1 = await st(a1);
    ok('② 성공 → SENT · 보낸 시각 · SES · 메시지 번호', x1.status === 'SENT' && x1.sent && x1.provider === 'SES' && x1.m === '<test@mail>' && r.sent === 1, JSON.stringify(x1));
    const m1 = sentMail[0];
    ok('② 제목 줄바꿈 → 빈칸 · 본문에 바로 가기(사이트 안 주소) · 알림 설정 안내', !!m1 && m1.subject === '거래가 확정되었습니다' && /바로 가기: https:\/\/[^\s]+\/my\/deals/.test(m1.text) && m1.text.includes('/my/notifications'), m1?.subject);

    mode = 'reject'; const a2 = await mk(acc.id, evc, '거절 시험', null); r = await s.run(); const x2 = await st(a2);
    ok('③ 받는 주소 거절 → FAILED(REJECTED)', x2.status === 'FAILED' && /^REJECTED/.test(x2.r ?? ''), x2.r);

    mode = 'timeout'; const a3 = await mk(acc.id, evc, '시간 초과 시험', null);
    await s.run(); const t1 = await st(a3); await s.run(); const t2 = await st(a3); await s.run(); const t3 = await st(a3);
    ok('④ 시간 초과 → RETRY 1 · RETRY 2 · 세 번째 FAILED', t1.status === 'QUEUED' && /^RETRY 1 /.test(t1.r) && t2.status === 'QUEUED' && /^RETRY 2 /.test(t2.r) && t3.status === 'FAILED' && /^TIMEOUT/.test(t3.r), `${t1.r} | ${t2.r} | ${t3.r}`);

    mode = 'ok';
    await db.query(`INSERT INTO notification_preferences (account_id, event_code, channel, enabled) VALUES ($1, $2, 'EMAIL', false)`, [acc.id, evc]);
    const before = sentMail.length; const a4 = await mk(acc.id, evc, '끈 알림', null); await s.run(); const x4 = await st(a4);
    ok('⑤ 회원이 끔(정책 허락) → 보내지 않고 FAILED(OPTED_OUT)', x4.status === 'FAILED' && /^OPTED_OUT/.test(x4.r ?? '') && sentMail.length === before, x4.r);
    if (evNo) {
      /* 끄기를 허락하지 않는 알림(정책 optout_allowed = false)은 DB 가 끄기 자체를 거절합니다(NOTIFICATION_OPTOUT_FORBIDDEN) — 그래서 늘 보냄 */
      await c.query('SAVEPOINT sp_no');
      let refused = '';
      try { await db.query(`INSERT INTO notification_preferences (account_id, event_code, channel, enabled) VALUES ($1, $2, 'EMAIL', false)`, [acc.id, evNo.event_code]); }
      catch (e: any) { refused = String(e?.message ?? e); }
      await c.query('ROLLBACK TO SAVEPOINT sp_no');
      ok('⑤ 끄기를 허락하지 않는 알림 — DB 가 메일 끄기를 거절(그래서 늘 보냄)', /OPTOUT_FORBIDDEN|수신거부할 수 없습니다/.test(refused), refused.slice(0, 60));
    }
    const a6 = await mk(off.id, evc, '정지 계정', null); const a7 = await mk(acc.id, 'REPORT_RESOLVED', '오래된 알림', null, 4);
    await db.query(`DELETE FROM notification_preferences WHERE account_id = $1 AND event_code = 'REPORT_RESOLVED'`, [acc.id]);
    await s.run(); const x6 = await st(a6), x7 = await st(a7);
    ok('⑥ 쓰지 않는 계정 · 3일 넘은 알림 → 보내지 않음', /^ACCOUNT_INACTIVE/.test(x6.r ?? '') && /^EXPIRED/.test(x7.r ?? '') && x6.status === 'FAILED' && x7.status === 'FAILED', `${x6.r} | ${x7.r}`);

    const ext = notifyMailText({ title: 't', body: 'b', linkUrl: 'https://evil.example/x', baseUrl: 'https://sogaebank.com' });
    const pr = notifyMailText({ title: 't', body: 'b', linkUrl: '//evil.example/x', baseUrl: null });
    ok('⑦ 바깥 주소 · // 주소는 링크로 붙이지 않음 · base 없으면 sogaebank.com', !ext.text.includes('evil') && !pr.text.includes('evil') && pr.text.includes('https://sogaebank.com/my/notifications'), '');
  } finally {
    await c.query('ROLLBACK'); await c.end();
  }
  console.log(fail === 0 ? `알림 메일 발송 시험 — 전체 통과 (${pass})` : `알림 메일 발송 시험 — 실패 ${fail} / ${pass + fail}`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.log('알림 메일 발송 시험 — 오류 ' + String(e?.message ?? e).slice(0, 200)); process.exit(1); });

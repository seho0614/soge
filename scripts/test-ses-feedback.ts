/**
 * 메일 반송 · 수신 거부 받기 시험 (v10.209 · D186 · src/common/mail/ses-feedback.ts · notify-mail.ts).
 *
 * 진짜 DB(DATABASE_URL — 통합 검정은 sgb_check) 위에서 **거래 하나 안에서** 시험하고 되돌립니다(자료가 남지 않음).
 * AWS 인증서 대신 시험 안에서 만든 열쇠로 서명하고, 인증서 · 구독 확인 주소는 가짜 fetch 가 돌려줍니다.
 *   ① 스위치 꺼짐 → OFF · 아무것도 안 남음
 *   ② 주제가 다르면 403 · 인증서 주소가 AWS 가 아니면 401 · 서명이 틀리면 401
 *   ③ 구독 확인 → SubscribeURL 을 한 번 엶(AWS 주소만)
 *   ④ 영구 반송 → 주소 막힘 · 같은 알림 번호 다시 → DUPLICATE · 일시 반송 → 막지 않음 · 수신 거부 → 막힘
 *   ⑤ 풀어 둔 주소가 다시 반송 → 다시 막힘 · 횟수 2
 *   ⑥ 알림 메일 — 막힌 주소는 보내지 않고 FAILED(SUPPRESSED) · 지우기는 DB 가 막음
 *
 * 실행:  npx ts-node -P tsconfig.scripts.json scripts/test-ses-feedback.ts
 */
import * as crypto from 'crypto';
import { Client } from 'pg';
import { SesFeedback, snsStringToSign, snsUrlOk, type SnsMessage } from '../src/common/mail/ses-feedback';
import { NotifyMailSender } from '../src/common/mail/notify-mail';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = '') => { cond ? pass++ : fail++; console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

const TOPIC = 'arn:aws:sns:ap-northeast-2:123456789012:sgb-ses-feedback';
const CERT = 'https://sns.ap-northeast-2.amazonaws.com/SimpleNotificationService-test.pem';
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();

function signed(m: Partial<SnsMessage>, sv = '2'): SnsMessage {
  const base = { TopicArn: TOPIC, Timestamp: new Date().toISOString(), SignatureVersion: sv, SigningCertURL: CERT, Signature: '', ...m } as SnsMessage;
  base.Signature = crypto.createSign(sv === '2' ? 'RSA-SHA256' : 'RSA-SHA1').update(snsStringToSign(base), 'utf8').sign(privateKey, 'base64');
  return base;
}
const note = (id: string, message: unknown, sv = '2') => signed({ Type: 'Notification', MessageId: id, Message: JSON.stringify(message) }, sv);

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const db = { query: async (sql: string, p: unknown[] = []) => (await c.query(sql, p)).rows };
  const fetched: string[] = [];
  const fx = new SesFeedback(db, async (u) => { fetched.push(u); return u === CERT ? PEM : 'ok'; });
  const code = async (f: () => Promise<unknown>) => { try { await f(); return 'none'; } catch (e: any) { return `${e?.getStatus?.() ?? '?'} ${e?.getResponse?.()?.code ?? e?.message}`; } };
  await c.query('BEGIN');
  try {
    const sid = crypto.randomUUID().slice(0, 8);
    const addr = `bounce-${sid}@t.local`, addr2 = `complain-${sid}@t.local`, addr3 = `soft-${sid}@t.local`;
    const bounce = (a: string, t = 'Permanent') => ({ notificationType: 'Bounce', bounce: { bounceType: t, bounceSubType: 'General', bouncedRecipients: [{ emailAddress: a }] } });

    await db.query(`UPDATE site_settings SET value = 'off' WHERE key = 'notify.ses_feedback'`);
    const r1 = await fx.handle(JSON.stringify(note('m-off-' + sid, bounce(addr))));
    const n1 = (await db.query(`SELECT count(*)::int AS n FROM mail_feedback_events WHERE sns_message_id = $1`, ['m-off-' + sid]))[0].n;
    ok('① 스위치 꺼짐 → OFF · 받은 기록 없음', r1.action === 'OFF' && n1 === 0, r1.action);

    await db.query(`UPDATE site_settings SET value = 'on' WHERE key = 'notify.ses_feedback'`);
    await db.query(`UPDATE site_settings SET value = NULL WHERE key = 'notify.ses_topic_arn'`);
    const e0 = await code(() => fx.handle(JSON.stringify(note('m-0-' + sid, bounce(addr)))));
    await db.query(`UPDATE site_settings SET value = $1 WHERE key = 'notify.ses_topic_arn'`, [TOPIC]);
    const e1 = await code(() => fx.handle(JSON.stringify({ ...note('m-1-' + sid, bounce(addr)), TopicArn: TOPIC + 'x' })));
    const evil = signed({ Type: 'Notification', MessageId: 'm-2-' + sid, Message: JSON.stringify(bounce(addr)), SigningCertURL: 'https://evil.example.com/x.pem' });
    const e2 = await code(() => fx.handle(JSON.stringify(evil)));
    const tamper = note('m-3-' + sid, bounce(addr)); tamper.Message = JSON.stringify(bounce('other@t.local'));
    const e3 = await code(() => fx.handle(JSON.stringify(tamper)));
    const e4 = await code(() => fx.handle('not json'));
    ok('② 주제 없음 · 다름 403 · AWS 아닌 인증서 401 · 서명 틀림 401 · 형식 아님 400',
      /^403 SES_FEEDBACK_TOPIC/.test(e0) && /^403 SES_FEEDBACK_TOPIC/.test(e1) && /^401 SES_FEEDBACK_BAD_SIGNATURE/.test(e2) && /^401 SES_FEEDBACK_BAD_SIGNATURE/.test(e3) && /^400/.test(e4)
      && !fetched.some((u) => u.includes('evil')), [e0, e1, e2, e3, e4].join(' | '));
    ok('② AWS 주소 판정 — sns.<지역>.amazonaws.com https 만', snsUrlOk(CERT, true) && !snsUrlOk('http://sns.ap-northeast-2.amazonaws.com/a.pem', true)
      && !snsUrlOk('https://sns.ap-northeast-2.amazonaws.com.evil.io/a.pem', true) && !snsUrlOk('https://sns.ap-northeast-2.amazonaws.com/a.txt', true), '');

    const sub = 'https://sns.ap-northeast-2.amazonaws.com/?Action=ConfirmSubscription&Token=t';
    const r3 = await fx.handle(JSON.stringify(signed({ Type: 'SubscriptionConfirmation', MessageId: 'm-s-' + sid, Message: 'confirm', SubscribeURL: sub, Token: 't' })));
    const badSub = await code(() => fx.handle(JSON.stringify(signed({ Type: 'SubscriptionConfirmation', MessageId: 'm-s2-' + sid, Message: 'confirm', SubscribeURL: 'https://evil.example.com/', Token: 't' }))));
    ok('③ 구독 확인 → SubscribeURL 한 번 엶 · AWS 아닌 주소는 400', r3.action === 'SUBSCRIBED' && fetched.includes(sub) && /^400/.test(badSub) && !fetched.includes('https://evil.example.com/'), `${r3.action} | ${badSub}`);

    const r4 = await fx.handle(JSON.stringify(note('m-b-' + sid, bounce(addr), '1')));
    const s4 = (await db.query(`SELECT reason, detail, hits, released_at IS NULL AS active FROM mail_suppressions WHERE email = $1`, [addr]))[0];
    const r5 = await fx.handle(JSON.stringify(note('m-b-' + sid, bounce(addr))));
    const r6 = await fx.handle(JSON.stringify(note('m-t-' + sid, bounce(addr3, 'Transient'))));
    const s6 = (await db.query(`SELECT count(*)::int AS n FROM mail_suppressions WHERE email = $1`, [addr3]))[0].n;
    const r7 = await fx.handle(JSON.stringify(note('m-c-' + sid, { notificationType: 'Complaint', complaint: { complaintFeedbackType: 'abuse', complainedRecipients: [{ emailAddress: addr2 }] } })));
    const s7 = (await db.query(`SELECT reason FROM mail_suppressions WHERE email = $1`, [addr2]))[0];
    const ev = (await db.query(`SELECT kind, recipients, suppressed FROM mail_feedback_events WHERE sns_message_id = $1`, ['m-b-' + sid]))[0];
    ok('④ 영구 반송 → 막힘(서명 1 · SHA1) · 같은 알림 DUPLICATE · 일시 반송 안 막음 · 수신 거부 막힘 · 받은 기록엔 수만',
      r4.action === 'RECORDED' && r4.suppressed === 1 && s4?.reason === 'BOUNCE' && s4.detail === 'Permanent/General' && s4.active
      && r5.action === 'DUPLICATE' && r6.action === 'RECORDED' && r6.suppressed === 0 && s6 === 0 && r7.suppressed === 1 && s7?.reason === 'COMPLAINT'
      && ev?.kind === 'BOUNCE' && ev.recipients === 1 && ev.suppressed === 1,
      `${r4.action} ${r5.action} ${r6.action} ${r7.action} · ${JSON.stringify(s4)} · ${s6}`);

    await db.query(`UPDATE mail_suppressions SET released_at = now(), release_note = '시험 풀기' WHERE email = $1`, [addr]);
    await fx.handle(JSON.stringify(note('m-b2-' + sid, bounce(addr.toUpperCase()))));
    const s8 = (await db.query(`SELECT hits, released_at IS NULL AS active, release_note FROM mail_suppressions WHERE email = $1`, [addr]))[0];
    ok('⑤ 풀어 둔 주소가 다시 반송 → 다시 막힘 · 횟수 2 · 대소문자 같은 주소', s8?.active === true && s8.hits === 2 && s8.release_note === null, JSON.stringify(s8));

    const [acc] = await db.query(`INSERT INTO accounts (email, password_hash, name, account_type, status) VALUES ($1, 'x', '반송시험', 'PERSONAL', 'ACTIVE') RETURNING id`, [addr]);
    await db.query(`UPDATE notification_deliveries SET status = 'FAILED', failed_reason = 'test-hold' WHERE channel = 'EMAIL' AND status = 'QUEUED'`);
    const [ep] = await db.query(`SELECT event_code FROM notification_event_policies ORDER BY event_code LIMIT 1`);
    const [n] = await db.query(`INSERT INTO notifications (account_id, event_code, title, body) VALUES ($1, $2, '반송 시험', '본문') RETURNING id`, [acc.id, ep?.event_code ?? 'REPORT_RESOLVED']);
    const [d] = await db.query(`INSERT INTO notification_deliveries (notification_id, channel, status, idempotency_key) VALUES ($1, 'EMAIL', 'QUEUED', gen_random_uuid()::text) RETURNING id`, [n.id]);
    const sent: string[] = [];
    const r9 = await new NotifyMailSender(db, { ready: async () => true, send: async (m) => { sent.push(m.to); return { ok: true, messageId: '<x>' }; } }).run();
    const x9 = (await db.query(`SELECT status, failed_reason AS r FROM notification_deliveries WHERE id = $1`, [d.id]))[0];
    await c.query('SAVEPOINT sp_del');
    let refused = '';
    try { await db.query(`DELETE FROM mail_suppressions WHERE email = $1`, [addr]); } catch (e: any) { refused = String(e?.message ?? e); }
    await c.query('ROLLBACK TO SAVEPOINT sp_del');
    ok('⑥ 알림 메일 — 막힌 주소는 보내지 않고 FAILED(SUPPRESSED) · 지우기는 DB 가 막음',
      x9?.status === 'FAILED' && /^SUPPRESSED/.test(x9.r ?? '') && !sent.includes(addr) && r9.closed >= 1 && /MAILSUP:/.test(refused), `${x9?.status} ${x9?.r} · ${refused.slice(0, 40)}`);
  } finally {
    await c.query('ROLLBACK'); await c.end();
  }
  console.log(fail === 0 ? `메일 반송 받기 시험 — 전체 통과 (${pass})` : `메일 반송 받기 시험 — 실패 ${fail} / ${pass + fail}`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.log('메일 반송 받기 시험 — 오류 ' + String(e?.message ?? e).slice(0, 200)); process.exit(1); });

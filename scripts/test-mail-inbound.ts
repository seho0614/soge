/**
 * 공용 메일함 받기 시험 (v10.789 ~ 791 · D330 · src/common/mail/mime-parse.ts · mail-inbound.ts · smtp.ts).
 *
 * 진짜 DB(DATABASE_URL — 통합 검정은 sgb_check) 위에서 **거래 하나 안에서** 시험하고 되돌립니다(자료가 남지 않음).
 * AWS 인증서 대신 시험 안에서 만든 열쇠로 서명하고, 인증서 주소는 가짜 fetch 가 돌려줍니다.
 *   ① MIME 풀기 — EUC-KR B 인코딩 제목 · multipart/alternative · quoted-printable · base64 첨부 · RFC 2231 파일 이름 · 주소 목록
 *   ② 스위치 꺼짐 → OFF · 주제 다름 403 · AWS 밖 인증서 401 · 고친 본문 401
 *   ③ S3 작업 알림 · S3 읽기 없음 → 위치만 · 「S3 에서 가져오기」(refetch) → 본문 · 첨부 · S3 읽기 있음 → 바로 풂 · 같은 SNS 번호 다시 → DUPLICATE
 *      (SNS 작업은 150KB 넘는 메일을 반송해 규칙에 쓰지 않지만 받으면 처리 — 작은 메일 경로도 봄)
 *   ④ 공용 주소 아닌 곳 → IGNORED · 두 공용 주소로 온 메일 → 메일함마다 한 줄
 *   ⑤ privacy@ 새 메일 → 운영 알림 MAIL_PRIVACY_NEW · 바이러스 FAIL → 상태 SPAM · 알림 없음
 *   ⑥ 열람 기록은 고치기 · 지우기를 DB 가 막음 · 답장 머리(From · In-Reply-To · References)
 *
 * 실행:  npx ts-node -P tsconfig.scripts.json scripts/test-mail-inbound.ts
 */
import * as crypto from 'crypto';
import { Client } from 'pg';
import { snsStringToSign, type SnsMessage } from '../src/common/mail/ses-feedback';
import { MailInbound } from '../src/common/mail/mail-inbound';
import { parseMail, decodeWords } from '../src/common/mail/mime-parse';
import { buildMessage } from '../src/common/mail/smtp';
import { s3SignedHeaders } from '../src/common/mail/s3-get';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = '') => { cond ? pass++ : fail++; console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

const TOPIC = 'arn:aws:sns:ap-northeast-2:123456789012:sgb-mail-inbound';
const CERT = 'https://sns.ap-northeast-2.amazonaws.com/SimpleNotificationService-test.pem';
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();

function signed(m: Partial<SnsMessage>): SnsMessage {
  const base = { TopicArn: TOPIC, Timestamp: new Date().toISOString(), SignatureVersion: '2', SigningCertURL: CERT, Signature: '', ...m } as SnsMessage;
  base.Signature = crypto.createSign('RSA-SHA256').update(snsStringToSign(base), 'utf8').sign(privateKey, 'base64');
  return base;
}
const note = (id: string, message: unknown) => signed({ Type: 'Notification', MessageId: id, Message: JSON.stringify(message) });

/* EUC-KR 「개인정보 열람 요청」 바이트(TextDecoder 로 되돌려 확인) */
const EUCKR_SUBJ = Buffer.from('b0b3c0cec1a4bab820bfadb6f720bfe4c3bb', 'hex');

function sampleMail(sid: string): Buffer {
  const b = 'BOUNDARY-' + sid, b2 = 'ALT-' + sid;
  const lines = [
    `From: =?UTF-8?B?${Buffer.from('홍길동', 'utf8').toString('base64')}?= <hong@example.com>`,
    'To: privacy@sogaebank.com, "Help, Desk" <help@sogaebank.com>',
    'Cc: other@example.com',
    `Subject: =?euc-kr?B?${EUCKR_SUBJ.toString('base64')}?=`,
    'Date: Tue, 25 Nov 2026 09:00:00 +0900',
    `Message-ID: <msg-${sid}@example.com>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${b}"`,
    '',
    'preamble',
    `--${b}`,
    `Content-Type: multipart/alternative; boundary="${b2}"`,
    '',
    `--${b2}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    '=EC=95=88=EB=85=95=ED=95=98=EC=84=B8=EC=9A=94 soft=',
    'line',
    `--${b2}`,
    'Content-Type: text/html; charset=UTF-8',
    '',
    '<p>안녕하세요<script>alert(1)</script></p>',
    `--${b2}--`,
    `--${b}`,
    'Content-Type: application/pdf',
    "Content-Disposition: attachment; filename*=UTF-8''%EC%8B%A0%EB%B6%84%EC%A6%9D.pdf",
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from('%PDF-1.4 test').toString('base64'),
    `--${b}--`,
    '',
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8');
}

function received(sid: string, kind: 'S3' | 'SNS', recipients: string[], extra: Record<string, unknown> = {}, virus = 'PASS') {
  const raw = sampleMail(sid);
  return {
    notificationType: 'Received',
    mail: { messageId: 'ses-' + sid, destination: recipients, commonHeaders: { subject: 'cs-subject', from: ['hong@example.com'] } },
    receipt: { recipients, spamVerdict: { status: 'PASS' }, virusVerdict: { status: virus }, spfVerdict: { status: 'PASS' }, dkimVerdict: { status: 'PASS' }, dmarcVerdict: { status: 'PASS' },
      action: kind === 'S3' ? { type: 'S3', bucketName: 'sgb-mail-inbound-test', objectKey: 'inbound/ses-' + sid, topicArn: TOPIC } : { type: 'SNS', topicArn: TOPIC, encoding: 'BASE64' } },
    ...(kind === 'SNS' ? { content: raw.toString('base64') } : {}),
    ...extra,
  };
}

async function main() {
  /* ① MIME 풀기(DB 없이) */
  const sid0 = crypto.randomUUID().slice(0, 8);
  const p = parseMail(sampleMail(sid0));
  ok('① 제목 EUC-KR B 인코딩 → 「개인정보 열람 요청」', p.subject === '개인정보 열람 요청', String(p.subject));
  ok('① 보낸 사람 이름(UTF-8 B) · 받는 주소 목록(따옴표 안 쉼표)', p.from?.name === '홍길동' && p.from?.address === 'hong@example.com'
     && p.to.map((x) => x.address).join(',') === 'privacy@sogaebank.com,help@sogaebank.com' && p.cc.length === 1, JSON.stringify(p.to));
  ok('① 글 본문 quoted-printable(이어진 줄) · HTML 본문 · 앞말(preamble) 무시', p.text === '안녕하세요 softline' && !!p.html?.includes('안녕하세요'), JSON.stringify(p.text));
  ok('① 첨부 base64 · RFC 2231 파일 이름 「신분증.pdf」', p.attachments.length === 1 && p.attachments[0]!.filename === '신분증.pdf'
     && p.attachments[0]!.data.toString() === '%PDF-1.4 test', JSON.stringify(p.attachments.map((a) => a.filename)));
  ok('① 머리 · Message-ID', p.messageId === `msg-${sid0}@example.com` && p.date?.toISOString() === '2026-11-25T00:00:00.000Z' && decodeWords('=?UTF-8?Q?a_b?=') === 'a b', String(p.messageId));

  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const db = { query: async (sql: string, prm: unknown[] = []) => (await c.query(sql, prm)).rows };
  const fx = new MailInbound(db, async (u) => (u === CERT ? PEM : 'ok'));
  const s3calls: string[] = [];
  const fxS3 = new MailInbound(db, async (u) => (u === CERT ? PEM : 'ok'), async (b, k, max) => { s3calls.push(`${b}/${k}`); const sid1 = k.replace('inbound/ses-', ''); const raw = sampleMail(sid1); return raw.length > max ? null : raw; });
  const code = async (f: () => Promise<unknown>) => { try { await f(); return 'none'; } catch (e: any) { return `${e?.getStatus?.() ?? '?'} ${e?.getResponse?.()?.code ?? e?.message}`; } };
  await c.query('BEGIN');
  try {
    const sid = crypto.randomUUID().slice(0, 8);
    /* ② */
    await db.query(`UPDATE site_settings SET value = 'off' WHERE key = 'mail.inbound'`);
    const r0 = await fx.handle(JSON.stringify(note('n-off-' + sid, received(sid, 'S3', ['privacy@sogaebank.com']))));
    await db.query(`UPDATE site_settings SET value = 'on' WHERE key = 'mail.inbound'`);
    await db.query(`UPDATE site_settings SET value = $1 WHERE key = 'mail.inbound_topic_arn'`, [TOPIC]);
    const e1 = await code(() => fx.handle(JSON.stringify({ ...note('n-1-' + sid, received(sid, 'S3', ['privacy@sogaebank.com'])), TopicArn: TOPIC + 'x' })));
    const evil = signed({ Type: 'Notification', MessageId: 'n-2-' + sid, Message: '{}', SigningCertURL: 'https://evil.example.com/x.pem' });
    const e2 = await code(() => fx.handle(JSON.stringify(evil)));
    const tamper = note('n-3-' + sid, received(sid, 'S3', ['privacy@sogaebank.com'])); tamper.Message = '{"notificationType":"Received"}';
    const e3 = await code(() => fx.handle(JSON.stringify(tamper)));
    ok('② 꺼짐 OFF · 주제 다름 403 · AWS 밖 인증서 401 · 고친 본문 401', r0.action === 'OFF' && /^403 MAIL_INBOUND_TOPIC/.test(e1) && /^401 MAIL_INBOUND_BAD_SIGNATURE/.test(e2) && /^401/.test(e3), `${r0.action} · ${e1} · ${e2} · ${e3}`);

    /* ③ S3 먼저 → SNS */
    const alerts0 = (await db.query(`SELECT count(*)::int AS n FROM ops_alerts WHERE alert_code = 'MAIL_PRIVACY_NEW'`))[0].n;
    const r1 = await fx.handle(JSON.stringify(note('n-s3-' + sid, received(sid, 'S3', ['privacy@sogaebank.com']))));
    const a1 = (await db.query(`SELECT id, has_content, s3_key, subject, text_body FROM mail_messages WHERE ses_message_id = $1`, ['ses-' + sid]));
    const f2 = await fxS3.refetch(String(a1[0].id));
    const a2 = (await db.query(`SELECT id, has_content, s3_key, from_name, text_body, html_body, to_addrs, header_msgid, state FROM mail_messages WHERE ses_message_id = $1`, ['ses-' + sid]));
    const att = (await db.query(`SELECT filename FROM mail_attachments WHERE message_id = $1`, [a2[0]?.id]));
    const r3 = await fx.handle(JSON.stringify(note('n-s3-' + sid, received(sid, 'S3', ['privacy@sogaebank.com']))));
    const sidD = sid + 'd';
    const r6 = await fxS3.handle(JSON.stringify(note('n-s3d-' + sid, received(sidD, 'S3', ['help@sogaebank.com']))));
    const a6 = (await db.query(`SELECT has_content, text_body FROM mail_messages WHERE ses_message_id = $1`, ['ses-' + sidD]))[0];
    const sidS = sid + 's';
    const r7 = await fx.handle(JSON.stringify(note('n-sns7-' + sid, received(sidS, 'SNS', ['help@sogaebank.com']))));
    const a7 = (await db.query(`SELECT has_content, from_name FROM mail_messages WHERE ses_message_id = $1`, ['ses-' + sidS]))[0];
    ok('③ S3 알림 → 위치만(본문 없음) · 제목은 SES 머리', r1.action === 'RECORDED' && r1.withContent === false && a1.length === 1 && a1[0].has_content === false && a1[0].s3_key === 'inbound/ses-' + sid && a1[0].subject === 'cs-subject', JSON.stringify(a1[0] ?? {}));
    ok('③ 「S3 에서 가져오기」 → 같은 줄에 본문 · 첨부 · 머리 채움 · S3 위치 그대로', f2.ok === true && f2.rows === 1 && s3calls[0] === 'sgb-mail-inbound-test/inbound/ses-' + sid && a2.length === 1 && a2[0].has_content === true && a2[0].s3_key === 'inbound/ses-' + sid
       && a2[0].from_name === '홍길동' && a2[0].text_body === '안녕하세요 softline' && a2[0].header_msgid === `msg-${sid}@example.com` && att.length === 1 && att[0].filename === '신분증.pdf', JSON.stringify({ ...a2[0], html_body: undefined }));
    ok('③ 같은 SNS 알림 번호 다시 → DUPLICATE · S3 읽기 있으면 S3 알림에서 바로 풂 · 작은 메일 SNS 작업(Base64)도 풂',
       r3.action === 'DUPLICATE' && r6.withContent === true && a6?.has_content === true && a6?.text_body === '안녕하세요 softline' && r7.withContent === true && a7?.from_name === '홍길동', `${r3.action} · ${r6.withContent} · ${r7.withContent}`);
    const sh = s3SignedHeaders('b-x', 'inbound/a b', 'ap-northeast-2', { id: 'AKIDEXAMPLE', secret: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' }, new Date('2026-11-25T00:00:00Z'));
    ok('③ S3 서명 v4 머리 — 주소 · 날짜 · 열쇠 경로 인코딩 · Authorization 모양', sh.url === 'https://b-x.s3.ap-northeast-2.amazonaws.com/inbound/a%20b' && sh.headers['x-amz-date'] === '20261125T000000Z'
       && /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20261125\/ap-northeast-2\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/.test(sh.headers.Authorization), sh.headers.Authorization.slice(0, 60));

    /* ④ */
    const sidB = sid + 'b';
    const r4 = await fx.handle(JSON.stringify(note('n-x-' + sid, received(sidB, 'SNS', ['nobody@sogaebank.com']))));
    const sidC = sid + 'c';
    const r5 = await fx.handle(JSON.stringify(note('n-two-' + sid, received(sidC, 'SNS', ['privacy@sogaebank.com', 'help@sogaebank.com']))));
    const rows5 = (await db.query(`SELECT b.address FROM mail_messages m JOIN mail_boxes b ON b.id = m.box_id WHERE m.ses_message_id = $1 ORDER BY b.address`, ['ses-' + sidC])).map((x: any) => x.address);
    ok('④ 공용 주소 아님 → IGNORED · 두 공용 주소 → 메일함마다 한 줄', r4.action === 'IGNORED' && r5.boxes === 2 && rows5.join(',') === 'help@sogaebank.com,privacy@sogaebank.com', `${r4.action} · ${rows5.join(',')}`);

    /* ⑤ */
    const alerts1 = (await db.query(`SELECT count(*)::int AS n FROM ops_alerts WHERE alert_code = 'MAIL_PRIVACY_NEW'`))[0].n;
    const sidV = sid + 'v';
    await fx.handle(JSON.stringify(note('n-v-' + sid, received(sidV, 'SNS', ['privacy@sogaebank.com'], {}, 'FAIL'))));
    const v = (await db.query(`SELECT state FROM mail_messages WHERE ses_message_id = $1`, ['ses-' + sidV]))[0];
    const alerts2 = (await db.query(`SELECT count(*)::int AS n FROM ops_alerts WHERE alert_code = 'MAIL_PRIVACY_NEW'`))[0].n;
    ok('⑤ privacy@ 새 메일 → 운영 알림(첫 줄만 · 같은 메일 SNS 로 채울 때는 없음) · 바이러스 FAIL → SPAM · 알림 없음',
       alerts1 - alerts0 === 2 && v?.state === 'SPAM' && alerts2 === alerts1, `알림 ${alerts0}→${alerts1}→${alerts2} · ${v?.state}`);

    /* ⑥ */
    const acc = (await db.query(`SELECT id FROM accounts WHERE email = 'admin@x.com'`))[0]?.id;
    await db.query(`INSERT INTO mail_access_log (message_id, account_id, action) VALUES ($1, $2, 'VIEW')`, [a2[0].id, acc]);
    await c.query('SAVEPOINT sp_del');
    let refused = '';
    try { await db.query(`DELETE FROM mail_access_log WHERE message_id = $1`, [a2[0].id]); } catch (e: any) { refused = String(e?.message ?? e); }
    await c.query('ROLLBACK TO SAVEPOINT sp_del');
    const msg = buildMessage({ host: 'h', port: 465, user: 'u', pass: 'p', from: 'no-reply@mail.sogaebank.com', fromName: '소개뱅크' },
      { to: 'hong@example.com', subject: 'Re: x', text: 'hi', from: 'privacy@sogaebank.com', fromName: '소개뱅크 개인정보 문의', inReplyTo: `<msg-${sid}@example.com>`, references: [`<msg-${sid}@example.com>`, 'bad id'] }, '<id@sogaebank.com>');
    ok('⑥ 열람 기록 지우기를 DB 가 막음(MAIL_LOG_APPEND_ONLY) · 답장 머리 From = 공용 주소 · In-Reply-To · References(틀린 꼴 뺌)',
       /MAIL_LOG_APPEND_ONLY/.test(refused) && /\r\nFrom: =\?UTF-8\?B\?[^?]+\?= <privacy@sogaebank\.com>|^From: =\?UTF-8\?B\?[^?]+\?= <privacy@sogaebank\.com>/.test(msg)
       && msg.includes(`In-Reply-To: <msg-${sid}@example.com>`) && msg.includes(`References: <msg-${sid}@example.com>\r\n`), refused.slice(0, 40));
  } finally {
    await c.query('ROLLBACK'); await c.end();
  }
  console.log(fail === 0 ? `공용 메일함 받기 시험 — 전체 통과 (${pass})` : `공용 메일함 받기 시험 — 실패 ${fail} / ${pass + fail}`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.log('공용 메일함 받기 시험 — 오류 ' + String(e?.message ?? e).slice(0, 200)); process.exit(1); });

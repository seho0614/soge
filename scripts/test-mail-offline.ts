/**
 * 메일 발송기 시험 (오프라인 · v10.43).
 *
 * 실제 SES 에 보내지 않습니다. 이 프로세스 안에 가짜 SMTP 서버(localhost)를 띄우고 일반 소켓으로 붙습니다.
 * 확인하는 것:
 *   ① 정상 — EHLO · AUTH LOGIN(아이디 · 비밀번호 base64) · MAIL FROM · RCPT TO · DATA 순서, 본문의 한글 제목 · 본문 복원
 *   ② 비밀번호 거절(535) → AUTH · 오류 문구에 비밀번호 없음
 *   ③ 받는 주소 거절(550) → REJECTED
 *   ④ 응답 없음 → TIMEOUT (제한 시간 안에 끝남)
 *   ⑤ 연결 거부 → NETWORK
 *   ⑥ 머리줄 끼워 넣기(받는 주소 · 제목에 줄바꿈) → BAD_INPUT · 서버에 연결하지 않음
 *   ⑦ MailService.config — 설정 하나라도 빠지면 null(보내지 않음)
 *
 * 실행:  npx ts-node -P tsconfig.scripts.json scripts/test-mail-offline.ts
 */
import * as net from 'net';
import { buildMessage, SmtpConfig, smtpSend } from '../src/common/mail/smtp';
import { MailService, SES_SEOUL_HOST } from '../src/common/mail/mail.service';

type Mode = 'ok' | 'badpass' | 'badrcpt' | 'silent';
const PASS = 'S3cr3t-pass';

function fakeServer(mode: Mode): Promise<{ port: number; got: string[]; close: () => void }> {
  const got: string[] = [];
  const srv = net.createServer((s) => {
    s.setEncoding('utf8');
    if (mode === 'silent') return;               /* 인사도 하지 않음 → 발송기가 시간 초과로 끝나야 함 */
    s.write('220 fake ESMTP\r\n');
    let buf = '', inData = false, data = '';
    s.on('data', (c: string) => {
      buf += c;
      let i: number;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') { inData = false; got.push('DATA:' + data); s.write('250 Ok 0101abc\r\n'); data = ''; }
          else data += line + '\r\n';
          continue;
        }
        got.push(line);
        if (line.startsWith('EHLO')) s.write('250-fake\r\n250-AUTH PLAIN LOGIN\r\n250 Ok\r\n');
        else if (line === 'AUTH LOGIN') s.write('334 VXNlcm5hbWU6\r\n');
        else if (got.length === 3) s.write('334 UGFzc3dvcmQ6\r\n');
        else if (got.length === 4) s.write(mode === 'badpass' ? '535 Authentication Credentials Invalid\r\n' : '235 Authentication successful.\r\n');
        else if (line.startsWith('MAIL FROM')) s.write('250 Ok\r\n');
        else if (line.startsWith('RCPT TO')) s.write(mode === 'badrcpt' ? '550 Mailbox unavailable\r\n' : '250 Ok\r\n');
        else if (line === 'DATA') { inData = true; s.write('354 End data with <CR><LF>.<CR><LF>\r\n'); }
        else if (line === 'QUIT') { s.write('221 Bye\r\n'); s.end(); }
      }
    });
  });
  return new Promise((res) => srv.listen(0, '127.0.0.1', () =>
    res({ port: (srv.address() as net.AddressInfo).port, got, close: () => srv.close() })));
}

const cfg = (port: number, timeoutMs = 3000): SmtpConfig =>
  ({ host: '127.0.0.1', port, user: 'AKIAFAKEUSER', pass: PASS, from: 'no-reply@mail.sogaebank.com', fromName: '소개뱅크', timeoutMs });
const plain = (c: SmtpConfig) => net.connect({ host: c.host, port: c.port });
const msg = { to: 'buyer@example.com', subject: '[소개뱅크] 상담 신청 인증번호 123456', text: '인증번호: 123456\n본 메일은 발신 전용입니다.' };

let fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  if (!cond) fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 200) : ''));
};
const b64dec = (s: string) => Buffer.from(s, 'base64').toString('utf8');

(async () => {
  /* ① 정상 */
  {
    const f = await fakeServer('ok');
    const r = await smtpSend(cfg(f.port), msg, plain);
    await new Promise((res) => setTimeout(res, 150));   /* QUIT 이 가짜 서버에 닿을 때까지 */
    f.close();
    const seq = f.got.filter((l) => !l.startsWith('DATA:')).map((l) => l.split(/[ :]/)[0]);
    ok('정상 발송 — ok · messageId', r.ok && /^<.+@mail\.sogaebank\.com>$/.test(r.messageId ?? ''), r);
    ok('명령 순서 EHLO · AUTH · 아이디 · 비밀번호 · MAIL · RCPT · DATA · QUIT',
      JSON.stringify(seq) === JSON.stringify(['EHLO', 'AUTH', Buffer.from('AKIAFAKEUSER').toString('base64'), Buffer.from(PASS).toString('base64'), 'MAIL', 'RCPT', 'DATA', 'QUIT']), seq);
    ok('아이디 · 비밀번호는 base64 로', b64dec(f.got[2]) === 'AKIAFAKEUSER' && b64dec(f.got[3]) === PASS);
    ok('MAIL FROM · RCPT TO 주소', f.got.includes('MAIL FROM:<no-reply@mail.sogaebank.com>') && f.got.includes('RCPT TO:<buyer@example.com>'));
    const data = (f.got.find((l) => l.startsWith('DATA:')) ?? '').slice(5);
    const [head, body] = data.split('\r\n\r\n');
    const subj = /Subject: =\?UTF-8\?B\?([^?]+)\?=/.exec(head)?.[1] ?? '';
    ok('제목 한글 복원', b64dec(subj) === msg.subject, b64dec(subj));
    ok('보내는 이름 · 주소', /From: =\?UTF-8\?B\?[^?]+\?= <no-reply@mail\.sogaebank\.com>/.test(head));
    ok('본문 base64 · 한글 복원', b64dec((body ?? '').replace(/\r\n/g, '')) === msg.text);
    ok('본문 줄 길이 76 이하 · 「.」 한 줄 없음', (body ?? '').split('\r\n').every((l) => l.length <= 76 && l !== '.'));
  }
  /* ② 비밀번호 거절 */
  {
    const f = await fakeServer('badpass');
    const r = await smtpSend(cfg(f.port), msg, plain);
    f.close();
    ok('비밀번호 거절 → AUTH', !r.ok && r.errorKind === 'AUTH', r);
    ok('오류 문구에 비밀번호 없음', !JSON.stringify(r).includes(PASS) && !JSON.stringify(r).includes(Buffer.from(PASS).toString('base64')));
  }
  /* ③ 받는 주소 거절 */
  {
    const f = await fakeServer('badrcpt');
    const r = await smtpSend(cfg(f.port), msg, plain);
    f.close();
    ok('받는 주소 거절 → REJECTED', !r.ok && r.errorKind === 'REJECTED' && /550/.test(r.error ?? ''), r);
  }
  /* ④ 응답 없음 */
  {
    const f = await fakeServer('silent');
    const t0 = Date.now();
    const r = await smtpSend(cfg(f.port, 500), msg, plain);
    f.close();
    ok('응답 없음 → TIMEOUT · 제한 시간 안에 끝남', !r.ok && r.errorKind === 'TIMEOUT' && Date.now() - t0 < 3000, { r, ms: Date.now() - t0 });
  }
  /* ⑤ 연결 거부 */
  {
    const f = await fakeServer('ok'); const port = f.port; f.close();
    await new Promise((r) => setTimeout(r, 100));
    const r = await smtpSend(cfg(port), msg, plain);
    ok('연결 거부 → NETWORK', !r.ok && r.errorKind === 'NETWORK', r);
  }
  /* ⑥ 머리줄 끼워 넣기 */
  {
    let connected = false;
    const spy = (c: SmtpConfig) => { connected = true; return plain(c); };
    const r1 = await smtpSend(cfg(1), { ...msg, to: 'a@example.com\r\nBcc: x@evil.com' }, spy);
    const r2 = await smtpSend(cfg(1), { ...msg, subject: '제목\r\nBcc: x@evil.com' }, spy);
    ok('받는 주소 · 제목 줄바꿈 → BAD_INPUT · 연결 안 함', r1.errorKind === 'BAD_INPUT' && r2.errorKind === 'BAD_INPUT' && !connected);
  }
  /* ⑦ 설정 */
  {
    const svc = new MailService(null as any);
    const full = { SMTP_HOST: 'h', SMTP_USER: 'u', SMTP_PASS: 'p', MAIL_FROM: 'no-reply@mail.sogaebank.com' } as any;
    ok('설정 넷 다 있으면 · 기본 포트 465 · 이름 소개뱅크', svc.config(full)?.port === 465 && svc.config(full)?.fromName === '소개뱅크');
    ok('사용자 이름 · 비밀번호 · 보내는 주소 중 하나라도 빠지면 null', ['SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'].every((k) => svc.config({ ...full, [k]: '' }) === null));
    ok('v10.140 — 주소(SMTP_HOST)가 비면 서울 SES 기본값', svc.config({ ...full, SMTP_HOST: '' })?.host === SES_SEOUL_HOST && SES_SEOUL_HOST === 'email-smtp.ap-northeast-2.amazonaws.com');
    ok('보내는 주소는 운영 설정(notify.mail_from)이 우선', svc.config(full, 'help@sogaebank.com')?.from === 'help@sogaebank.com');
    ok('운영 설정이 비면 MAIL_FROM', svc.config(full, '')?.from === 'no-reply@mail.sogaebank.com');
    ok('둘 다 비면 null', svc.config({ ...full, MAIL_FROM: '' }, '') === null);
  }
  /* 모양 확인용 — buildMessage 가 머리줄과 본문 사이를 빈 줄 하나로 나누는가 */
  ok('머리줄 · 본문 사이 빈 줄 하나', buildMessage(cfg(1), msg, '<x@y>').split('\r\n\r\n').length === 2);

  console.log(fail ? `메일 발송기 시험 — 실패 ${fail}` : '메일 발송기 시험 — 전체 통과');
  process.exit(fail ? 1 : 0);
})();

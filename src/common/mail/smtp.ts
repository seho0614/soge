import * as net from 'net';
import * as tls from 'tls';
import { randomBytes } from 'crypto';

/* ---------------------------------------------------------------------
 * v10.43 (2026-10-15) — 아주 작은 SMTP 발송기 (Amazon SES SMTP 용)
 *
 * 왜 직접 쓰나 — 서버에서는 npm install 을 하지 않으므로 패키지(nodemailer)를 더하면 package-lock 을 맞출 수 없습니다.
 *   Node 내장 tls 만으로 「글자 메일 한 통 보내기」에 필요한 것만 합니다:
 *   EHLO → AUTH LOGIN → MAIL FROM → RCPT TO → DATA → QUIT (465 · 처음부터 TLS — SES 가 받는 방식)
 *
 * 하지 않는 것 — 첨부 · HTML · 여러 수신자 · STARTTLS(587). 필요해지면 그때 패키지로 바꿉니다.
 *
 * 머리줄 끼워 넣기 막기 — 받는 주소 · 제목에 줄바꿈이 있으면 보내지 않습니다.
 * 본문은 base64 로 실어 「.」 한 줄(끝 표시)과 긴 줄 문제가 생기지 않습니다.
 * 비밀번호 · 본문은 오류 문구에 싣지 않습니다(서버 응답 첫 줄만, 120자까지).
 * ------------------------------------------------------------------- */

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  /** 보내는 주소 — 예: no-reply@mail.sogaebank.com */
  from: string;
  /** 보내는 이름 — 예: 소개뱅크 */
  fromName?: string;
  timeoutMs?: number;
}

export interface MailMessage { to: string; subject: string; text: string }

export type SmtpErrorKind = 'NETWORK' | 'TIMEOUT' | 'AUTH' | 'REJECTED' | 'BAD_INPUT';
export interface SmtpResult { ok: boolean; messageId?: string; errorKind?: SmtpErrorKind; error?: string }

/** 시험에서 TLS 대신 일반 소켓을 끼우기 위해 연결 함수만 받습니다 */
export type SmtpConnect = (cfg: SmtpConfig) => net.Socket;

const tlsConnect: SmtpConnect = (cfg) =>
  tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host });

const EMAIL_RE = /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/;
const enc = (s: string) => `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
const wrap76 = (b64: string) => (b64.match(/.{1,76}/g) ?? []).join('\r\n');

/** 메일 본문(머리줄 + base64 본문). 시험에서 모양을 확인하려고 내보냅니다 */
export function buildMessage(cfg: SmtpConfig, m: MailMessage, messageId: string, now = new Date()): string {
  const from = cfg.fromName ? `${enc(cfg.fromName)} <${cfg.from}>` : cfg.from;
  return [
    `From: ${from}`,
    `To: ${m.to}`,
    `Subject: ${enc(m.subject)}`,
    `Date: ${now.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(Buffer.from(m.text, 'utf8').toString('base64')),
  ].join('\r\n');
}

export async function smtpSend(cfg: SmtpConfig, m: MailMessage, connect: SmtpConnect = tlsConnect): Promise<SmtpResult> {
  if (!EMAIL_RE.test(m.to) || /[\r\n]/.test(m.to) || /[\r\n]/.test(m.subject) || !EMAIL_RE.test(cfg.from)) {
    return { ok: false, errorKind: 'BAD_INPUT', error: '받는 주소 · 제목 · 보내는 주소 형식이 맞지 않습니다' };
  }
  const domain = cfg.from.split('@')[1];
  const messageId = `<${Date.now().toString(36)}.${randomBytes(8).toString('hex')}@${domain}>`;
  const sock = connect(cfg);
  sock.setEncoding('utf8');

  let buf = '';
  let waiter: ((line: string | Error) => void) | null = null;
  const lines: string[] = [];
  let failed: Error | null = null;

  /* 응답은 「250-…」 줄이 이어지다가 「250 …」 한 줄로 끝납니다 — 끝 줄만 넘깁니다 */
  sock.on('data', (chunk: string) => {
    buf += chunk;
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
      if (/^\d{3}-/.test(line)) continue;
      if (waiter) { const w = waiter; waiter = null; w(line); } else lines.push(line);
    }
  });
  const fail = (e: Error) => { failed = failed ?? e; if (waiter) { const w = waiter; waiter = null; w(e); } };
  sock.on('error', fail);
  sock.on('close', () => fail(new Error('연결이 닫혔습니다')));

  const timeoutMs = cfg.timeoutMs ?? 10000;
  const timer = setTimeout(() => { fail(Object.assign(new Error('응답 시간 초과'), { timeout: true })); sock.destroy(); }, timeoutMs);

  const reply = (): Promise<string> => new Promise((resolve, reject) => {
    if (lines.length) return resolve(lines.shift()!);
    if (failed) return reject(failed);
    waiter = (v) => (v instanceof Error ? reject(v) : resolve(v));
  });
  const step = async (cmd: string | null, want: number, kind: SmtpErrorKind): Promise<void> => {
    if (cmd !== null) sock.write(cmd + '\r\n');
    const line = await reply();
    if (Number(line.slice(0, 3)) !== want) {
      throw Object.assign(new Error(line.slice(0, 120)), { kind });
    }
  };

  try {
    await step(null, 220, 'REJECTED');
    await step(`EHLO ${domain}`, 250, 'REJECTED');
    await step('AUTH LOGIN', 334, 'AUTH');
    await step(Buffer.from(cfg.user).toString('base64'), 334, 'AUTH');
    await step(Buffer.from(cfg.pass).toString('base64'), 235, 'AUTH');
    await step(`MAIL FROM:<${cfg.from}>`, 250, 'REJECTED');
    await step(`RCPT TO:<${m.to}>`, 250, 'REJECTED');
    await step('DATA', 354, 'REJECTED');
    await step(buildMessage(cfg, m, messageId) + '\r\n.', 250, 'REJECTED');
    sock.write('QUIT\r\n');
    return { ok: true, messageId };
  } catch (e: any) {
    const kind: SmtpErrorKind = e?.kind ?? (e?.timeout ? 'TIMEOUT' : 'NETWORK');
    return { ok: false, errorKind: kind, error: String(e?.message ?? e).slice(0, 120) };
  } finally {
    clearTimeout(timer);
    sock.removeAllListeners('close');
    sock.end();
  }
}

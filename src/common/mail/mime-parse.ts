/* ---------------------------------------------------------------------
 * v10.789 (D330 · docs/904) 받은 메일 원본(MIME) 풀기 — 공용 메일함(W1)
 *
 *   새 패키지 없이 Node 기본 기능만(Buffer · TextDecoder). 받은 원본은 SES 받기 → SNS(Base64) 로 옴 — 바이트 그대로 받아 풂.
 *   · 머리: 이어진 줄 붙이기 · RFC 2047 인코딩 낱말(=?charset?B|Q?…?=) · 주소 목록(이름 <주소>) · 날짜
 *   · 본문: multipart/*(경계로 나눔 · 깊이 10 · 조각 200 까지) · base64 · quoted-printable · 7bit/8bit/binary
 *   · 글자: charset 대로 TextDecoder(utf-8 · euc-kr · ks_c_5601-1987 · iso-8859-1 · …) — 모르는 charset 은 utf-8 로(깨지면 대체 문자)
 *   · 첨부: Content-Disposition attachment · 또는 이름(filename · name · RFC 2231 filename*) 이 있는 글이 아닌 조각 · inline 그림(cid)
 *   ★ 화면에 보이기 전 안전 처리는 화면 쪽(격리 틀 sandbox · CSP) — 여기서는 풀기만(HTML 은 그대로 돌려줌).
 * ------------------------------------------------------------------- */

export interface MailAddress { name: string | null; address: string }
export interface MailAttachment { filename: string; contentType: string; size: number; contentId: string | null; inline: boolean; data: Buffer }
export interface ParsedMail {
  subject: string | null;
  from: MailAddress | null;
  to: MailAddress[];
  cc: MailAddress[];
  date: Date | null;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  text: string | null;
  html: string | null;
  attachments: MailAttachment[];
}

const MAX_DEPTH = 10;
const MAX_PARTS = 200;

/** 바이트 → 글자(charset) — 모르는 이름은 utf-8 */
export function decodeCharset(buf: Buffer, charset: string | null | undefined): string {
  const cs = (charset || 'utf-8').trim().toLowerCase().replace(/^["']|["']$/g, '');
  const alias: Record<string, string> = { 'ks_c_5601-1987': 'euc-kr', 'ks_c_5601': 'euc-kr', 'cp949': 'euc-kr', 'x-windows-949': 'euc-kr', 'unicode-1-1-utf-7': 'utf-8', 'us-ascii': 'utf-8', 'ascii': 'utf-8' };
  const name = alias[cs] ?? cs;
  try { return new TextDecoder(name).decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
}

function qpDecode(s: string, header = false): Buffer {
  const src = header ? s.replace(/_/g, ' ') : s.replace(/=\r?\n/g, '');
  const out: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(src.slice(i + 1, i + 3))) { out.push(parseInt(src.slice(i + 1, i + 3), 16)); i += 2; }
    else out.push(src.charCodeAt(i) & 0xff);
  }
  return Buffer.from(out);
}

/** RFC 2047 인코딩 낱말 풀기 — 붙어 있는 인코딩 낱말 사이 빈칸은 지움 */
export function decodeWords(v: string): string {
  const s = v.replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?[^?]+\?[BbQq]\?[^?]*\?=)/g, '$1');
  return s.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, cs: string, enc: string, txt: string) => {
    const charset = cs.split('*')[0];
    const buf = enc.toUpperCase() === 'B' ? Buffer.from(txt, 'base64') : qpDecode(txt, true);
    return decodeCharset(buf, charset);
  });
}

/** 머리 줄들 → 이름(소문자) 별 값 목록 · 이어진 줄 붙임 · 값은 latin1(바이트 그대로) */
function parseHeaders(raw: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const lines = raw.replace(/\r\n/g, '\n').replace(/\n[ \t]+/g, ' ').split('\n');
  for (const l of lines) {
    const i = l.indexOf(':');
    if (i <= 0) continue;
    const k = l.slice(0, i).trim().toLowerCase();
    const arr = map.get(k) ?? [];
    arr.push(l.slice(i + 1).trim());
    map.set(k, arr);
  }
  return map;
}

/** 8bit 머리(인코딩 없이 utf-8 바이트)를 글자로 — latin1 로 읽은 값을 바이트로 되돌려 utf-8 시도 */
function headerText(v: string | undefined): string | null {
  if (v == null) return null;
  let s = v;
  if (/[\u0080-ÿ]/.test(s)) {
    const u = Buffer.from(s, 'latin1').toString('utf8');
    if (!u.includes('�')) s = u;
  }
  return decodeWords(s).trim();
}

/** Content-Type · Content-Disposition 값 → 본값 · 매개변수(RFC 2231 이어진 · 인코딩 매개변수 포함) */
export function parseParams(v: string | undefined): { value: string; params: Record<string, string> } {
  if (!v) return { value: '', params: {} };
  const parts: string[] = [];
  let cur = '', q = false;
  for (const ch of v) {
    if (ch === '"') q = !q;
    if (ch === ';' && !q) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  const value = (parts.shift() ?? '').trim().toLowerCase();
  const raw: Record<string, string> = {};
  for (const p of parts) {
    const i = p.indexOf('=');
    if (i <= 0) continue;
    raw[p.slice(0, i).trim().toLowerCase()] = p.slice(i + 1).trim().replace(/^"(.*)"$/s, '$1');
  }
  const params: Record<string, string> = {};
  const cont: Record<string, { n: number; v: string; enc: boolean }[]> = {};
  for (const [k, val] of Object.entries(raw)) {
    const m = /^([^*]+)\*(\d+)?(\*)?$/.exec(k);
    if (!m) { params[k] = val; continue; }
    (cont[m[1]!] ??= []).push({ n: m[2] ? Number(m[2]) : 0, v: val, enc: !!m[3] || (!m[2] && k.endsWith('*')) });
  }
  for (const [k, segs] of Object.entries(cont)) {
    segs.sort((a, b) => a.n - b.n);
    let charset = 'utf-8';
    const bytes: Buffer[] = [];
    segs.forEach((s, idx) => {
      let v2 = s.v;
      if (s.enc) {
        if (idx === 0) { const m2 = /^([^']*)'[^']*'(.*)$/s.exec(v2); if (m2) { charset = m2[1] || charset; v2 = m2[2]!; } }
        bytes.push(Buffer.from(v2.replace(/%([0-9A-Fa-f]{2})/g, (_x, h: string) => String.fromCharCode(parseInt(h, 16))), 'latin1'));
      } else bytes.push(Buffer.from(v2, 'latin1'));
    });
    params[k] = decodeCharset(Buffer.concat(bytes), charset);
  }
  return { value, params };
}

/** 주소 목록 「이름 <주소>, 주소」 → 목록 (따옴표 · 꺾쇠 안 쉼표 무시) */
export function parseAddressList(v: string | null): MailAddress[] {
  if (!v) return [];
  const out: MailAddress[] = [];
  let cur = '', q = false, a = 0;
  const push = () => {
    const s = cur.trim(); cur = '';
    if (!s) return;
    const m = /^(.*)<([^<>]+)>\s*$/s.exec(s);
    const address = (m ? m[2]! : s).trim().replace(/^mailto:/i, '');
    const name = m ? m[1]!.trim().replace(/^"(.*)"$/s, '$1').trim() || null : null;
    if (/^[^@\s<>"]+@[^@\s<>"]+$/.test(address)) out.push({ name, address: address.toLowerCase() });
  };
  for (const ch of v) {
    if (ch === '"') q = !q;
    if (ch === '<' && !q) a++;
    if (ch === '>' && !q && a > 0) a--;
    if (ch === ',' && !q && a === 0) push(); else cur += ch;
  }
  push();
  return out.slice(0, 200);
}

function transfer(body: Buffer, enc: string | undefined): Buffer {
  const e = (enc || '').trim().toLowerCase();
  if (e === 'base64') return Buffer.from(body.toString('latin1').replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
  if (e === 'quoted-printable') return qpDecode(body.toString('latin1'));
  return body;
}

function splitHead(buf: Buffer): { head: string; body: Buffer } {
  const s = buf.toString('latin1');
  const m = /\r?\n\r?\n/.exec(s);
  if (!m) return { head: s, body: Buffer.alloc(0) };
  return { head: s.slice(0, m.index), body: buf.subarray(m.index + m[0].length) };
}

interface Acc { text: string[]; html: string[]; atts: MailAttachment[]; parts: number }

function walk(buf: Buffer, acc: Acc, depth: number): void {
  if (depth > MAX_DEPTH || acc.parts >= MAX_PARTS) return;
  acc.parts++;
  const { head, body } = splitHead(buf);
  const h = parseHeaders(head);
  const ct = parseParams(h.get('content-type')?.[0] ?? 'text/plain; charset=us-ascii');
  const cd = parseParams(h.get('content-disposition')?.[0]);
  const enc = h.get('content-transfer-encoding')?.[0];
  if (ct.value.startsWith('multipart/') && ct.params.boundary) {
    const b = '--' + ct.params.boundary;
    const s = body.toString('latin1');
    const chunks = s.split(new RegExp('(?:^|\\r?\\n)' + b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:--)?[ \\t]*(?=\\r?\\n|$)'));
    for (let i = 1; i < chunks.length; i++) {
      const c = chunks[i]!.replace(/^\r?\n/, '');
      if (!c.trim()) continue;
      walk(Buffer.from(c, 'latin1'), acc, depth + 1);
    }
    return;
  }
  if (ct.value === 'message/rfc822') {   // 붙은 메일은 첨부로
    acc.atts.push({ filename: 'message.eml', contentType: 'message/rfc822', size: body.length, contentId: null, inline: false, data: transfer(body, enc) });
    return;
  }
  const data = transfer(body, enc);
  const fname = cd.params.filename ?? ct.params.name ?? null;
  const isText = ct.value === 'text/plain' || ct.value === 'text/html';
  const attach = cd.value === 'attachment' || (!!fname && !isText) || (!isText && ct.value !== '');
  if (!attach && isText) {
    const t = decodeCharset(data, ct.params.charset);
    (ct.value === 'text/html' ? acc.html : acc.text).push(t);
    return;
  }
  const cid = h.get('content-id')?.[0]?.replace(/^<|>$/g, '').trim() || null;
  acc.atts.push({
    filename: (headerText(fname ?? undefined) || (ct.value === 'text/html' ? 'body.html' : 'attachment')).slice(0, 255),
    contentType: (ct.value || 'application/octet-stream').slice(0, 200),
    size: data.length, contentId: cid ? cid.slice(0, 300) : null, inline: cd.value === 'inline' || (!!cid && cd.value !== 'attachment'), data,
  });
}

/** 받은 원본(바이트) → 풀린 메일 */
export function parseMail(raw: Buffer): ParsedMail {
  const { head } = splitHead(raw);
  const h = parseHeaders(head);
  const acc: Acc = { text: [], html: [], atts: [], parts: 0 };
  walk(raw, acc, 0);
  const one = (k: string) => headerText(h.get(k)?.[0]);
  const ids = (v: string | null) => (v ?? '').match(/<[^<>\s]+>/g)?.map((x) => x.slice(1, -1)) ?? [];
  const d = one('date');
  const date = d ? new Date(d) : null;
  return {
    subject: one('subject'),
    from: parseAddressList(one('from'))[0] ?? null,
    to: parseAddressList(one('to')),
    cc: parseAddressList(one('cc')),
    date: date && !isNaN(date.getTime()) ? date : null,
    messageId: ids(one('message-id'))[0] ?? null,
    inReplyTo: ids(one('in-reply-to'))[0] ?? null,
    references: ids(one('references')).slice(0, 50),
    text: acc.text.length ? acc.text.join('\n') : null,
    html: acc.html.length ? acc.html.join('\n') : null,
    attachments: acc.atts,
  };
}

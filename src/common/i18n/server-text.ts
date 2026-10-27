/**
 * v10.125 (docs/189) — API 가 보내는 한국어 오류 · 안내 글을 화면 언어로.
 *
 *   ① 고정 글은 사전(server-text.en.ts)에서 그대로 찾고 ② 값이 들어간 글은 {0} 자리를 뺀 모양으로 맞춰 봅니다.
 *      자리에 들어간 값도 사전에 있는 글이면 함께 옮깁니다(앞 안내 + 뒤 안내를 붙인 글 등).
 *   ③ 사전에 없으면 한국어 그대로 — 틀린 글자보다 원문이 낫습니다. 지금은 영어(en)만 · 다른 언어는 원문.
 *   부르는 곳: 응답 출구(ServerTextInterceptor — note · warning · reason · message · notice 칸) · 오류 출구(DbErrorFilter — message).
 */
import { SERVER_TEXT_EN } from './server-text.en';

type Pat = { re: RegExp; en: string };
const DICTS: Record<string, Record<string, string>> = { en: SERVER_TEXT_EN };
const pats = new Map<string, Pat[]>();

function patterns(lang: string): Pat[] {
  let p = pats.get(lang);
  if (p) return p;
  p = Object.entries(DICTS[lang] ?? {})
    .filter(([ko]) => /\{\d+\}/.test(ko))
    .map(([ko, en]) => ({
      re: new RegExp('^' + ko.split(/(\{\d+\})/).map((s) => (/^\{\d+\}$/.test(s) ? '([\\s\\S]*?)' : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('') + '$'),
      en,
    }))
    .sort((a, b) => b.re.source.length - a.re.source.length);   // 긴(구체적인) 모양 먼저
  pats.set(lang, p);
  return p;
}

/** 화면 언어로 — 사전에 없으면 원문 그대로 */
export function serverText(text: string, lang: string | null | undefined, depth = 0): string {
  if (!lang || !text || text.length > 500 || !/[가-힣]/.test(text)) return text;   // 긴 글(회원이 쓴 글 등)은 맞춰 보지 않음
  const d = DICTS[lang];
  if (!d) return text;
  const t = text.trim();
  const hit = d[text] ?? d[t];
  if (hit != null) return text === t ? hit : text.replace(t, hit);   // 앞뒤 빈칸은 그대로(붙인 글의 앞 안내 등)
  if (depth > 1) return text;
  for (const p of patterns(lang)) {
    const m = p.re.exec(text);
    if (m) return p.en.replace(/\{(\d+)\}/g, (_, i: string) => serverText(m[Number(i) + 1] ?? '', lang, depth + 1));
  }
  return text;
}

const KEYS = new Set(['note', 'warning', 'reason', 'message', 'notice']);
const MAX_NODES = 20_000;

/** 응답 몸통의 안내 칸(note · warning · reason · message · notice)만 그 자리에서 옮김 */
export function translateBody(v: unknown, lang: string, c = { n: 0 }): void {
  if (++c.n > MAX_NODES || v == null || typeof v !== 'object') return;
  if (Array.isArray(v)) { for (const x of v) translateBody(x, lang, c); return; }
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return;
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    const x = o[k];
    if (typeof x === 'string') { if (KEYS.has(k)) o[k] = serverText(x, lang); }
    else if (x && typeof x === 'object') translateBody(x, lang, c);
  }
}

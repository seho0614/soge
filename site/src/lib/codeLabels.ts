/**
 * v10.122 — API 응답의 코드 이름표 글자(DB code_labels 에서 온 statusLabel · reasonLabel · gradeLabel · label …)를 화면 언어로.
 *
 *   서버는 code_labels 의 한국어 이름표를 그대로 내려 줍니다(25곳 넘음). 화면마다 고치는 대신 이 한 곳에서 바꿉니다.
 *   규칙: 화면 언어가 한국어가 아니면, 이름이 label 이거나 …Label 로 끝나는 칸의 값이 **codes 사전의 한국어 이름표와 똑같을 때만**
 *   그 언어 글자로 바꿉니다. 한국어 화면은 아무것도 하지 않습니다(응답 그대로).
 *   같은 한국어가 갈래마다 다른 글자로 옮겨지면(겹침) 바꾸지 않습니다 — 틀린 글자보다 원문이 낫습니다.
 */
import { getLocale } from 'next-intl/server';
import { messagesFor } from '@/i18n/messages';
import koCodes from '@/i18n/messages/ko/codes.json';

type Tree = { [k: string]: string | Tree };
const maps = new Map<string, Map<string, string>>();

function flat(t: Tree, pre = '', out = new Map<string, string>()) {
  for (const [k, v] of Object.entries(t)) {
    if (typeof v === 'string') out.set(pre + k, v); else flat(v, `${pre}${k}.`, out);
  }
  return out;
}

async function mapFor(locale: string) {
  let m = maps.get(locale);
  if (m) return m;
  const ko = flat(koCodes as Tree);
  const to = flat(((await messagesFor(locale)).codes ?? {}) as Tree);
  const seen = new Map<string, string | null>();
  for (const [path, koText] of ko) {
    const v = to.get(path);
    if (!v || v === koText) continue;
    const prev = seen.get(koText);
    seen.set(koText, prev === undefined || prev === v ? v : null);   // 겹침 → null
  }
  m = new Map([...seen].filter((e): e is [string, string] => e[1] !== null));
  maps.set(locale, m);
  return m;
}

const LABEL = /^(label|[a-z][A-Za-z]*Label)$/;

function walk(x: unknown, m: Map<string, string>): unknown {
  if (Array.isArray(x)) return x.map((v) => walk(v, m));
  if (!x || typeof x !== 'object') return x;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(x)) {
    out[k] = typeof v === 'string' && LABEL.test(k) ? (m.get(v) ?? v) : walk(v, m);
  }
  return out;
}

/** 화면 언어가 한국어면 body 그대로 · 아니면 이름표 칸만 바꾼 사본 */
export async function localizeLabels<T>(body: T): Promise<T> {
  /* 쿠키를 읽는 apiGet · apiGetPersonal · apiGetVisitor 에서만 부릅니다(이미 요청마다 그리는 화면). getLocale 의 오류는 잡지 않습니다 —
   * 잡으면 Next 가 「요청마다 그릴 화면」을 알아채지 못해 빌드가 멈춥니다(v10.122 시험 때 한 번). */
  const locale = await getLocale();
  if (locale === 'ko') return body;
  return walk(body, await mapFor(locale)) as T;
}

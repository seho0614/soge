/**
 * 규칙 코드를 작게(v10.132 · docs/198 · 대표 「작게 남김」) — 안내 글의 「(A-07)」 · 「INV-2」 같은 규칙 번호를 본문보다 작고 옅게.
 *   손님이 문의할 때 말할 수 있게 지우지는 않습니다. 글 · 번역은 그대로이고 그리는 모양만 바꿉니다(한국어 · 영어 같음).
 *   withCodes(t('key')) · withCodes(t.rich('key', {...})) — 문자열이든 t.rich 결과(요소 · 배열)든 안의 글자만 찾아 감쌉니다.
 *   ① 괄호 안이 코드뿐이면 괄호째 「(A-07)」 · 「(INV-9 · INV-11)」 ② 그 밖은 코드 낱말만 「A-07」.
 *   placeholder · title 같은 속성 글은 꾸밀 수 없어 그대로 둡니다.
 */
import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';

const CODE = String.raw`[A-Z]{1,4}-\d{1,3}R?`;
const RE = new RegExp(String.raw`(\s?\((?:\s*(?:${CODE}|·|,|예외|exception)\s*)+\)|\b${CODE}\b)`, 'g');

function splitText(s: string, k: string): ReactNode {
  if (!RE.test(s)) return s;
  RE.lastIndex = 0;
  const out: ReactNode[] = [];
  let last = 0, i = 0;
  for (const m of s.matchAll(RE)) {
    if (m.index! > last) out.push(s.slice(last, m.index));
    out.push(<small key={`${k}-${i++}`} className="rule-code">{m[0]}</small>);
    last = m.index! + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

export function withCodes(node: ReactNode, k = 'rc'): ReactNode {
  if (typeof node === 'string') return splitText(node, k);
  if (Array.isArray(node)) return node.map((n, i) => withCodes(n, `${k}.${i}`));
  if (isValidElement(node)) {
    const el = node as ReactElement<{ children?: ReactNode }>;
    if (el.props.children === undefined) return el;
    return cloneElement(el, undefined, ...Children.toArray(withCodes(el.props.children, k) as ReactNode));
  }
  return node;
}

/**
 * v10.120 — 로그인 전 관심 성향 답(시안 loginCta 「가입 전에도 할 수 있습니다」).
 *
 * 손님이 고른 답은 **이 탭에만**(sessionStorage) 둡니다 — 서버 · DB 에 보내지 않고, 탭을 닫으면 지워집니다(함께 쓰는 PC).
 * 로그인 · 가입 뒤 성향 화면 · 가입 5단계가 답을 채워 보이기만 합니다. 저장은 회원이 맞춤형 광고에 동의하고
 * 「성향 등록하기」를 누를 때만(D123 — 동의는 계정 주인이 직접 · 대표 결정 「가」 2026-10-26).
 * 저장 · 「다시 하기」 · 「성향 쓰지 않기」 뒤에는 지웁니다. 저장소를 못 쓰는 브라우저면 아무것도 하지 않습니다.
 */
const KEY = 'sgb_prf_draft';

export type Answers = Record<string, string[]>;

export function saveDraft(ans: Answers) {
  try {
    if (Object.keys(ans).length) sessionStorage.setItem(KEY, JSON.stringify(ans));
    else sessionStorage.removeItem(KEY);
  } catch { /* 저장소 막힘 — 채워 주지 못할 뿐 */ }
}

/** 지금 문항에 있는 문항 · 보기 코드만 돌려줍니다(문항이 바뀌었거나 값이 망가졌으면 버림) · 없으면 null */
export function loadDraft(questions: Array<{ code: string; isMulti?: boolean; options: Array<{ code: string }> }>): Answers | null {
  let raw: unknown;
  try { raw = JSON.parse(sessionStorage.getItem(KEY) ?? 'null'); } catch { return null; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Answers = {};
  for (const q of questions) {
    const v = (raw as Record<string, unknown>)[q.code];
    if (!Array.isArray(v)) continue;
    const ok = [...new Set(v.filter((x): x is string => typeof x === 'string' && q.options.some((o) => o.code === x)))];
    const keep = q.isMulti ? ok : ok.slice(0, 1);
    if (keep.length) out[q.code] = keep;
  }
  return Object.keys(out).length ? out : null;
}

export function clearDraft() {
  try { sessionStorage.removeItem(KEY); } catch { /* 없음 */ }
}

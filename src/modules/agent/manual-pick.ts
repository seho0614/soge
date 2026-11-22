/* ---------------------------------------------------------------------
 * v10.634 · 637 (docs/778 · 781) 사용자 설명서 절 고르기 — 다른 모듈을 읽지 않는 순수 함수(시험이 node 로 직접 돌림 · test_v1637)
 *   splitManual(body)         ### 제목마다 한 절(m1, m2 …) — HelpService.sections 가 이것을 씀
 *   manualScore(sec, words)   질문 낱말이 절 제목에 있으면 3점 · 장 제목에 있으면 2점 · 본문에 있으면 1점
 *   manualBlock(v, secs, q, max)  다 들어가면 모두 · 넘으면 점수 높은 절부터 max 자까지 고른 뒤 원래 순서로
 * ------------------------------------------------------------------- */
export type ManualSec = { id: string; heading: string; text: string; chapter?: string };   // chapter = 위 「## 장」 제목(v10.637 · 점수에만)

export function splitManual(body: string): ManualSec[] {
  const out: ManualSec[] = [];
  let cur: ManualSec | null = null;
  let chapter = '';
  for (const line of body.split('\n')) {
    const h = /^###\s+(.+?)\s*$/.exec(line);
    if (h) { cur = { id: `m${out.length + 1}`, heading: h[1]!, text: '', chapter }; out.push(cur); continue; }
    const c = /^##\s+(.+?)\s*$/.exec(line);
    if (c) { cur = null; chapter = c[1]!; continue; }
    if (cur) cur.text += line + '\n';
  }
  for (const s of out) s.text = s.text.trim();
  return out;
}

const TAIL_RE = /(은|는|이|가|을|를|에|에서|으로|로|와|과|도|만|요|나요|까요|하나요|해요|하려면|하면|인가요|있나요|되나요|싶어요|싶은데)$/;

/** 질문 → 낱말(두 글자 이상 · 끝 토씨 · 어미 뗌 · 30개까지) */
export function manualWords(question: string): string[] {
  return [...new Set((question.match(/[가-힣A-Za-z0-9]{2,}/g) ?? []).map((w) => w.replace(TAIL_RE, '')).filter((w) => w.length >= 2))].slice(0, 30);
}

export function manualScore(sec: ManualSec, words: string[]) {
  let s = 0;
  for (const w of words) { if (sec.heading.includes(w)) s += 3; else if (sec.chapter?.includes(w)) s += 2; else if (sec.text.includes(w)) s += 1; }
  return s;
}

export function manualBlock(version: number, secs: ManualSec[], question: string, max: number) {
  const head = `## 사용자 설명서(${version}판 — 회원용 사용 방법)\n\n`;
  const one = (x: ManualSec) => `[설명서 ${x.id}] ${x.heading}\n${x.text}`;
  const all = head + secs.map(one).join('\n\n');
  if (all.length <= max) return { text: all, picked: secs.length, all: true, ids: secs.map((x) => x.id) };
  const words = manualWords(question);
  const order = secs.map((x, i) => ({ x, i, s: manualScore(x, words) })).sort((a, b) => b.s - a.s || a.i - b.i);
  const note = '(질문과 맞는 절만 — 전문은 /guide/manual)\n\n';
  const keep = new Set<number>(); let len = head.length + note.length;
  for (const o of order) { const l = one(o.x).length + 2; if (len + l > max) continue; keep.add(o.i); len += l; }
  const chosen = secs.filter((_, i) => keep.has(i));
  return { text: head + note + chosen.map(one).join('\n\n'), picked: keep.size, all: false, ids: chosen.map((x) => x.id),
           top: order.slice(0, 3).map((o) => o.x.id) };
}

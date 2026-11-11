import { TG_MAX, packLines } from './telegram.service';

/* ---------------------------------------------------------------------
 * v10.234 (docs/375) — 급한 알림 텔레그램 글 만들기(보내기 · 미리보기가 같은 함수)
 *
 *   v10.233 의 나눠 보내기(최대 3통 · (k/n) 머리 · 「n건 더」 · 안내는 마지막 통만 · 제목 200자)를
 *   정기 작업(alertPush)과 운영 화면 미리보기(push-preview)가 함께 씁니다. DB · 텔레그램을 부르지 않습니다.
 * ------------------------------------------------------------------- */
export interface PushItem { id: string; code: string; severity: string; title: string; raisedAt: string; again: boolean }

export const PUSH_PARTS = 3;
export const PUSH_TITLE_MAX = 200;

export interface PushPlan {
  /** 보낼 통마다 — 글 · 그 통에 든 알림 */
  parts: { text: string; items: PushItem[] }[];
  /** 3통에 다 넣은 알림 수 · 남은 수(「n건 더」 · 다음 차례) */
  included: number;
  more: number;
}

export function buildAlertPush(items: PushItem[], backlog: number): PushPlan {
  if (!items.length) return { parts: [], included: 0, more: 0 };
  const head = (list: PushItem[], k: number, of: number) => {
    const crit = list.filter((x) => x.severity === 'CRITICAL').length;
    const again = list.filter((x) => x.again).length;
    return `[소개뱅크] 급한 운영 알림 ${list.length}건${crit ? `(CRITICAL ${crit})` : ''}${again ? ` · 다시 알림 ${again}건(12시간 넘게 확인 안 함)` : ''}${of > 1 ? ` (${k}/${of})` : ''}`;
  };
  const tail = (more: number) => [
    ...(more ? ['', `보내지 못한 알림 ${more}건 더 — 다음 차례에 이어서 보냅니다(운영 화면 › 운영 알림에서 모두 볼 수 있음).`] : []),
    '',
    '운영 화면 › 운영 알림에서 보고 「확인」을 누르십시오.',
  ].join('\n');
  const line = (x: PushItem) => {
    const t = x.title.length > PUSH_TITLE_MAX ? `${x.title.slice(0, PUSH_TITLE_MAX - 1)}…` : x.title;
    return `- ${x.again ? '[다시] ' : ''}[${x.severity}] ${x.raisedAt} ${t}`;
  };
  /* 머리 · 끝 줄은 가장 길 때(모든 알림 · 남은 수 = backlog)로 자리를 잡고 남은 칸에 알림 줄을 채움 */
  const budget = TG_MAX - head(items, PUSH_PARTS, PUSH_PARTS).length - 2 - tail(Math.max(backlog, items.length)).length - 1;
  const groups = packLines(items.map(line), budget, PUSH_PARTS);
  const included = groups.reduce((n, g) => n + g.length, 0);
  const inc = items.slice(0, included);
  const more = Math.max(0, backlog - inc.filter((x) => !x.again).length);
  let at = 0;
  const parts = groups.map((g, i) => {
    const list = inc.slice(at, at + g.length);
    at += g.length;
    const last = i === groups.length - 1;
    return { text: [head(inc, i + 1, groups.length), '', ...g].join('\n') + (last ? `\n${tail(more)}` : ''), items: list };
  });
  return { parts, included, more };
}

/** 금액은 원 단위 정수로 옵니다. 자릿수가 흔들리면 비교가 안 됩니다. */
export const won = (n: number | null) =>
  n == null ? '협의' : n.toLocaleString('ko-KR') + '원';

export function ago(iso: string | null): string {
  if (!iso) return '';
  const d = Date.now() - new Date(iso).getTime();
  const h = Math.floor(d / 3_600_000);
  if (h < 1) return '방금';
  if (h < 24) return `${h}시간 전`;
  const day = Math.floor(h / 24);
  if (day < 30) return `${day}일 전`;
  return new Date(iso).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
}

/** 가입 연월 — 「2024.03」. 서버 시간대와 관계없이 한국 날짜입니다. */
export function ym(iso: string | null): string {
  if (!iso) return '';
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' })
    .formatToParts(new Date(iso));
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${v('year')}.${v('month')}`;
}

/* 관 코드 → 주소 조각. PATH_GWAN 의 역방향입니다 — 둘을 같이 고치십시오. */
export const GWAN_PATH: Record<string, string> = {
  MNY: 'money', MAL: 'mall', BIZ: 'biz', HLT: 'health',
};
/* 주소 조각 → 관 코드.
 *
 * ★ 건강상품(HLT)이 빠져 있어 `/health` 가 404 였습니다.
 *   DB 에도 있고 API 도 받는데 화면만 못 갔습니다 — 관 코드를
 *   코드에 박으면 관을 늘릴 때마다 이런 곳이 남습니다(함정 ⑦).
 *
 *   관을 더하시면 **여기와 GWAN_PATH 를 같이** 고치십시오.
 *   검정 ⑫ 가 관 코드 목록이 최신인지 감시합니다. */
export const PATH_GWAN: Record<string, string> = {
  money: 'MNY', mall: 'MAL', biz: 'BIZ', health: 'HLT',
};

/* 20261001 — 목록 정렬값. 주소창에 모르는 값(예: sort=PRICE_ASC)이 오면
 * API 가 400 을 주고 화면 전체가 500 이 되었습니다. 모르는 값은 기본 정렬로 돌립니다.
 * 서버 ListingQueryDto 의 SORT 와 같은 목록입니다. */
/* v10.31 (w2) — 시안 「마감임박 · 소개비율」 = DEADLINE · FEE_RATIO (별칭 deadline · ratio) */
const LIST_SORTS = new Set(['RECENT', 'RELEVANCE', 'FEE_DESC', 'POPULAR', 'DEADLINE', 'FEE_RATIO', 'AMOUNT_ASC', 'AMOUNT_DESC', 'new', 'recent', 'best', 'popular', 'fee', 'deadline', 'ratio']);
export const safeSort = (s?: string) => (s && LIST_SORTS.has(s) ? s : undefined);

/** 한국 날짜 「2026-10-08」 — 서버가 보낸 시각(UTC)을 한국 시각으로 바꿔 날짜만. v10.27 (G-185)
 *  전에는 시각 글자의 앞 10자(.slice(0, 10))를 써서 한국 시각 0 ~ 9시에 생긴 것이 전날로 보였습니다. 날짜만 있는 값(「2026-10-08」)은 그대로입니다. */
export function ymdKst(iso: string | null | undefined): string {
  if (!iso) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** v10.27 (G-201) — 날짜 · 시각을 「2026-10-08 20:05」(24시간)로 씁니다.
 *  toLocaleString('ko-KR') 은 서버(Node)에서 「PM 8:05」, 브라우저에서 「오후 8:05」로 달라
 *  ① 파트너센터 열람 기한에 영문 AM/PM 이 섞이고 ② 서버 · 브라우저가 같이 그리는 화면에서 글자가 어긋날 수 있었습니다. */
export function dtKst(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}
/** 시각만 「20:05」 */
export function hmKst(iso: string | null | undefined): string {
  const s = dtKst(iso);
  return s ? s.slice(11) : '';
}

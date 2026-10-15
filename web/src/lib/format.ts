/** 금액은 원 단위 정수로 옵니다. 소수점이 없습니다. */
export const won = (n: number | null | undefined) =>
  n == null ? '—' : `${n.toLocaleString('ko-KR')}원`;

export function ago(iso: string | null | undefined) {
  if (!iso) return '';
  const d = Date.now() - new Date(iso).getTime();
  const h = Math.floor(d / 3_600_000);
  if (h < 1) return '방금';
  if (h < 24) return `${h}시간 전`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}일 전`;
  return new Date(iso).toLocaleDateString('ko-KR');
}

/** SLA 잔여. 마감이 지나면 음수로 표시해 검수자가 바로 알아채게 합니다. */
export function remain(due: string | null | undefined) {
  if (!due) return { text: '', over: false };
  const ms = new Date(due).getTime() - Date.now();
  const h = Math.floor(Math.abs(ms) / 3_600_000);
  return ms < 0
    ? { text: `${h}시간 초과`, over: true }
    : { text: `${h}시간 남음`, over: false };
}

/** 한국 날짜 「2026-10-08」 — 서버가 보낸 시각(UTC)을 한국 시각으로 바꿔 날짜만. v10.27 (G-185)
 *  전에는 시각 글자의 앞 10자(.slice(0, 10))를 써서 한국 시각 0 ~ 9시에 생긴 것이 전날로 보였습니다. 날짜만 있는 값(「2026-10-08」)은 그대로입니다. */
export function ymdKst(iso: string | null | undefined): string {
  if (!iso) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

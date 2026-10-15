import { redirect } from 'next/navigation';

/** v10.31 (W5 · 10/10 시안 기준) — 리드 이용료 주소는 시안대로 /partner/cash 입니다. 옛 주소로 오면 그리로 보냅니다(북마크 · 알림 링크). */
export default function FeesMoved() {
  redirect('/partner/cash');
}

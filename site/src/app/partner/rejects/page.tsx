import { redirect } from 'next/navigation';

/** v10.31 (W5 · 10/10 시안 기준) — 반려 · 이의신청 주소는 시안대로 /partner/leads-rejects 입니다. 옛 주소(알림 링크 · 북마크)는 그리로 보냅니다. */
export default function RejectsMoved() {
  redirect('/partner/leads-rejects');
}

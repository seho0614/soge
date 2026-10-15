import { redirect } from 'next/navigation';

/**
 * v10.31 (W5 · 10/10 시안 기준 SB-PTC-CTR-950) — 견적 요청함은 파트너센터 틀 안 「전용 트랙」(/partner/tracks · 판금 · 도색 탭)으로 옮겼습니다.
 * 옛 주소(북마크 · 알림 링크)는 그리로 보냅니다. 전에는 일반 머리줄 틀에 파트너센터 메뉴 없이 떴고, 「새 요청이 없습니다」 아래 표에 받은 요청이 보여 문구와 표가 어긋났습니다.
 */
export default function RepairInboxMoved() {
  redirect('/partner/tracks');
}

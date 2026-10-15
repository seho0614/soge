import { redirect } from 'next/navigation';

/**
 * SB-MAL-GIV-010 — 일반 회원 소개하기 안내.
 * 올리신 kit(v10.4.7)의 주소(/mal/give)입니다. 이 kit 의 소개하기 화면은 /mall/give 에 있고
 * 소개코드 발급 · 결제까지 연결돼 있어(v10.9), 같은 화면으로 보냅니다.
 */
export default function MalGiveRedirect() {
  redirect('/mall/give');
}

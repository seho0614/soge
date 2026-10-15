import { createHmac } from 'node:crypto';

/**
 * 제휴 링크 귀속(G-190 · v10.27) — 방문자 쿠키(sgb_visitor) 값을 **해시로만** 남깁니다.
 *
 * 링크를 누를 때(GET /r/{code}) 이 해시로 aff_touches 에 한 줄 남기고, 소개몰 주문 때(POST /health/orders)
 * 같은 방문자의 72시간 안 클릭을 찾아 그 링크에 귀속합니다. 쿠키 · IP 원문은 어디에도 남기지 않습니다.
 * 클릭 집계(partner_link_clicks)의 해시는 날짜를 섞어 하루가 지나면 같은 사람인지 모르게 하지만,
 * 귀속은 72시간을 이어 봐야 해서 날짜를 섞지 않은 다른 해시(앞 글자 「touch|」)를 씁니다.
 */
export const AFF_WINDOW_HOURS = 72;
const VISITOR_RE = /^[A-Za-z0-9-]{8,64}$/;

export function affTouchHash(visitorKey?: string | null): string | null {
  if (!visitorKey || !VISITOR_RE.test(visitorKey)) return null;
  const secret = process.env.JWT_SECRET ?? process.env.ENC_KEY ?? 'sgb';
  return createHmac('sha256', secret).update(`touch|${visitorKey}`).digest('hex');
}

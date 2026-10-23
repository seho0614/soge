import { PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { PartnerActorService } from './partner-actor.service';

/** 내 파트너 계정. 없으면 null(신청 안내를 냄).
 *  v10.31 (W5 · CTR-610 계정) — 대표 계정 또는 합류한 직원 계정(business_members · 빠지지 않은).
 *  v10.86 — PartnerService · PartnerLeadService · PartnerMoneyService 가 같이 씀(partner.service.ts 의 mine() 을 옮김) */
export async function myPartner(actors: PartnerActorService) {
  const me = RequestCtx.actorId();
  if (!me) throw new PolicyViolation('UNAUTHORIZED', '로그인이 필요합니다.');
  const p = await actors.forMember(me);   // v10.39 — 조회는 PartnerActorService 한 곳
  if (!p) return null;
  const { canMoney: _money, ...mine } = p;           // 이 자리가 내보내던 칸 그대로(대시보드 응답에 펼쳐 넣음)
  return mine;
}

/**
 * v10.31 — 고객센터 운영 안내(시안 cs 화면 「운영 안내」 · ask1 「상담 가능 시간」).
 *   시안의 두 화면이 점심시간을 다르게 적었습니다(12:30 – 13:30 · 12:00 ~ 13:00) — 고객센터 화면 값 하나로 맞췄습니다(결정 기록).
 */
/* v10.101 — 글은 사전 키(deal.hours.*) — 부르는 쪽이 useTranslations('deal') · getTranslations('deal') 로 바꿔 씁니다 */
export const CS_HOURS = {
  open: 'hours.open',
  lunch: 'hours.lunch',
  avg: 'hours.avg',
  holiday: 'hours.holiday',
  sla: 'hours.sla',
} as const;
export const HAND_WHY = ['hours.hand.money', 'hours.hand.account', 'hours.hand.report', 'hours.hand.fee', 'hours.hand.other'] as const;

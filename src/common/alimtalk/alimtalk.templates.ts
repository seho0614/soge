/* ---------------------------------------------------------------------
 * v10.142 (D138 · docs/215 · 설계 docs/213) — 알림톡 템플릿 본문(기준)
 *
 *   대행사 · 카카오 심의에 **이 글 그대로** 등록합니다(#{이름} 자리만 바뀜). 글을 바꾸면 심의를 다시 받아야 합니다.
 *   운영 화면 › 외부 연동 › 「알림톡」이 이 글을 보여 주고, 대행사 템플릿 코드 · 심의 상태를 alimtalk_templates 에 넣습니다.
 * ------------------------------------------------------------------- */

export type AlimtalkTemplateCode = 'CONSULT_OTP' | 'HANDOFF_ADMIN' | 'ORDER_STATUS' | 'NOTICE_GENERAL';

export const ALIMTALK_TEMPLATES: Record<AlimtalkTemplateCode, { name: string; vars: string[]; body: string }> = {
  CONSULT_OTP: {
    name: '상담 신청 인증번호', vars: ['인증번호', '분'],
    body: '[소개뱅크] 안심소개 상담 신청 인증번호는 #{인증번호} 입니다.\n#{분}분 안에 신청 화면에 넣어 주십시오. 직접 신청하지 않으셨다면 무시하십시오.',
  },
  HANDOFF_ADMIN: {
    name: 'AI 상담 넘김 알림(운영자)', vars: ['건수'],
    body: '[소개뱅크 운영] AI 상담에서 사람에게 넘긴 문의가 #{건수}건 있습니다.\n운영 화면 › AI 에이전트 › AI 상담에서 확인해 주십시오.',
  },
  ORDER_STATUS: {
    name: '주문 · 반품 상태', vars: ['제목', '내용'],
    body: '[소개뱅크] #{제목}\n#{내용}\n자세한 내용은 소개뱅크 › 나의공간 › 알림에서 확인하실 수 있습니다.',
  },
  NOTICE_GENERAL: {
    name: '알림 일반', vars: ['제목', '내용'],
    body: '[소개뱅크] #{제목}\n#{내용}\n알림 보기 · 설정: 소개뱅크 › 나의공간 › 알림',
  },
};

/** #{이름} 자리 채우기 — 값의 줄바꿈 · 앞뒤 빈칸 정리 · 자리마다 최대 길이(대행사 글자 수 제한 안) */
export function renderAlimtalk(code: AlimtalkTemplateCode, vars: Record<string, string | number>, maxVar = 400) {
  return ALIMTALK_TEMPLATES[code].body.replace(/#\{([^}]+)\}/g, (_, k: string) =>
    String(vars[k] ?? '').replace(/\r/g, '').trim().slice(0, maxVar));
}

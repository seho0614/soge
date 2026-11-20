/* ---------------------------------------------------------------------
 * v10.530 (D280 · docs/668) 메일 문구 템플릿 — 코드 기본 문구 목록 · 자리값 검사 · 채우기(DB 없이 · 시험 · 메일 발송기에서 같이 씀)
 *
 *   ① 지금 코드가 회원 · 바깥 사람에게 보내는 메일 8가지의 제목 · 본문을 자리값({link} 같은 꼴) 글로 옮겨 둠(MAIL_DEFAULTS).
 *      발송하는 곳은 지금 글자를 그대로 「코드 기본값(fallback)」으로 들고 있고, 운영 화면에서 고친 판이 있고 스위치(csx.mail_templates)가 켜졌을 때만 바꿔 씀.
 *   ② 자리값 검사(checkMailTemplate) = DB 트리거 fn_csx_mail_tpl_guard 와 같은 규칙(계약 규칙 2):
 *      쓸 수 있는 자리값만 · 꼭 넣을 자리값(본문 · 제목) · 중괄호는 자리값에만 · 글에 주소(http · https) 직접 쓰기 금지(주소는 자리값으로만) ·
 *      제목 1 ~ 120자 · 줄바꿈 없음 · 본문 2 ~ 4,000자
 *   ③ 채우기(renderMailTemplate)는 한 번만 바꿈 — 넣은 값 안의 {…} 는 다시 바꾸지 않음 · 제목의 줄바꿈은 빈칸으로(머리줄 끼워 넣기 방지)
 *   빼 둔 것(문구가 이미 다른 곳에서 고쳐지거나 운영진 안 메일): 마케팅 캠페인(D268 · 운영자가 글을 씀) · 미수금 독촉(D256 · acct_dunning_templates) ·
 *      시험 메일 · 운영 알림 · 하루 요약 · 업무 보고(운영진 안)
 * ------------------------------------------------------------------- */

export interface MailDef {
  code: string; name: string; who: string; where: string;
  vars: string[]; required: string[]; subjectRequired: string[];
  subject: string; body: string; sample: Record<string, string>;
}

const FOOT = '본 메일은 발신 전용입니다.\n(주)한국바이오헬스케어 소개뱅크 사업부';

/** 코드 기본 문구 — 순서 = 화면 순서 · code 는 DB csx_mail_template_defs 와 같음 */
export const MAIL_DEFAULTS: MailDef[] = [
  {
    code: 'PW_RESET', name: '비밀번호 재설정', who: '회원', where: 'src/modules/identity/account-security.service.ts',
    vars: ['link', 'ttl'], required: ['link'], subjectRequired: [],
    subject: '[소개뱅크] 비밀번호 재설정 안내',
    body: `소개뱅크 비밀번호 재설정 링크입니다.\n\n{link}\n\n{ttl}분 동안 한 번만 쓸 수 있습니다. 새로 요청하시면 이 링크는 쓸 수 없게 됩니다.\n`
      + `직접 요청하지 않으셨다면 이 메일을 무시하십시오 — 비밀번호는 바뀌지 않습니다.\n\n${FOOT}`,
    sample: { link: 'https://sogaebank.com/login/reset?token=예시', ttl: '30' },
  },
  {
    code: 'CONSULT_OTP', name: '안심소개 상담 인증번호', who: '상담 신청자(비회원 포함)', where: 'src/modules/partner/consult.service.ts',
    vars: ['code', 'ttl'], required: ['code'], subjectRequired: [],
    subject: '[소개뱅크] 상담 신청 인증번호 {code}',
    body: `소개뱅크 안심소개 상담 신청 인증번호입니다.\n\n인증번호: {code}\n\n{ttl}분 안에 신청 화면에 넣어 주십시오. 확인을 마쳐야 업체에 전달됩니다.\n`
      + `직접 신청하지 않으셨다면 이 메일을 무시하십시오 — 확인하지 않은 신청은 업체에 가지 않습니다.\n\n${FOOT}`,
    sample: { code: '123456', ttl: '10' },
  },
  {
    code: 'WITHDRAW_GRACE', name: '탈퇴 취소 기한 안내', who: '탈퇴 유예 중 회원', where: 'src/modules/admin/member-notice-jobs.ts',
    vars: ['until', 'base'], required: ['until'], subjectRequired: [],
    subject: '[소개뱅크] 탈퇴 취소는 {until} 까지입니다',
    body: [
      '소개뱅크 회원 탈퇴를 취소할 수 있는 기간이 곧 끝납니다.',
      '',
      '· 취소할 수 있는 때: {until}(한국 시각)까지',
      '· 그 뒤에는 탈퇴가 확정되고, 법령에 따라 보관하는 정보 밖의 회원 정보는 파기됩니다.',
      '',
      '마음이 바뀌셨다면 그 전에 로그인 화면({base}/login)에서 이메일 · 비밀번호를 넣고 「탈퇴 취소」를 누르십시오.',
      '직접 탈퇴하지 않으셨다면 고객센터로 알려 주십시오.',
      '',
      '이 메일은 탈퇴 유예 안내로 한 번만 보냅니다.',
    ].join('\n'),
    sample: { until: '2026-12-01 18:00', base: 'https://sogaebank.com' },
  },
  {
    code: 'PTN_INVITE_NEW', name: '파트너센터 직원 초대(가입 전)', who: '초대받은 사람', where: 'src/modules/papi/bulk.ts',
    vars: ['company'], required: [], subjectRequired: [],
    subject: '[소개뱅크] {company} 파트너센터 직원 초대',
    body: '{company} 에서 소개뱅크 파트너센터 직원으로 초대했습니다.\n\n이 이메일로 소개뱅크에 가입하시면 초대가 「파트너센터 › 회사 · 계정」에 들어옵니다. 받아들이시면 합류합니다.\n가입하지 않으시면 기한이 지나 이 이메일은 지워집니다.\n\n(주)한국바이오헬스케어 소개뱅크 사업부',
    sample: { company: '예시 회사' },
  },
  {
    code: 'PTN_INVITE_MEMBER', name: '파트너센터 직원 초대(회원)', who: '초대받은 회원', where: 'src/modules/papi/bulk.ts',
    vars: ['company'], required: [], subjectRequired: [],
    subject: '[소개뱅크] {company} 파트너센터 직원 초대',
    body: '{company} 에서 소개뱅크 파트너센터 직원으로 초대했습니다.\n\n로그인한 뒤 「파트너센터 › 회사 · 계정」에서 받아들이시면 합류합니다.\n\n(주)한국바이오헬스케어 소개뱅크 사업부',
    sample: { company: '예시 회사' },
  },
  {
    code: 'PAYSLIP_NOTICE', name: '급여명세서 알림', who: '직원', where: 'src/modules/acct/payslip.ts',
    vars: ['name', 'ym'], required: ['ym'], subjectRequired: [],
    subject: '[소개뱅크] {ym} 급여명세서가 나왔습니다',
    body: '{name} 님,\n\n{ym} 급여명세서가 나왔습니다. 운영 화면 › 사무 › 내 인사에서 보십시오.\n(보안을 위해 메일에는 금액을 넣지 않습니다.)\n',
    sample: { name: '홍길동', ym: '2026-11' },
  },
  {
    code: 'AD_REPORT', name: '광고 성과 보고서', who: '광고주 담당자', where: 'src/modules/prx/adreport.ts',
    vars: ['label', 'advertiser', 'report'], required: ['report'], subjectRequired: [],
    subject: '[소개뱅크] {label} 광고 성과 보고서 — {advertiser}',
    body: '{report}',
    sample: { label: '2026-11', advertiser: '예시 광고주', report: '(보고서 숫자 — 노출 · 클릭 · 소재별 · 서버가 셈)' },
  },
  {
    code: 'NOTIFY_MAIL', name: '알림 메일(모든 알림의 틀)', who: '회원', where: 'src/common/mail/notify-mail.ts',
    vars: ['title', 'body', 'golink', 'base'], required: ['body'], subjectRequired: ['title'],
    subject: '{title}',
    body: '{body}\n{golink}\n—\n소개뱅크 알림입니다. 알림 보기 · 설정: {base}/my/notifications',
    sample: { title: '예시 알림 제목', body: '예시 알림 글입니다.', golink: '\n바로 가기: https://sogaebank.com/my\n', base: 'https://sogaebank.com' },
  },
];

export const MAIL_CODES = MAIL_DEFAULTS.map((d) => d.code);
export const mailDef = (code: string) => MAIL_DEFAULTS.find((d) => d.code === code) ?? null;

export const MAIL_SUBJECT_MAX = 120;
export const MAIL_BODY_MAX = 4000;
const TOKEN_G = /\{([a-z_]+)\}/g;

/** 자리값 검사 — 문제 글 목록(없으면 []) · DB 트리거 fn_csx_mail_tpl_guard 와 같은 규칙 */
export function checkMailTemplate(code: string, subject: string, body: string): string[] {
  const d = mailDef(code);
  if (!d) return ['없는 메일 종류입니다.'];
  const out: string[] = [];
  const s = String(subject ?? ''), b = String(body ?? '');
  if (s.trim().length < 1 || s.length > MAIL_SUBJECT_MAX) out.push(`제목은 1 ~ ${MAIL_SUBJECT_MAX}자입니다.`);
  if (/[\r\n]/.test(s)) out.push('제목에는 줄바꿈을 넣지 않습니다.');
  if (b.trim().length < 2 || b.length > MAIL_BODY_MAX) out.push(`본문은 2 ~ ${MAIL_BODY_MAX.toLocaleString('ko-KR')}자입니다.`);
  const all = `${s}\n${b}`;
  if (/https?:\/\//i.test(all)) out.push('주소(http · https)는 글에 직접 쓰지 말고 자리값으로만 넣습니다.');
  if (/[{}]/.test(all.replace(TOKEN_G, ''))) out.push('중괄호는 자리값에만 씁니다.');
  const bad = [...new Set([...all.matchAll(TOKEN_G)].map((m) => m[1]!).filter((v) => !d.vars.includes(v)))];
  for (const v of bad) out.push(`쓸 수 없는 자리값이 있습니다 — ${v}`);
  for (const v of d.required) if (!b.includes(`{${v}}`)) out.push(`본문에 꼭 넣어야 하는 자리값이 빠졌습니다 — ${v}`);
  for (const v of d.subjectRequired) if (!s.includes(`{${v}}`)) out.push(`제목에 꼭 넣어야 하는 자리값이 빠졌습니다 — ${v}`);
  return out;
}

/** 채우기 — 한 번만 바꿈(넣은 값 안의 {…} 는 그대로) · 제목 줄바꿈 → 빈칸 · 120자 */
export function renderMailTemplate(subject: string, body: string, vars: Record<string, unknown>) {
  const fill = (t: string) => t.replace(TOKEN_G, (_m, k: string) => (vars[k] === undefined || vars[k] === null ? '' : String(vars[k])));
  return { subject: fill(subject).replace(/[\r\n]+/g, ' ').trim().slice(0, MAIL_SUBJECT_MAX), text: fill(body) };
}

/* ---------------------------------------------------------------------
 * v10.200 (docs/316) — 오픈 차단 줄마다 「누가 · 어떻게 풀리나」
 *
 *   남은 오픈 차단은 대부분 개발 밖(대표 결정 · 업체 계약)이라, 줄마다 누가 할 일인지와 풀리는 방법 한 줄을 붙입니다.
 *   판단 기준(v_open_blockers)과 줄 수는 그대로 — 이 함수는 글만 붙입니다(DB 를 읽지 않음).
 *
 *   CEO     대표 결정 · 법무 확인(약관 게시 · 바닥줄 법정 고지)
 *   VENDOR  업체 신청 · 계약 · 키 받기 대기(외부 연동 · 간주 모드 끄기 · 본인인증 · 메일)
 *   SCREEN  운영 화면에서 바로(설정 값 넣기 · 스위치 순서)
 *   DATE    날짜만 정하면 됨(오픈일 · 약관 시행일)
 * ------------------------------------------------------------------- */
export type BlockerOwner = 'CEO' | 'VENDOR' | 'SCREEN' | 'DATE';
export const BLOCKER_OWNERS: BlockerOwner[] = ['CEO', 'VENDOR', 'SCREEN', 'DATE'];

export function blockerOwner(kind: string, item: string): { owner: BlockerOwner; how: string } {
  switch (kind) {
    case 'TERM':
      return { owner: 'CEO', how: '법무 확인 뒤 운영 화면 › 관 관리 › 법정 고지 › 약관에서 시행일을 넣고 게시(SUPER)' };
    case 'FOOTER':
      return { owner: 'CEO', how: '연결할 약관 · 고지 페이지가 게시되면 저절로 풀림(바닥줄 법정 고지 링크)' };
    case 'INTEGRATION':
      return { owner: 'VENDOR', how: '업체 신청 · 계약 → 키를 외부 연동 › 연동 키에 넣음 → 시험 뒤 상태를 LIVE 로' };
    case 'ASSUME':
      return { owner: 'VENDOR', how: '그 연동을 마친 뒤 운영 화면 설정에서 끔(끄기 전 잠금이 키 확인 · 시험을 요구)' };
    case 'READY':
      if (/오픈일|시행일|고지 기간/.test(item)) return { owner: 'DATE', how: '날짜를 정해 운영 화면 › 오픈 체크리스트에 넣음' };
      if (/소개비/.test(item)) return { owner: 'SCREEN', how: '운영 화면 설정에서 소개비 스위치를 순서대로' };
      if (/MOCK|가짜/.test(item)) return { owner: 'SCREEN', how: '외부 연동 › 방식 설정에서 시험용 가짜(MOCK) 방식을 바꿈' };
      return { owner: 'VENDOR', how: '업체 계약 · 키를 받은 뒤 외부 연동 화면에서 켬(본인인증 NICE · 메일 SES 인증)' };
    case 'SETTING':
      if (/date|_at$/.test(item)) return { owner: 'DATE', how: '날짜를 정해 운영 화면 › 사이트 설정에 넣음' };
      return { owner: 'SCREEN', how: '운영 화면 › 사이트 설정에서 값을 넣음' };
    default:
      return { owner: 'CEO', how: '' };
  }
}

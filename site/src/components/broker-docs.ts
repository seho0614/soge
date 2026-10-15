/**
 * 중개사 인증 「제출 서류」 종류(D055) — 서버 컴포넌트(내 인증 상태)와 클라이언트 컴포넌트(BrokerExtra)가 같이 씁니다.
 * v10.31 검정 고침 — 전에는 'use client' 파일(BrokerExtra.tsx)에 두고 서버 화면에서 가져와,
 *   서버에서는 배열 대신 클라이언트 참조가 넘어와 /my/broker/status 가 500(「BROKER_DOCS.find is not a function」)이었습니다(제출 서류가 있는 회원).
 */
export const BROKER_DOCS: [string, string][] = [
  ['REG_CERT', '중개사무소 등록증'], ['GUARANTEE', '보증(공제) 증서'], ['LICENSE', '공인중개사 자격증'], ['ETC', '기타'],
];

/**
 * v10.29 — 나의공간 공통 틀(시안 myShell · 왼쪽 「나의공간」 메뉴 + 오른쪽 내용)을 /my/** 전체에 씌웁니다.
 * /my/health/**(소개몰) · /my/broker/**(중개사 인증)는 MyShell 이 주소를 보고 틀 없이 그대로 둡니다.
 * v10.99 — 나의공간 사전 묶음(my · myDeal · 소개몰 주문 order)을 /my/** 브라우저 부품에 내려보냅니다(docs/157).
 */
import { MyFrame } from '@/components/my/MyFrame';
import { Msgs } from '@/i18n/Msgs';

export default function MyLayout({ children }: { children: React.ReactNode }) {
  return <Msgs ns={['my', 'myDeal', 'order']}><MyFrame>{children}</MyFrame></Msgs>;
}

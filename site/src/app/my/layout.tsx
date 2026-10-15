/**
 * v10.29 — 나의공간 공통 틀(시안 myShell · 왼쪽 「나의공간」 메뉴 + 오른쪽 내용)을 /my/** 전체에 씌웁니다.
 * /my/health/**(소개몰) · /my/broker/**(중개사 인증)는 MyShell 이 주소를 보고 틀 없이 그대로 둡니다.
 */
import { MyFrame } from '@/components/my/MyFrame';

export default function MyLayout({ children }: { children: React.ReactNode }) {
  return <MyFrame>{children}</MyFrame>;
}

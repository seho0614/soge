import type { Metadata } from 'next';
import Link from 'next/link';
import { forgotPassword } from '@/lib/session';
import { ForgotForm } from '@/components/auth/PasswordForms';
import '@/styles/proto-w1.css';

export const metadata: Metadata = { title: '비밀번호 찾기' };

/**
 * SB-HOM-AUT-040 비밀번호 찾기 (v10.48 · D102)
 *   POST /auth/password/forgot — 가입한 이메일로 30분짜리 1회용 재설정 링크.
 *   ★ 계정이 있든 없든 같은 안내가 나옵니다 — 이 화면으로 가입 여부를 알아낼 수 없게.
 *   같은 이메일 · 같은 IP 1시간 5회까지. 메일 발송 준비 전(운영)에는 고객센터 「계정」 문의로 안내합니다.
 */
export default function ForgotPage() {
  async function doForgot(email: string) {
    'use server';
    return forgotPassword(email);
  }
  return (
    <div className="w1 w1-lgw" data-screen="SB-HOM-AUT-040">
      <div className="w1-lgc">
        <div className="w1-lgh"><h1>비밀번호 찾기</h1>
          <p>가입하신 이메일을 넣으시면 <b>비밀번호 재설정 링크</b>를 보내 드립니다. 링크는 <b>30분 동안 한 번만</b> 쓸 수 있습니다.</p></div>
        <ForgotForm action={doForgot} />
        <div className="w1-jc w" style={{ marginTop: 16 }}><span className="lb">메일이 오지 않으면</span>
          스팸함을 먼저 확인해 주십시오. 가입한 이메일이 기억나지 않으시면 고객센터 「계정」 문의로 알려 주십시오 — 본인 확인 뒤 도와 드립니다.
          <div style={{ marginTop: 8 }}><Link className="w1-bo sm" href="/support/new#inquiry">고객센터 문의</Link></div></div>
        <div className="w1-lgd"><span>비밀번호가 생각나셨나요?</span></div>
        <Link className="w1-bo w1-lgb" href="/login">로그인</Link>
      </div>
    </div>
  );
}

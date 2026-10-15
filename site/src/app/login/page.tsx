import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGet } from '@/lib/api';
import { login, me } from '@/lib/session';
import { GWAN_PATH } from '@/lib/format';
import { LoginForm } from '@/components/auth/LoginForm';
import '@/styles/proto-w1.css';

export const metadata: Metadata = { title: '로그인' };

type Props = { searchParams: Promise<{ next?: string | string[] }> };

/**
 * 로그인 뒤 돌아갈 주소(?next=) — **우리 사이트 안의 경로만** 받습니다.
 * 바깥 주소(https://… · //남의도메인 · 역슬래시 꼼수)를 따르면, 우리 로그인 화면을 거쳐 남의 사이트로 보내는 링크가 만들어집니다.
 */
function safeNext(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  if (typeof s !== 'string' || s.length === 0 || s.length > 500) return null;
  if (!s.startsWith('/') || s.startsWith('//') || s.includes('\\') || s.includes('://')) return null;
  if (/[\u0000-\u001f]/.test(s)) return null;
  return s;
}

/**
 * SB-HOM-AUT-030 로그인 — v10.31 시안 scLogin 그대로: 카드 · 안내(개인 회원도 가입) · 약관이 바뀐 뒤 로그인하면(재동의 화면 보기) ·
 *   이메일 · 비밀번호(보기) · 로그인 상태 유지 · 이메일 찾기 · 비밀번호 재설정 · 로그인 · 승인 대기 계정 안내 · 회원가입 · 관심 성향 등록 · 가입 안내.
 */
export default async function LoginPage({ searchParams }: Props) {
  const sp = await searchParams;

  /* 로그인 후 도착할 화면은 운영이 정합니다(site.landing_after_login). 비어 있으면 메인입니다.
     ★ v10.21 (G-135) — 설정 값은 **관 코드**(MNY)이고 화면 주소는 /money 입니다. GWAN_PATH 로 주소를 찾습니다. */
  /* v10.36 — 캐시하지 않습니다(전: 60초). 운영 화면에서 바꾼 첫 화면이 1분 넘게 옛 값으로 나와 「저장이 안 된다」로 보였습니다 */
  const landing = await apiGet<{ value: string }>('/site/landing', 0)
    .then(r => r.value).catch(() => '');
  const landingUrl = GWAN_PATH[landing] ? `/${GWAN_PATH[landing]}` : '/';
  /* 로그인이 필요해 이 화면으로 보내진 경우(?next=)는 보던 화면으로 돌려보냅니다 */
  const nextUrl = safeNext(sp.next) ?? landingUrl;

  if (await me()) redirect(nextUrl);

  async function doLogin(email: string, password: string, keep: boolean) {
    'use server';
    return login(email, password, keep);
  }

  return (
    <div className="w1 w1-lgw" data-screen="SB-HOM-AUT-030">
      <div className="w1-lgc">
        <div className="w1-lgh"><h1>로그인</h1>
          <p><b>개인 회원도 가입</b>해 요청 등록과 소개 참여를 하실 수 있습니다. <b>본인인증을 하시면 소개비도 받으십니다.</b> 개인 회원도 모든 업무를 하실 수 있고, 등록에 인증이 필요한 업종(공인중개사 · 보험 · 의료 등)만 그 인증을 받은 뒤 등록합니다.</p></div>
        <div className="w1-jc w"><span className="lb">약관이 바뀐 뒤 로그인하면</span>
          로그인 직후 <b>약관 동의 화면</b>으로 갑니다 — 바뀐 점을 보시고 필수 약관에 동의하시면 가려던 화면으로 이어집니다.
          <div style={{ marginTop: 8 }}><Link className="w1-bo sm" href="/terms/agree">재동의 화면 보기</Link></div></div>
        <LoginForm action={doLogin} next={nextUrl} />
        <div className="w1-jc w" style={{ marginTop: 16 }}><span className="lb">승인 대기 계정으로 로그인하면</span>
          로그인은 됩니다. 본인인증을 하셨으면 <b>판매 등록 · 거래 만들기 · 정산</b>도 지금 바로 됩니다 — 사업자 인증 승인은 <b>사업자로 소개비(세금계산서)를 받을 때</b>만 기다립니다. 남은 단계는 눌렀을 때 보여 드립니다. <b>열람과 검색은 제한 없이</b> 됩니다.
          <div style={{ marginTop: 8 }}><Link className="w1-bo sm" href="/verify">인증 단계 보기</Link></div></div>
        <div className="w1-lgd"><span>아직 계정이 없으신가요?</span></div>
        <Link className="w1-bo w1-lgb" href="/signup">회원가입</Link>
        <div className="w1-prfcta">
          <div className="pch"><b>관심 성향 등록</b><span>가입 · 로그인 뒤 여섯 문항</span></div>
          <p>등록해 두면 <b>메인 광고와 소개 추천</b>이 관심 업종으로 맞춰집니다. 광고주에게 넘기지 않고, 언제든 지울 수 있습니다.</p>
          <Link className="w1-bp w1-lgb" href="/ai/profile">성향 분석하고 등록하기</Link>
        </div>
        <div className="w1-nt3" style={{ textAlign: 'center', marginTop: 12 }}>개인 회원 · 개인사업자 · 법인 모두 가입할 수 있습니다. 휴업 · 폐업 사업자는 사업자 인증을 받을 수 없습니다.</div>
      </div>
    </div>
  );
}

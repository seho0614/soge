import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { gradeLabels } from '@/lib/grades';
import { BackBar } from '@/components/common/BackBar';
import { RoleTabs } from '@/components/gwan/GwParts';
import type { Cat, Gwan } from '@/components/form/RegParts';
import { RegisterForm } from '@/components/register/RegisterForm';
import '@/styles/proto-w1.css';

export const metadata: Metadata = { title: '상품/서비스 등록' };

const REG_GWANS = ['MNY', 'MAL', 'BIZ'];

/**
 * SB-HOM-REG-010 상품/서비스 등록하기 — v10.31 시안 scReg(← 이전 화면 · 3단추(소개하기 켜짐) · 안내 · 5구역 폼).
 *   v10.37 (D095 · P2P) — 개인 회원도 모든 관에 등록합니다(전: 사업자만 · v10.36 은 소개장터만). 인증이 필요한 업종만 그 인증을 봅니다.
 *   v10.27 (G-201) — 업종이 하나도 없는 관은 고르기에서 뺍니다.
 */
export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ g?: string }> }) {
  const p = await me();
  if (!p) redirect('/login?next=/register');
  if (!p.identityVerifiedAt) redirect('/verify?next=/register');
  const sp = await searchParams;

  const [gw, labels, ...lists] = await Promise.all([
    apiGet<Array<Gwan & { isActive: boolean }>>('/gwans', 300).catch(() => []),
    gradeLabels(),
    ...REG_GWANS.map((g) => apiGet<Cat[]>(`/categories?gwanCode=${g}`, 300).catch(() => [] as Cat[])),
  ]);
  /* 제한업종(다단계 · 대부 등)은 고르기에서 뺍니다 — 골라 봐야 등록 때 막힙니다 */
  const cats = (lists as Array<Array<Cat & { restrictedCode?: string | null }>>).flat().filter((c) => !c.restrictedCode);
  /* v10.37 (D095 · P2P) — 개인 회원도 모든 관에 등록합니다(사업자 여부를 보지 않음). 인증이 필요한 업종(보험 · 의료 자격 · 공인중개사 · 제한업종)은
     제한업종은 폼이 미리 알려 주고(POST /restrictions/check) 자격 · 중개사 인증은 서버 · DB 게이트가 봅니다 */
  const gwans = gw.filter((g) => g.isActive && REG_GWANS.includes(g.code) && cats.some((c) => c.gwanCode === g.code))
    .map((g) => ({ code: g.code, name: g.name }));
  return (
    <div className="w1 w1-wrap" data-screen="SB-HOM-REG-010">
      <BackBar href="/" label="이전 화면" wrap={false} />
      <div style={{ marginTop: 12 }}>
        <RoleTabs on="give" note="다양한 상품과 서비스를 소개하고 수익을 만들어보세요!" />
      </div>
      {gwans.length > 0 ? (
        <RegisterForm gwans={gwans} cats={cats} gradeLabels={labels} initialGwan={REG_GWANS.includes(sp.g ?? '') ? sp.g : undefined} />
      ) : (
        <div className="w1-rgw w1-rgw-reg">
          <div className="w1-rghd"><div><h1>상품/서비스 등록하기</h1></div></div>
          <div className="w1-jc w" data-reg-locked=""><span className="lb">지금 등록할 수 있는 관이 없습니다</span>
            열린 관의 업종이 준비되면 등록하실 수 있습니다. 그동안 <b>요청 등록과 소개 참여</b>를 하실 수 있습니다.
            <div className="w1-dact" style={{ justifyContent: 'flex-start' }}>
              <Link className="w1-jb o" href="/request/new">소개받고 싶어요(요청 등록)</Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

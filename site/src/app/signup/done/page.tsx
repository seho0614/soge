import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet, apiGetPersonal } from '@/lib/api';
import { GWAN_PATH } from '@/lib/format';
import '@/styles/proto-w1.css';

export const metadata: Metadata = { title: '가입 신청 접수' };

interface Account {
  account: { name: string; email: string; identityVerifiedAt: string | null } | null;
  business: { companyName: string; bizRegNo: string; verifiedAt: string | null; ntsStatus: string | null; ntsEnv: string | null; rejectReason: string | null } | null;
}
interface Mine { registered: boolean; segment?: string; name?: string }

const fmtBrn = (d: string) => (d?.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : d);

/**
 * SB-HOM-AUT-020 가입 완료 — v10.31 시안 scJoinDone(joind): ✓ · 접수 → 사업자 확인 → 운영자 승인 → 가입 완료 ·
 *   관심 성향(joinDone) · 승인 전에 할 수 있는 것 · 메인으로 · 리스팅 둘러보기.
 * 값은 내 계정(GET /me/account) · 내 성향(GET /me/profile)에서 — 시안의 「(주)세바코리아」 같은 예시 값을 쓰지 않습니다.
 * 개인 회원은 승인 단계가 없어 「해당 없음」으로 보이고, 다음 할 일(본인인증)을 잇습니다.
 */
export default async function SignupDone({ searchParams }: { searchParams: Promise<{ biz?: string; msg?: string }> }) {
  if (!(await me())) redirect('/login?next=/signup/done');
  const sp = await searchParams;
  const [acc, mine, landing] = await Promise.all([
    apiGetPersonal<Account>('/me/account').catch(() => null),
    apiGetPersonal<Mine>('/me/profile').catch(() => null),
    /* v10.37 (10/13 대표 답 「사용」) — 운영 화면 「신규 가입자 첫 화면」(site.landing_new_member). 관이 아니거나 비면 메인 · 캐시 안 함 */
    apiGet<{ value: string }>('/site/landing?for=new', 0).then((x) => x.value).catch(() => ''),
  ]);
  const startHref = GWAN_PATH[landing] ? `/${GWAN_PATH[landing]}` : '/';
  const biz = acc?.business ?? null;
  const failed = sp.biz === 'fail' && !biz;
  const ntsLabel = !biz ? '' : biz.ntsStatus === 'VALID' ? `자동 통과${biz.ntsEnv === 'STUB' ? ' (모의 조회)' : ''}` : biz.ntsStatus ? '확인 필요' : '조회 대기';

  const steps: Array<[string, string, string]> = biz
    ? [['접수', '완료', 'dn'], ['사업자 확인', ntsLabel, biz.ntsStatus === 'VALID' ? 'dn' : 'on'],
       ['운영자 승인', biz.verifiedAt ? '승인' : biz.rejectReason ? '반려' : '심사 중', biz.verifiedAt ? 'dn' : 'on'],
       ['가입 완료', biz.verifiedAt ? '완료' : '대기', biz.verifiedAt ? 'dn' : '']]
    : [['접수', '완료', 'dn'], ['사업자 확인', '해당 없음', ''], ['운영자 승인', '해당 없음', ''], ['가입 완료', '완료', 'dn']];

  return (
    <div className="w1 w1-jw" data-screen="SB-HOM-AUT-020" data-state="done">
      <div className="w1-done">
        <div className="dic" aria-hidden="true">✓</div>
        <h1>{biz ? '가입 신청이 접수되었습니다' : '가입이 완료되었습니다'}</h1>
        {biz ? (
          <p>{biz.companyName} · 사업자등록번호 {fmtBrn(biz.bizRegNo)}<br />
            <b>운영자 승인 후</b> 사업자 인증이 완료됩니다. 영업일 기준 1일 이내에 처리됩니다.</p>
        ) : (
          <p>{acc?.account?.name ?? ''} 님 · {acc?.account?.email ?? ''}<br />
            개인 회원으로 가입되었습니다. <b>본인인증</b>을 하시면 소개비도 받으십니다.</p>
        )}
        <div className="w1-dst">
          {steps.map(([t, s, c]) => <div key={t} className={`d1 ${c}`}><b>{t}</b><span>{s}</span></div>)}
        </div>

        {failed && (
          <div className="w1-jc e" style={{ textAlign: 'left', marginTop: 18 }}><span className="lb">사업자 신청이 접수되지 않았습니다</span>
            계정은 만들어졌습니다. {sp.msg ? <>{sp.msg} </> : null}<Link href="/my/business">나의공간 → 사업자 전환</Link>에서 다시 신청해 주십시오.</div>
        )}

        {mine?.registered ? (
          <div className="w1-jc s" style={{ textAlign: 'left', marginTop: 18 }}><span className="lb">관심 성향</span>
            <b>{mine.name ?? mine.segment}</b> ({mine.segment})로 저장했습니다. 메인 광고와 소개 추천이 이 성향으로 정렬됩니다.{' '}
            <b>나의공간 → 관심 성향</b>(<Link href="/ai/profile">다시 하기</Link>)에서 언제든 다시 하거나 지울 수 있습니다.</div>
        ) : (
          <div className="w1-jc i" style={{ textAlign: 'left', marginTop: 18 }}><span className="lb">관심 성향</span>
            성향을 넣지 않으셨습니다 — 전체 공개 광고만 나갑니다. 나중에 <b>나의공간 → 관심 성향</b>(<Link href="/ai/profile">지금 넣기</Link>)에서 넣을 수 있습니다.</div>
        )}

        <div className="w1-jc i" style={{ textAlign: 'left', marginTop: 12 }}><span className="lb">{biz ? '승인 전에 할 수 있는 것' : '지금 할 수 있는 것'}</span>
          리스팅 <b>열람과 검색</b>, 요청 등록과 소개 참여는 지금도 됩니다.{' '}
          {biz ? <>본인인증을 하시면 <b>모든 업무</b>를 지금 하실 수 있고, <b>사업자로 받는 소개비(세금계산서)</b>만 승인 후에 열립니다.</>
            : <><b>본인인증</b>을 하시면 모든 업무(등록 · 문의 · 거래 · 소개비 받기)를 하실 수 있습니다. 등록에 인증이 필요한 업종만 그 인증을 받습니다.</>}
        </div>

        <div className="w1-dact">
          {!acc?.account?.identityVerifiedAt && <Link className="w1-jb p" href="/verify">본인인증 하기</Link>}
          <Link className="w1-jb o" href={startHref} data-signup-start={landing || 'MAIN'}>{startHref === '/' ? '메인으로' : '시작하기'}</Link>
          <Link className="w1-jb a" href="/listings">리스팅 둘러보기</Link>
        </div>
      </div>
    </div>
  );
}

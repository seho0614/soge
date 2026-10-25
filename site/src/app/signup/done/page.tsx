import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet, apiGetPersonal } from '@/lib/api';
import { GWAN_PATH } from '@/lib/format';
import '@/styles/proto-w1.css';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('join.done'))('metaTitle') };
}

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
  const t = await getTranslations('join.done');
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
  const ntsLabel = !biz ? '' : biz.ntsStatus === 'VALID' ? `${t('ntsPass')}${biz.ntsEnv === 'STUB' ? t('ntsStub') : ''}` : biz.ntsStatus ? t('ntsCheck') : t('ntsWait');

  const steps: Array<[string, string, string]> = biz
    ? [[t('stReceived'), t('stDone'), 'dn'], [t('stBiz'), ntsLabel, biz.ntsStatus === 'VALID' ? 'dn' : 'on'],
       [t('stApproval'), biz.verifiedAt ? t('stApproved') : biz.rejectReason ? t('stRejected') : t('stReviewing'), biz.verifiedAt ? 'dn' : 'on'],
       [t('stJoined'), biz.verifiedAt ? t('stDone') : t('stWaiting'), biz.verifiedAt ? 'dn' : '']]
    : [[t('stReceived'), t('stDone'), 'dn'], [t('stBiz'), t('stNa'), ''], [t('stApproval'), t('stNa'), ''], [t('stJoined'), t('stDone'), 'dn']];

  return (
    <div className="w1 w1-jw" data-screen="SB-HOM-AUT-020" data-state="done">
      <div className="w1-done">
        <div className="dic" aria-hidden="true">✓</div>
        <h1>{biz ? t('titleBiz') : t('titlePersonal')}</h1>
        {biz ? (
          <p>{t('bizLine1', { company: biz.companyName, brn: fmtBrn(biz.bizRegNo) })}<br />
            {t.rich('bizLine2', { b: (c) => <b>{c}</b> })}</p>
        ) : (
          <p>{t('personalLine1', { name: acc?.account?.name ?? '', email: acc?.account?.email ?? '' })}<br />
            {t.rich('personalLine2', { b: (c) => <b>{c}</b> })}</p>
        )}
        <div className="w1-dst">
          {steps.map(([t, s, c]) => <div key={t} className={`d1 ${c}`}><b>{t}</b><span>{s}</span></div>)}
        </div>

        {failed && (
          <div className="w1-jc e" style={{ textAlign: 'left', marginTop: 18 }}><span className="lb">{t('failLb')}</span>
            {t('failAccount')}{' '}{sp.msg ? <>{sp.msg} </> : null}{t.rich('failRetry', { a: (c) => <Link href="/my/business">{c}</Link> })}</div>
        )}

        {mine?.registered ? (
          <div className="w1-jc s" style={{ textAlign: 'left', marginTop: 18 }}><span className="lb">{t('prefLb')}</span>
            {t.rich('prefSaved', { name: mine.name ?? mine.segment ?? '', segment: mine.segment ?? '', b: (c) => <b>{c}</b>, a: (c) => <Link href="/ai/profile">{c}</Link> })}</div>
        ) : (
          <div className="w1-jc i" style={{ textAlign: 'left', marginTop: 18 }}><span className="lb">{t('prefLb')}</span>
            {t.rich('prefNone', { b: (c) => <b>{c}</b>, a: (c) => <Link href="/ai/profile">{c}</Link> })}</div>
        )}

        <div className="w1-jc i" style={{ textAlign: 'left', marginTop: 12 }}><span className="lb">{biz ? t('canBeforeLb') : t('canNowLb')}</span>
          {t.rich('canNow', { b: (c) => <b>{c}</b> })}{' '}
          {biz ? t.rich('canBiz', { b: (c) => <b>{c}</b> })
            : t.rich('canPersonal', { b: (c) => <b>{c}</b> })}
        </div>

        <div className="w1-dact">
          {!acc?.account?.identityVerifiedAt && <Link className="w1-jb p" href="/verify">{t('verifyBtn')}</Link>}
          <Link className="w1-jb o" href={startHref} data-signup-start={landing || 'MAIN'}>{startHref === '/' ? t('toMain') : t('start')}</Link>
          <Link className="w1-jb a" href="/listings">{t('browse')}</Link>
        </div>
      </div>
    </div>
  );
}

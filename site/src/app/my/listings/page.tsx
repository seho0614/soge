import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGet, ApiFailure } from '@/lib/api';
import { me } from '@/lib/session';
import { won, GWAN_PATH, dtKst, ymdKst } from '@/lib/format';
import { ArchiveButton } from '@/components/ArchiveButton';
import { MyHead, Tabs, Note, Empty, GwanTag, shortId, type Tone } from '@/components/my/ui';
import { getTranslations } from 'next-intl/server';
import { Msgs } from '@/i18n/Msgs';   // v10.101 — 아래 부품이 쓰는 사전 묶음(deal · docs/159)

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('my.lst'))('title') };
}

interface MyListing {
  id: string; title: string; status: string; statusLabel: string | null; gwanCode?: string;
  desiredFee: number | null; version: number;
  publishedAt: string | null; updatedAt: string;
  reviewStatus: string | null; rejectReasonCode: string | null;
  rejectReasonLabel: string | null; slaDueAt: string | null;
  /* v10.31 (시안 mylst) — 행마다 조회 · 관심 · 문의(1:1 대화) 수 · 업종 · 등급 · 반려 「고치는 법」 */
  viewCount?: number; likeCount?: number; inquiryCount?: number;
  categoryName?: string | null; gradeLabel?: string | null; rejectFixGuide?: string | null; createdAt?: string;
}

/* v10.29 — 시안 탭(전체 · 노출중 · 검수대기 · 반려 · 작성중 · 마감) ↔ 서버 상태 */
/* v10.99 — 탭 이름은 사전 키(my.lst.tab.*) */
const TABS: { k: string; t: 'published' | 'inReview' | 'rejected' | 'draft' | 'archived'; st: string[] }[] = [
  { k: 'PUBLISHED', t: 'published', st: ['PUBLISHED'] },
  { k: 'IN_REVIEW', t: 'inReview', st: ['IN_REVIEW'] },
  { k: 'REJECTED', t: 'rejected', st: ['REJECTED'] },
  { k: 'DRAFT', t: 'draft', st: ['DRAFT'] },
  { k: 'ARCHIVED', t: 'archived', st: ['ARCHIVED'] },
];
const TONE: Record<string, Tone> = { PUBLISHED: 'ok', IN_REVIEW: 'wait', DRAFT: 'wait', REJECTED: 'no', ARCHIVED: 'off' };

/**
 * SB-MYP-LST-010 — 반려 사유를 함께 보여 재제출 동선을 만듭니다.
 * v10.29 — 시안(scMyLst) 배치: 상태 탭(건수) → 행(상태 배지 · 관 · 제목 · 번호 · 날짜 | 수정 · 삭제) → 반려 상자.
 *   v10.31 — 시안의 조회 · 관심 · 문의 숫자 · 업종 · 등급 칩 · 반려 「고치는 법」을 서버 값으로 그립니다(GET /me/listings).
 *   개인(본인인증) 회원도 매물을 등록하므로 목록은 로그인한 누구에게나 열립니다(전에는 사업자만 · 403).
 *   개발에만 있던 「새 등록」 · 「보기」 · 「받은 문의」는 그대로 둡니다. 「삭제」는 지우지 않고 내리는 「내리기」(G-193 ④) 그대로.
 */
export default async function MyListings({ searchParams }: { searchParams: Promise<{ st?: string }> }) {
  if (!(await me())) redirect('/login');
  /* v10.29 — 사업자 회원(BIZ_OWNER · BIZ_STAFF)이 아니면 서버가 403 을 줍니다. 전에는 「등록한 매물이 없습니다」로 보였습니다 — 까닭을 알려 줍니다 */
  let forbidden = false;
  const all = await apiGet<MyListing[]>('/me/listings', 5).catch((e) => { if (e instanceof ApiFailure && e.status === 403) forbidden = true; return [] as MyListing[]; });
  const want = (await searchParams).st;
  const tab = TABS.find((t) => t.k === want) ? want! : 'all';
  const rows = tab === 'all' ? all : all.filter((r) => TABS.find((t) => t.k === tab)!.st.includes(r.status));
  const t = await getTranslations('my.lst');

  return (
    <>
      <MyHead title={t('title')} sub={t('sub')}
        right={<Link className="my-bp" href="/register">{t('new')}</Link>} />

      <Tabs label={t('tabsAria')} cur={tab} items={[
        { k: 'all', t: t('tab.all'), n: all.length, href: '/my/listings' },
        ...TABS.map((x) => ({ k: x.k, t: t(`tab.${x.t}`), n: all.filter((r) => x.st.includes(r.status)).length, href: `/my/listings?st=${x.k}` })),
      ]} />

      {forbidden ? (
        <Note kind="warn" className="act" data-lst-forbidden="">
          <div><b>{t('forbiddenB')}</b><p>{t('forbiddenText')}</p></div>
          <Link className="my-bp" href="/verify">{t('verify')}</Link>
        </Note>
      ) : all.length === 0 ? (
        <Empty>{t('empty')} <Link href="/register">{t('first')}</Link></Empty>
      ) : rows.length === 0 ? (
        <Empty>{t('emptyTab')}</Empty>
      ) : (
        <div data-my-listings>
          {rows.map((r) => (
            <div key={r.id} className="my-lrow">
              <div className="my-lt">
                <div className="my-lh">
                  <span className={`my-bg ${TONE[r.status] ?? 'off'}`}>{r.statusLabel ?? r.status}</span>
                  <GwanTag code={r.gwanCode} />
                  {r.categoryName && <span className="my-ck">{r.categoryName}</span>}
                  {r.gradeLabel && r.status !== 'DRAFT' && <span className="my-ck">{r.gradeLabel}</span>}
                  {r.desiredFee != null && <span className="my-ck">{t('fee', { fee: won(r.desiredFee) })}</span>}
                  {r.status === 'IN_REVIEW' && r.slaDueAt && <span className="my-ck warn">{t('sla', { date: dtKst(r.slaDueAt) })}</span>}
                </div>
                <Link className="my-lnk" href={`/listings/${r.id}/edit`}>{r.title}</Link>
                <span className="my-ls blk">{[shortId(r.id, 'L-'), ymdKst(r.publishedAt ?? r.createdAt ?? r.updatedAt)].filter(Boolean).join(' · ')}</span>
              </div>
              <div className="my-lstat" data-lstat={r.id}>
                <span>{t('views')} <b>{(r.viewCount ?? 0).toLocaleString('ko-KR')}</b></span>
                <span>{t('likes')} <b>{(r.likeCount ?? 0).toLocaleString('ko-KR')}</b></span>
                <span>{t('inquiries')} <b>{(r.inquiryCount ?? 0).toLocaleString('ko-KR')}</b></span>
              </div>
              <div className="my-lact">
                {/* v10.27 (G-193) — 수정 화면은 /listings/{id}/edit */}
                {r.status === 'REJECTED' ? <Link className="my-bo sm" href={`/listings/${r.id}/edit`}>{t('resubmit')}</Link>
                  : r.status === 'ARCHIVED' ? <Link className="my-bo sm" href={`/listings/${r.id}/edit`} data-relist={r.id}>{t('relist')}</Link>
                  : <Link className="my-bo sm" href={`/listings/${r.id}/edit`}>{t('edit')}</Link>}
                {r.status === 'PUBLISHED' && <Link className="my-bo sm" href={`/${GWAN_PATH[r.gwanCode ?? ''] ?? 'money'}/${r.id}`}>{t('view')}</Link>}
                {r.status !== 'ARCHIVED' && <Link className="my-bo sm" href={`/my/inquiries?listing=${r.id}`} data-listing-inq={r.id}>{t('received')}</Link>}
                {['PUBLISHED', 'IN_REVIEW', 'REJECTED', 'DRAFT'].includes(r.status) && <Msgs ns={['deal']}><ArchiveButton id={r.id} title={r.title} /></Msgs>}
              </div>
              {r.status === 'REJECTED' && r.rejectReasonLabel && (
                <div className="my-rej"><b>{t('rejected', { reason: r.rejectReasonLabel })}</b><p>{r.rejectFixGuide ?? t('fixDefault')}</p></div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet, apiGetPersonal, ApiFailure } from '@/lib/api';
import type { ListingListData } from '@/lib/types';
import { OwnerListingForm, OwnershipForm } from './BrokerForms';
import { FileOpenButton } from '@/components/files/FileOpenButton';
import { BackBar } from '@/components/common/BackBar';

import { ymdKst } from '@/lib/format';
import { getFmt } from '@/lib/getFmt';
import { getLocale, getTranslations } from 'next-intl/server';
import { Msgs } from '@/i18n/Msgs';
import { withCodes } from '@/lib/ruleCodes';   // v10.132 규칙 코드 작게

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('join.malBrokers'))('metaTitle') };
}

interface Detail {
  id: string; gwanCode: string; categoryName: string; title: string; body: string | null;
  desiredFee: number | null; feeBearerLabel: string | null; status: string; statusLabel: string;
  publishedAt: string | null; regionNames: string[];
  owner: { verified: boolean; companyName: string; confirmedDeals: number };
}
interface MyListing { id: string; title: string; status: string; statusLabel: string }
interface Ownership {
  ok: boolean; state: 'SUBMITTED' | 'VERIFIED' | 'REJECTED' | null; note: string;
  docKey?: string; docFileId?: string | null; issuedOn?: string; hasEncumbrance?: boolean; rejectReason?: string | null; decidedAt?: string | null;
}
interface Category { id: string; name: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ymd = (iso?: string | null) => iso ? ymdKst(iso) : '—';
/* t — 사전 키(join.malBrokers.own.<상태>) */
const OWN: Record<string, { t: 'own.SUBMITTED' | 'own.VERIFIED' | 'own.REJECTED'; c: string }> = {
  SUBMITTED: { t: 'own.SUBMITTED', c: 'state-in_review' },
  VERIFIED:  { t: 'own.VERIFIED', c: 'state-published' },
  REJECTED:  { t: 'own.REJECTED', c: 'state-rejected' },
};

/**
 * SB-MAL-BRK-010 중개사 매물 · 소유 확인 (안심소개 축A 부동산)
 *
 *   GET  /listings?gwanCode=MAL          공개된 부동산 매물
 *   GET  /listings/{id}                  상세(이 화면 안에서 펼침) · 내 매물 관 확인
 *   POST /listings                       본인 소유 물건 초안 등록 (OwnerListingForm)
 *   GET  /me/listings/{id}/ownership     내 소유 확인 상태
 *   POST /me/listings/{id}/ownership     등기사항증명서 제출 (OwnershipForm)
 *   POST /files · PUT · POST /files/{id}/complete   등기부 파일 올리기 (D007)
 *   GET  /files/{id}                     제출한 문서 보기
 *
 * ★ 공인중개사법 18조의2 ③ — 개업공인중개사가 아니면 중개대상물을 표시·광고할 수 없습니다.
 *   그래서 부동산은 ① 중개사 인증 ② 등기로 확인된 본인 소유 물건만 **공개**됩니다(DB fn_broker_gate).
 *   초안은 공개가 아니라 막지 않습니다.
 *
 * v10.29 — 시안 scMalBrk 배치(돌아가기 · 제목 · 경고 · 두 칸 · 표 판 · 아래 단추)로 그립니다.
 *   시안은 「아직 열지 않았습니다 — A-07 법무 회신 대기」 · 견본 3줄이지만, 실제 웹은 이미 열려 있어(중개사 인증 · 소유 확인) 실제 매물 표와 기능을 그대로 둡니다(diffs 안심-5).
 * v10.31 (w2 · 10/10 「시안 기준」 지시) — 시안 정책대로 **A-07 회신 전에는 매물 목록을 열지 않습니다**(사이트 설정 mal.broker_sync.open · 기본 off).
 *   닫힌 동안: 시안 경고 · 「선행 조건」 3 · 「지금 할 수 있는 것」(중개사 인증 신청 · 심사 현황) · 잠긴 표(「회신 전 · 미개방」 — 견본 줄은 지어내지 않고 비웁니다).
 *   개발에만 있던 「내 부동산 매물 · 소유 확인」 · 「본인 소유 물건 올리기」는 그대로 남깁니다(초안은 공개가 아니므로 막지 않습니다).
 *   스위치를 켜면 전처럼 공개된 부동산 매물 표가 나옵니다.
 */
export default async function MalBrokersPage({ searchParams }: {
  searchParams: Promise<{ view?: string; mine?: string; created?: string }>;
}) {
  const p = await me();
  if (!p) redirect('/login');

  const { view, mine, created } = await searchParams;
  const [t, th, locale] = await Promise.all([getTranslations('join.malBrokers'), getTranslations('header.gwan'), getLocale()]);
  const f = await getFmt();

  const [list, categories, myRows, gwans, settings] = await Promise.all([
    apiGet<ListingListData>('/listings?gwanCode=MAL&axis=RE&limit=20&sort=RECENT', 30).catch(() => null),
    apiGet<Category[]>('/categories?gwanCode=MAL', 300).catch(() => [] as Category[]),
    apiGetPersonal<MyListing[]>('/me/listings').catch(() => [] as MyListing[]),
    apiGet<Array<{ code: string; name: string }>>('/gwans', 300).catch(() => []),
    apiGet<Record<string, string | null>>('/site-settings/public', 60).catch(() => ({} as Record<string, string | null>)),
  ]);
  /* v10.31 (w2 · 시안 기준) — 시안 「아직 열지 않았습니다 — A-07 법무 회신 대기」. 운영 스위치 mal.broker_sync.open(D056 · 기본 off)이 켜지기 전에는 목록을 열지 않습니다 */
  const opened = settings['mal.broker_sync.open'] === 'on';
  const malName = locale !== 'ko' ? th('MAL') : (gwans.find((g) => g.code === 'MAL')?.name ?? t('malFallback'));
  const rows = list ? [...list.promoted, ...list.organic] : null;

  /* 펼쳐 볼 매물 */
  let viewed: Detail | null = null; let viewErr: string | null = null;
  if (view) {
    if (!UUID.test(view)) viewErr = t('noListing');
    else viewed = await apiGetPersonal<Detail>(`/listings/${view}`).catch((e) => {
      viewErr = e instanceof ApiFailure && e.status === 404 ? t('goneListing') : t('loadFail');
      return null;
    });
  }

  /* 내 매물 중 부동산(MAL)만 — /me/listings 에 관 코드가 없어 상세로 확인합니다(최근 20건) */
  const myDetails = await Promise.all(myRows.slice(0, 20).map((m) =>
    apiGetPersonal<Detail>(`/listings/${m.id}`).then((d) => ({ m, d })).catch(() => ({ m, d: null as Detail | null }))));
  const myMal = myDetails.filter((x) => x.d?.gwanCode === 'MAL').map((x) => x.m);
  const owns = await Promise.all(myMal.map((m) =>
    apiGetPersonal<Ownership>(`/me/listings/${m.id}/ownership`).catch(() => null)));

  /* 소유 확인할 매물 */
  let ownTarget: MyListing | null = null; let own: Ownership | null = null; let ownErr: string | null = null;
  if (mine) {
    ownTarget = myMal.find((m) => m.id === mine) ?? null;
    if (!ownTarget && UUID.test(mine)) {
      const d = await apiGetPersonal<Detail>(`/listings/${mine}`).catch(() => null);
      if (d?.gwanCode === 'MAL') ownTarget = { id: d.id, title: d.title, status: d.status, statusLabel: d.statusLabel };
    }
    if (!ownTarget) ownErr = t('notMine');
    else own = await apiGetPersonal<Ownership>(`/me/listings/${ownTarget.id}/ownership`).catch(() => null);
  }

  return (
    <><div className="gw">
      <div className="gw-wrap gw-aiw">
        <BackBar href="/mall" label={malName} wrap={false} />
        <div className="gw-pgh"><div><h1>{t('h1')}</h1><p>{t('sub', { mal: malName })}</p></div></div>
        {!opened ? (
          <>
            <div className="gw-nt gw-warn" data-broker-sync="closed">
              {withCodes(t.rich('closedWarn', { b: (c) => <b>{c}</b> }))}
            </div>
            <div className="gw-gapgate">
              <div className="gw-gapg1"><span className="gw-lb">{t('preLb')}</span>
                <ol className="gw-safelist">
                  <li>{withCodes(t.rich('pre1', { b: (c) => <b>{c}</b> }))}</li>
                  <li>{t.rich('pre2', { b: (c) => <b>{c}</b> })}</li>
                  <li>{t('pre3')}</li>
                </ol></div>
              <div className="gw-gapg2"><span className="gw-lb">{t('nowLb')}</span>
                <p>{t('nowP')}</p>
                <div className="gw-dact"><Link className="gw-bp gw-sm" href="/my/broker">{t('applyBroker')}</Link><Link className="gw-bo gw-sm" href="/my/broker/status">{t('reviewStatus')}</Link></div>
                <p className="gw-ls" style={{ marginTop: 8 }}>{t('ownHint')}</p></div>
            </div>
            <div className="gw-gaplock">
              <div className="gw-gaplh"><b>{t('lockTitle')}</b><span className="gw-axwait">{t('lockBadge')}</span></div>
              <div className="gw-tw"><table className="gw-tb2"><thead><tr><th>{t('th.listing')}</th><th>{t('th.region')}</th><th>{t('th.terms')}</th><th>{t('th.provider')}</th></tr></thead>
                <tbody><tr className="gw-lockrow"><td colSpan={4}>{t('lockRow')}</td></tr></tbody></table></div>
              <div className="gw-ls">{t('lockNote')}</div>
            </div>
          </>
        ) : (<>
        <div className="gw-nt gw-warn">
          {t.rich('openWarn', { b: (c) => <b>{c}</b> })}
        </div>

        <div className="gw-gapgate">
          <div className="gw-gapg1">
            <span className="gw-lb">{t('areYouOffice')}</span>
            <p>{t('officeP')}</p>
            <div className="gw-dact"><Link className="gw-bp gw-sm" href="/my/broker">{t('applyBroker')}</Link><Link className="gw-bo gw-sm" href="/my/broker/status">{t('myStatus')}</Link></div>
          </div>
          <div className="gw-gapg2">
            <span className="gw-lb">{t('areYouOwner')}</span>
            <p>{t('ownerP')}</p>
            <div className="gw-dact"><Link className="gw-bp gw-sm" href="#new">{t('ownerBtn')}</Link></div>
          </div>
        </div>

        {/* ── 공개된 부동산 매물 ── */}
        <div className="gw-gaplock gw-open">
          <div className="gw-gaplh"><b>{t('listTitle')}</b><span className="gw-axwait">{t('listBadge')}{rows ? t('count', { n: String(rows.length) }) : ''}</span></div>
          {rows === null ? (
            <p className="form-error" role="alert">{t('listFail')}</p>
          ) : rows.length === 0 ? (
            <p className="gw-empty">{t('listEmpty')}</p>
          ) : (
            <div className="gw-tw">
              <table className="gw-tb2">
                <thead><tr><th>{t('th.listing')}</th><th>{t('th.category')}</th><th className="num">{t('th.fee')}</th><th>{t('th.provider')}</th><th /></tr></thead>
                <tbody>
                  {rows.map((l) => (
                    <tr key={l.id}>
                      <td>{l.isAd && <span className="badge badge-ad">{l.adLabel ?? t('ad')}</span>} {l.title}</td>
                      <td>{l.categoryName}</td>
                      <td className="num">{f.won(l.desiredFee)}</td>
                      <td>{l.owner.companyName}{l.owner.verified && <> <span className="gw-bg gw-ok">{t('verified')}</span></>}</td>
                      <td><Link href={`/mal/brokers?view=${l.id}#view`}>{t('details')}</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {list?.adNotice && <div className="gw-ls">{list.adNotice}</div>}
        </div>

        </>)}

        {opened && view && (
          <section id="view" className="gw-panel" style={{ marginTop: 12, padding: '16px 17px' }}>
            {viewed ? (
              <>
                <div className="gw-sh2" style={{ padding: '0 0 8px' }}><b>{viewed.title}</b></div>
                <p className="gw-ls">{viewed.categoryName} · {viewed.regionNames.join(', ') || t('noRegion')} · {viewed.statusLabel} · {t('published', { date: ymd(viewed.publishedAt) })}</p>
                <p className="doc-body">{viewed.body ?? t('noBody')}</p>
                <p>{t.rich('viewFee', { fee: f.won(viewed.desiredFee), b: (c) => <b>{c}</b> })} {viewed.feeBearerLabel && <span className="gw-ls">({viewed.feeBearerLabel})</span>}</p>
                <p className="gw-ls">{t('viewOwner', { company: viewed.owner.companyName, verified: viewed.owner.verified ? t('bizVerified') : '', n: String(viewed.owner.confirmedDeals) })}</p>
                <div className="gw-dact">
                  <Link className="gw-bp gw-sm" href={`/mall/${viewed.id}`}>{t('toDetail')}</Link>
                  <Link className="gw-bo gw-sm" href="/mal/brokers">{t('close')}</Link>
                </div>
              </>
            ) : <p className="form-error" role="alert">{viewErr}</p>}
          </section>
        )}

        {/* ── 내 부동산 매물 · 소유 확인 ── */}
        <div className="gw-panel" style={{ marginTop: 12, padding: '16px 17px' }}>
          <div className="gw-sh2" style={{ padding: '0 0 8px' }} id="own"><b>{t('ownTitle')}</b></div>
          {mine && (
            ownErr ? <p className="form-error" role="alert">{ownErr}</p> : ownTarget && (
              <section className="gw-brkbox" style={{ marginBottom: 12 }}>
                {created && <p className="ok-note" role="status">{t('created')}</p>}
                <h3>{ownTarget.title} <span className="gw-ls">· {ownTarget.statusLabel}</span></h3>
                {own ? (
                  <>
                    <p>
                      {own.state ? <span className={'state ' + OWN[own.state]?.c}>{OWN[own.state] ? t(OWN[own.state]!.t) : own.state}</span> : <span className="state state-suspended">{t('notSubmitted')}</span>}
                      {' '}{own.note}
                    </p>
                    {own.state && (
                      <p className="gw-ls">{t('ownDoc', { doc: own.docKey ?? '', date: ymd(own.issuedOn) })}{own.hasEncumbrance ? t('encumbered') : ''}{own.decidedAt ? t('decided', { date: ymd(own.decidedAt) }) : ''}
                        {own.docFileId && <> <FileOpenButton fileId={own.docFileId} inline label={t('viewDoc')} /></>}</p>
                    )}
                    {own.rejectReason && <div className="gw-nt gw-warn"><b>{t('rejectB')}</b> {own.rejectReason}</div>}
                    {own.state !== 'VERIFIED' && <Msgs ns={['join']}><OwnershipForm listingId={ownTarget.id} /></Msgs>}
                    {own.state === 'SUBMITTED' && <p className="gw-ls">{t('resubmit')}</p>}
                    {own.state === 'VERIFIED' && <Link className="gw-bo gw-sm" href={`/listings/${ownTarget.id}/edit`}>{t('publish')}</Link>}
                  </>
                ) : <p className="form-error" role="alert">{t('ownLoadFail')}</p>}
                <p className="gw-ls"><Link href="/my/listings">{t('allMine')}</Link></p>
              </section>
            )
          )}
          {myMal.length === 0 ? (
            <p className="gw-ls">{t('noMine')}</p>
          ) : (
            <div className="gw-tw">
              <table className="gw-tb2">
                <thead><tr><th>{t('th.listing')}</th><th>{t('th.state')}</th><th>{t('th.own')}</th><th /></tr></thead>
                <tbody>
                  {myMal.map((m, i) => {
                    const o = owns[i];
                    return (
                      <tr key={m.id}>
                        <td>{m.title}</td>
                        <td>{m.statusLabel}</td>
                        <td>{o?.state ? <span className={'state ' + OWN[o.state]?.c}>{OWN[o.state] ? t(OWN[o.state]!.t) : undefined}</span> : <span className="gw-ls">{t('notSubmitted')}</span>}</td>
                        <td><Link href={`/mal/brokers?mine=${m.id}#own`}>{o?.state === 'VERIFIED' ? t('view') : t('th.own')}</Link></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── 본인 소유 물건 올리기 ── */}
        <div className="gw-panel" style={{ marginTop: 12, padding: '16px 17px' }}>
          <div className="gw-sh2" style={{ padding: '0 0 8px' }} id="new"><b>{t('newTitle')}</b>
            <span className="gw-ls">{t('newNote')}</span></div>
          {categories.length
            ? <Msgs ns={['join']}><OwnerListingForm categories={categories} /></Msgs>
            : <p className="form-error" role="alert">{t('catFail')}</p>}
        </div>

        <div className="gw-prfact" style={{ marginTop: 14 }}><Link className="gw-bo" href="/mall">{t('toMal')}</Link></div>
      </div>
    </div><i hidden data-root-end="" /></>
  );
}

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
export const metadata: Metadata = { title: '중개사 매물 · 소유 확인' };

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
const won = (n: number | null) => (n == null ? '협의' : n.toLocaleString('ko-KR') + '원');
const ymd = (iso?: string | null) => iso ? ymdKst(iso) : '—';
const OWN: Record<string, { t: string; c: string }> = {
  SUBMITTED: { t: '확인 중', c: 'state-in_review' },
  VERIFIED:  { t: '확인 완료', c: 'state-published' },
  REJECTED:  { t: '거절', c: 'state-rejected' },
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

  const [list, categories, myRows, gwans, settings] = await Promise.all([
    apiGet<ListingListData>('/listings?gwanCode=MAL&axis=RE&limit=20&sort=RECENT', 30).catch(() => null),
    apiGet<Category[]>('/categories?gwanCode=MAL', 300).catch(() => [] as Category[]),
    apiGetPersonal<MyListing[]>('/me/listings').catch(() => [] as MyListing[]),
    apiGet<Array<{ code: string; name: string }>>('/gwans', 300).catch(() => []),
    apiGet<Record<string, string | null>>('/site-settings/public', 60).catch(() => ({} as Record<string, string | null>)),
  ]);
  /* v10.31 (w2 · 시안 기준) — 시안 「아직 열지 않았습니다 — A-07 법무 회신 대기」. 운영 스위치 mal.broker_sync.open(D056 · 기본 off)이 켜지기 전에는 목록을 열지 않습니다 */
  const opened = settings['mal.broker_sync.open'] === 'on';
  const malName = gwans.find((g) => g.code === 'MAL')?.name ?? '부동산';
  const rows = list ? [...list.promoted, ...list.organic] : null;

  /* 펼쳐 볼 매물 */
  let viewed: Detail | null = null; let viewErr: string | null = null;
  if (view) {
    if (!UUID.test(view)) viewErr = '없는 매물입니다.';
    else viewed = await apiGetPersonal<Detail>(`/listings/${view}`).catch((e) => {
      viewErr = e instanceof ApiFailure && e.status === 404 ? '없는 매물이거나 내려간 매물입니다.' : '매물을 불러오지 못했습니다.';
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
    if (!ownTarget) ownErr = '내가 올린 부동산 매물이 아닙니다.';
    else own = await apiGetPersonal<Ownership>(`/me/listings/${ownTarget.id}/ownership`).catch(() => null);
  }

  return (
    <><div className="gw">
      <div className="gw-wrap gw-aiw">
        <BackBar href="/mall" label={malName} wrap={false} />
        <div className="gw-pgh"><div><h1>공인중개사 매물 연동</h1><p>중개사 매물 · 소유 확인 — {malName} 축A(부동산) 전용입니다.</p></div></div>
        {!opened ? (
          <>
            <div className="gw-nt gw-warn" data-broker-sync="closed">
              <b>아직 열지 않았습니다 — A-07 법무 회신 대기.</b>{' '}
              공인중개사법 제18조의2 ③ 에 따라 <b>개업공인중개사가 아니면 중개대상물을 표시 · 광고할 수 없습니다.</b>{' '}
              그래서 이 화면은 제휴 중개사무소가 올린 매물만 받아 보여 주는 자리이고, 회신 전에는 목록을 열지 않습니다.
            </div>
            <div className="gw-gapgate">
              <div className="gw-gapg1"><span className="gw-lb">선행 조건</span>
                <ol className="gw-safelist">
                  <li><b>A-07 법무 회신</b> — 소개뱅크가 노출료만 받는 구조가 중개행위에 해당하지 않는지</li>
                  <li><b>중개사 인증</b> — 등록번호 대조와 보증(공제) 확인이 끝난 사무소만(INV-BR1)</li>
                  <li>제휴 계약 — 매물 제공 범위 · 갱신 주기 · 책임 소재</li>
                </ol></div>
              <div className="gw-gapg2"><span className="gw-lb">지금 할 수 있는 것</span>
                <p>중개사 인증은 먼저 받아 둘 수 있습니다. 인증이 끝난 사무소는 회신 직후 바로 매물을 올릴 수 있습니다.</p>
                <div className="gw-dact"><Link className="gw-bp gw-sm" href="/my/broker">중개사 인증 신청</Link><Link className="gw-bo gw-sm" href="/my/broker/status">심사 현황</Link></div>
                <p className="gw-ls" style={{ marginTop: 8 }}>본인 소유 물건이시면 아래에서 초안을 올리고 등기로 소유 확인을 받아 두실 수 있습니다.</p></div>
            </div>
            <div className="gw-gaplock">
              <div className="gw-gaplh"><b>제휴 중개사무소 매물</b><span className="gw-axwait">회신 전 · 미개방</span></div>
              <div className="gw-tw"><table className="gw-tb2"><thead><tr><th>매물</th><th>지역</th><th>조건</th><th>제공</th></tr></thead>
                <tbody><tr className="gw-lockrow"><td colSpan={4}>회신 전이라 목록을 열지 않았습니다.</td></tr></tbody></table></div>
              <div className="gw-ls">회신 전에는 목록을 열지 않습니다 — 열어 두면 아직 자격이 확인되지 않은 매물이 표시 · 광고된 것이 됩니다.</div>
            </div>
          </>
        ) : (<>
        <div className="gw-nt gw-warn">
          <b>개업공인중개사가 아니면 중개대상물을 표시·광고할 수 없습니다(공인중개사법 제18조의2 ③).</b>
          그래서 부동산은 중개사 인증을 받은 사무소가 올린 매물, 또는 등기로 소유가 확인된 본인 물건만 공개됩니다.
        </div>

        <div className="gw-gapgate">
          <div className="gw-gapg1">
            <span className="gw-lb">중개사무소이십니까</span>
            <p>등록번호 대조와 보증(공제) 확인이 끝난 사무소만 부동산 매물을 공개할 수 있습니다.</p>
            <div className="gw-dact"><Link className="gw-bp gw-sm" href="/my/broker">중개사 인증 신청</Link><Link className="gw-bo gw-sm" href="/my/broker/status">내 인증 상태</Link></div>
          </div>
          <div className="gw-gapg2">
            <span className="gw-lb">본인 소유 물건이십니까</span>
            <p>초안을 올리고 등기사항증명서로 소유 확인을 받으시면 공개할 수 있습니다. 사람이 확인합니다.</p>
            <div className="gw-dact"><Link className="gw-bp gw-sm" href="#new">본인 물건 올리기</Link></div>
          </div>
        </div>

        {/* ── 공개된 부동산 매물 ── */}
        <div className="gw-gaplock gw-open">
          <div className="gw-gaplh"><b>부동산 매물</b><span className="gw-axwait">공개 중{rows ? ` · ${rows.length}건` : ''}</span></div>
          {rows === null ? (
            <p className="form-error" role="alert">매물을 불러오지 못했습니다. 잠시 후 새로고침해 주십시오.</p>
          ) : rows.length === 0 ? (
            <p className="gw-empty">공개된 부동산 매물이 아직 없습니다.</p>
          ) : (
            <div className="gw-tw">
              <table className="gw-tb2">
                <thead><tr><th>매물</th><th>업종</th><th className="num">희망 소개비</th><th>제공</th><th /></tr></thead>
                <tbody>
                  {rows.map((l) => (
                    <tr key={l.id}>
                      <td>{l.isAd && <span className="badge badge-ad">{l.adLabel ?? '광고'}</span>} {l.title}</td>
                      <td>{l.categoryName}</td>
                      <td className="num">{won(l.desiredFee)}</td>
                      <td>{l.owner.companyName}{l.owner.verified && <> <span className="gw-bg gw-ok">인증</span></>}</td>
                      <td><Link href={`/mal/brokers?view=${l.id}#view`}>자세히</Link></td>
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
                <p className="gw-ls">{viewed.categoryName} · {viewed.regionNames.join(', ') || '지역 미기재'} · {viewed.statusLabel} · 공개 {ymd(viewed.publishedAt)}</p>
                <p className="doc-body">{viewed.body ?? '설명이 없습니다.'}</p>
                <p>희망 소개비 <b>{won(viewed.desiredFee)}</b> {viewed.feeBearerLabel && <span className="gw-ls">({viewed.feeBearerLabel})</span>}</p>
                <p className="gw-ls">제공: {viewed.owner.companyName} {viewed.owner.verified ? '· 사업자 인증' : ''} · 성사 {viewed.owner.confirmedDeals}건</p>
                <div className="gw-dact">
                  <Link className="gw-bp gw-sm" href={`/mall/${viewed.id}`}>매물 상세 · 문의하기</Link>
                  <Link className="gw-bo gw-sm" href="/mal/brokers">닫기</Link>
                </div>
              </>
            ) : <p className="form-error" role="alert">{viewErr}</p>}
          </section>
        )}

        {/* ── 내 부동산 매물 · 소유 확인 ── */}
        <div className="gw-panel" style={{ marginTop: 12, padding: '16px 17px' }}>
          <div className="gw-sh2" style={{ padding: '0 0 8px' }} id="own"><b>내 부동산 매물 · 소유 확인</b></div>
          {mine && (
            ownErr ? <p className="form-error" role="alert">{ownErr}</p> : ownTarget && (
              <section className="gw-brkbox" style={{ marginBottom: 12 }}>
                {created && <p className="ok-note" role="status">초안을 올렸습니다. 이제 소유 확인을 요청하십시오 — 확인 전에는 공개되지 않습니다.</p>}
                <h3>{ownTarget.title} <span className="gw-ls">· {ownTarget.statusLabel}</span></h3>
                {own ? (
                  <>
                    <p>
                      {own.state ? <span className={'state ' + OWN[own.state]?.c}>{OWN[own.state]?.t ?? own.state}</span> : <span className="state state-suspended">미제출</span>}
                      {' '}{own.note}
                    </p>
                    {own.state && (
                      <p className="gw-ls">제출 문서 {own.docKey} · 발급일 {ymd(own.issuedOn)}{own.hasEncumbrance ? ' · 권리제한 있음' : ''}{own.decidedAt ? ` · 판정 ${ymd(own.decidedAt)}` : ''}
                        {own.docFileId && <> <FileOpenButton fileId={own.docFileId} inline label="제출한 문서 보기" /></>}</p>
                    )}
                    {own.rejectReason && <div className="gw-nt gw-warn"><b>거절 사유:</b> {own.rejectReason}</div>}
                    {own.state !== 'VERIFIED' && <OwnershipForm listingId={ownTarget.id} />}
                    {own.state === 'SUBMITTED' && <p className="gw-ls">다시 제출하시면 이전 제출을 대신합니다.</p>}
                    {own.state === 'VERIFIED' && <Link className="gw-bo gw-sm" href={`/listings/${ownTarget.id}/edit`}>설명 적고 공개하기(매물 수정)</Link>}
                  </>
                ) : <p className="form-error" role="alert">소유 확인 상태를 불러오지 못했습니다.</p>}
                <p className="gw-ls"><Link href="/my/listings">내 리스팅 전체 보기</Link></p>
              </section>
            )
          )}
          {myMal.length === 0 ? (
            <p className="gw-ls">올리신 부동산 매물이 없습니다.</p>
          ) : (
            <div className="gw-tw">
              <table className="gw-tb2">
                <thead><tr><th>매물</th><th>상태</th><th>소유 확인</th><th /></tr></thead>
                <tbody>
                  {myMal.map((m, i) => {
                    const o = owns[i];
                    return (
                      <tr key={m.id}>
                        <td>{m.title}</td>
                        <td>{m.statusLabel}</td>
                        <td>{o?.state ? <span className={'state ' + OWN[o.state]?.c}>{OWN[o.state]?.t}</span> : <span className="gw-ls">미제출</span>}</td>
                        <td><Link href={`/mal/brokers?mine=${m.id}#own`}>{o?.state === 'VERIFIED' ? '보기' : '소유 확인'}</Link></td>
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
          <div className="gw-sh2" style={{ padding: '0 0 8px' }} id="new"><b>본인 소유 물건 올리기</b>
            <span className="gw-ls">초안으로 올라갑니다. 등기로 소유가 확인되기 전에는 누구에게도 보이지 않습니다.</span></div>
          {categories.length
            ? <OwnerListingForm categories={categories} />
            : <p className="form-error" role="alert">업종 목록을 불러오지 못했습니다. 잠시 후 새로고침해 주십시오.</p>}
        </div>

        <div className="gw-prfact" style={{ marginTop: 14 }}><Link className="gw-bo" href="/mall">안심소개로</Link></div>
      </div>
    </div><i hidden data-root-end="" /></>
  );
}

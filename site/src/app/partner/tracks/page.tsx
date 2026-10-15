import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { ymdKst } from '@/lib/format';
import { Bg, Empty, Note, Pgh, Tabs, Tw, won, type Tone } from '@/components/partner/ui';
import { CatalogForm, CatalogToggle, QuoteForm } from './TrackForms';

export const metadata: Metadata = { title: '전용 트랙' };

interface Tracks {
  repair: Array<{ deliveryId: string; no: string; summary: string; area: string; deliveredAt: string; viewedAt: string | null; state: string;
    quoteAmount: number | null; quotedAt: string | null; stage: string; feeQuote: number }>;
  car: Array<{ id: string; no: string; title: string; status: string; createdAt: string; categoryName: string }>;
  catalog: Array<{ id: string; name: string; saleKind: string; price: number; state: string; createdAt: string }>;
  enabled: string[];
  notes: { track: string; car: string; repair: string };
}
type Tab = 'repair' | 'car' | 'catalog';
const STAGE: Record<string, Tone> = { '견적 요청': 'wait', '연락처 확인': 'wait', '견적 발송': 'ok', '성사': 'ok', '기한 지남': 'off' };
const LST: Record<string, [string, Tone]> = { PUBLISHED: ['노출중', 'ok'], IN_REVIEW: ['검수중', 'wait'], DRAFT: ['작성중', 'wait'], REJECTED: ['반려', 'no'], SUSPENDED: ['정지', 'no'], ARCHIVED: ['보관', 'off'] };

/**
 * SB-PTC-CTR-950 전용 트랙 — v10.31 (W5 · 10/10 시안 기준 scPtnTrack) · 주소도 시안대로 /partner/tracks (옛 /repair-inbox 는 여기로)
 *   파트너센터 틀 안 3탭: 판금 · 도색(견적요청함 — 받은 요청 · 연락처를 연 뒤 견적) / 중고차 매물(내 매물) / 제품 카탈로그(렌탈 · 판매 품목).
 *   결함 「새 요청이 없습니다 — 아래 표에 1건」: 옛 화면은 「새 요청(안 연 것) 수」 문구 아래 「받은 요청 전체」를 그렸습니다 —
 *   이제 탭 수는 받은 요청 전체, 문구는 「안 연 요청 N건 · 전체 M건」으로 둘을 함께 적습니다.
 */
export default async function TracksPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const p = await me();
  if (!p) redirect('/login');
  const sp = await searchParams;
  const tab: Tab = (['repair', 'car', 'catalog'] as const).includes(sp.tab as Tab) ? (sp.tab as Tab) : 'repair';
  const t = await apiGet<Tracks>('/partner/tracks', 0).catch(() => null);
  if (!t) return <><Pgh title="전용 트랙" /><Empty>파트너가 아닙니다. <Link href="/partner/apply">입점 신청</Link>부터 해 주십시오.</Empty><i hidden data-root-end="" /></>;
  const fresh = t.repair.filter((r) => !r.viewedAt && r.state === 'DELIVERED').length;
  const href = (x: Tab) => (x === 'repair' ? '/partner/tracks' : `/partner/tracks?tab=${x}`);

  return (
    <><Pgh title="전용 트랙" sub="카테고리마다 접수 형태가 다릅니다 — 견적요청함 · 매물 · 카탈로그." />
      <Tabs cur={tab} items={[
        { key: 'repair', label: '판금 · 도색', count: t.repair.length, href: href('repair') },
        { key: 'car', label: '중고차 매물', count: t.car.length, href: href('car') },
        { key: 'catalog', label: '제품 카탈로그', count: t.catalog.length, href: href('catalog') },
      ]} />

      {tab === 'repair' && (
        <>
          <p className="pt-ls" data-repair-count style={{ margin: '0 0 10px' }}>
            {fresh > 0 ? <>열어 보지 않은 새 요청 <b>{fresh}건</b> · 받은 요청 전체 {t.repair.length}건</> : t.repair.length > 0 ? <>새 요청(안 연 요청)은 없습니다 · 받은 요청 전체 {t.repair.length}건</> : '받은 요청이 없습니다.'}
          </p>
          {t.repair.length === 0 ? (
            <Empty>아직 받은 견적 요청이 없습니다. <Link href="/partner/regions">서비스 지역</Link>과 <Link href="/partner/services">정비 · 판금 서비스</Link>를 열어 두시면 배정됩니다.</Empty>
          ) : (
            <Tw head={['요청번호', '차량 · 부위', '상태', '접수', '견적']}>
              {t.repair.map((r) => (
                <tr key={r.deliveryId} className={r.viewedAt ? undefined : 'mine'}>
                  <td><b className="pt-code">{r.no}</b></td>
                  <td><b>{r.summary}</b><div className="pt-ls">{r.area || '—'}</div></td>
                  <td><Bg tone={STAGE[r.stage] ?? 'off'}>{r.stage}</Bg></td>
                  <td>{ymdKst(r.deliveredAt)}</td>
                  <td>{r.viewedAt ? <>{r.quoteAmount ? <b>{won(r.quoteAmount)}원 </b> : null}<QuoteForm deliveryId={r.deliveryId} amount={r.quoteAmount} /></>
                    : r.state === 'DELIVERED' ? <Link className="pt-bp sm" href="/partner/leads?tab=new">연락처 열기({won(r.feeQuote)}원)</Link> : '—'}</td>
                </tr>
              ))}
            </Tw>
          )}
          <Note kind="info"><b>{t.notes.repair}</b></Note>
        </>
      )}

      {tab === 'car' && (
        <>
          {t.car.length === 0 ? <Empty>등록한 중고차 매물이 없습니다. <Link href="/register">매물 등록</Link>에서 「자동차」 분류로 올리시면 여기에 모입니다.</Empty> : (
            <Tw head={['매물번호', '차량', '가격', '상태', '국토부 조회']}>
              {t.car.map((c) => {
                const st = LST[c.status] ?? [c.status, 'off' as Tone];
                return (
                  <tr key={c.id}>
                    <td><b className="pt-code">{c.no}</b></td>
                    <td><b>{c.title}</b><div className="pt-ls">{c.categoryName} · {ymdKst(c.createdAt)}</div></td>
                    <td>—<div className="pt-ls">매물 글에 적은 가격</div></td>
                    <td><Bg tone={st[1]}>{st[0]}</Bg></td>
                    <td><Bg tone="off">조회 전</Bg></td>
                  </tr>
                );
              })}
            </Tw>
          )}
          <Note kind="warn"><b>{t.notes.car}</b></Note>
        </>
      )}

      {tab === 'catalog' && (
        <>
          {t.catalog.length === 0 ? <Empty>등록한 제품이 없습니다. 렌탈 · 판매 품목을 아래에서 등록합니다.</Empty> : (
            <Tw head={['제품', '형태', '가격', '상태', '']} numCols={[2]}>
              {t.catalog.map((c) => (
                <tr key={c.id}>
                  <td><b>{c.name}</b></td>
                  <td>{c.saleKind === 'RENTAL' ? '렌탈' : '판매'}</td>
                  <td className="num">{won(c.price)}원{c.saleKind === 'RENTAL' ? '/월' : ''}</td>
                  <td>{c.state === 'LISTED' ? <Bg tone="ok">등록됨</Bg> : <Bg tone="off">숨김</Bg>}</td>
                  <td><CatalogToggle id={c.id} state={c.state} /></td>
                </tr>
              ))}
            </Tw>
          )}
          <CatalogForm />
        </>
      )}

      <Note kind="info"><b>{t.notes.track}</b>{t.enabled.length === 0 ? ' 지금 승인된 서비스에 전용 트랙 업종(정비 · 중고차 · 렌탈)이 없습니다.' : ''}</Note>
    <i hidden data-root-end="" /></>
  );
}

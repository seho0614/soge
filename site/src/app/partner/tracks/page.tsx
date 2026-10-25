import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { ymdKst } from '@/lib/format';
import { Bg, Empty, Note, Pgh, ptCode, Tabs, Tw, won, type Tone } from '@/components/partner/ui';
import { CatalogForm, CatalogToggle, QuoteForm } from './TrackForms';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('partner.meta'))('tracks') };
}

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
/* v10.100 (다국어 2-5a) — 매물 상태 글자는 사전 partner.tracks.lst.<코드> */
const LST: Record<string, Tone> = { PUBLISHED: 'ok', IN_REVIEW: 'wait', DRAFT: 'wait', REJECTED: 'no', SUSPENDED: 'no', ARCHIVED: 'off' };

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
  const tt = await getTranslations('partner.tracks');
  const won0 = (await getTranslations('partner.common.unit'))('won');
  const t = await apiGet<Tracks>('/partner/tracks', 0).catch(() => null);
  if (!t) return <><Pgh title={tt('title')} /><Empty>{tt.rich('notPartner', { apply: (c) => <Link href="/partner/apply">{c}</Link> })}</Empty><i hidden data-root-end="" /></>;
  const fresh = t.repair.filter((r) => !r.viewedAt && r.state === 'DELIVERED').length;
  const href = (x: Tab) => (x === 'repair' ? '/partner/tracks' : `/partner/tracks?tab=${x}`);

  return (
    <><Pgh title={tt('title')} sub={tt('sub')} />
      <Tabs cur={tab} items={[
        { key: 'repair', label: tt('tabRepair'), count: t.repair.length, href: href('repair') },
        { key: 'car', label: tt('tabCar'), count: t.car.length, href: href('car') },
        { key: 'catalog', label: tt('tabCatalog'), count: t.catalog.length, href: href('catalog') },
      ]} />

      {tab === 'repair' && (
        <>
          <p className="pt-ls" data-repair-count style={{ margin: '0 0 10px' }}>
            {fresh > 0 ? <>{tt.rich('fresh', { b: (c) => <b>{c}</b>, n: String(fresh), total: String(t.repair.length) })}</> : t.repair.length > 0 ? <>{tt('noFresh', { total: String(t.repair.length) })}</> : tt('noReq')}
          </p>
          {t.repair.length === 0 ? (
            <Empty>{tt.rich('emptyRepair', { regions: (c) => <Link href="/partner/regions">{c}</Link>, services: (c) => <Link href="/partner/services">{c}</Link> })}</Empty>
          ) : (
            <Tw head={[tt('thNo'), tt('thCar'), tt('thState'), tt('thDate'), tt('thQuote')]}>
              {t.repair.map((r) => (
                <tr key={r.deliveryId} className={r.viewedAt ? undefined : 'mine'}>
                  <td><b className="pt-code">{r.no}</b></td>
                  <td><b>{r.summary}</b><div className="pt-ls">{r.area || '—'}</div></td>
                  <td><Bg tone={STAGE[r.stage] ?? 'off'}>{r.stage}</Bg></td>
                  <td>{ymdKst(r.deliveredAt)}</td>
                  <td>{r.viewedAt ? <>{r.quoteAmount ? <b>{won(r.quoteAmount)}{won0} </b> : null}<QuoteForm deliveryId={r.deliveryId} amount={r.quoteAmount} /></>
                    : r.state === 'DELIVERED' ? <Link className="pt-bp sm" href="/partner/leads?tab=new">{tt('openContact', { fee: won(r.feeQuote) })}</Link> : '—'}</td>
                </tr>
              ))}
            </Tw>
          )}
          <Note kind="info"><b>{t.notes.repair}</b></Note>
        </>
      )}

      {tab === 'car' && (
        <>
          {t.car.length === 0 ? <Empty>{tt.rich('emptyCar', { reg: (c) => <Link href="/register">{c}</Link> })}</Empty> : (
            <Tw head={[tt('thListNo'), tt('thVehicle'), tt('thPrice'), tt('thState'), tt('thMolit')]}>
              {t.car.map((c) => {
                const st = [ptCode(tt, 'lst', c.status, c.status), LST[c.status] ?? ('off' as Tone)] as const;
                return (
                  <tr key={c.id}>
                    <td><b className="pt-code">{c.no}</b></td>
                    <td><b>{c.title}</b><div className="pt-ls">{c.categoryName} · {ymdKst(c.createdAt)}</div></td>
                    <td>—<div className="pt-ls">{tt('priceInPost')}</div></td>
                    <td><Bg tone={st[1]}>{st[0]}</Bg></td>
                    <td><Bg tone="off">{tt('notQueried')}</Bg></td>
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
          {t.catalog.length === 0 ? <Empty>{tt('emptyCatalog')}</Empty> : (
            <Tw head={[tt('thProduct'), tt('thKind'), tt('thPrice'), tt('thState'), '']} numCols={[2]}>
              {t.catalog.map((c) => (
                <tr key={c.id}>
                  <td><b>{c.name}</b></td>
                  <td>{c.saleKind === 'RENTAL' ? tt('rental') : tt('sale')}</td>
                  <td className="num">{won(c.price)}{won0}{c.saleKind === 'RENTAL' ? tt('perMonth') : ''}</td>
                  <td>{c.state === 'LISTED' ? <Bg tone="ok">{tt('listed')}</Bg> : <Bg tone="off">{tt('hidden')}</Bg>}</td>
                  <td><CatalogToggle id={c.id} state={c.state} /></td>
                </tr>
              ))}
            </Tw>
          )}
          <CatalogForm />
        </>
      )}

      <Note kind="info"><b>{t.notes.track}</b>{t.enabled.length === 0 ? tt('noTrack') : ''}</Note>
    <i hidden data-root-end="" /></>
  );
}

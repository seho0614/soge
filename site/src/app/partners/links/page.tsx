import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { LinkCreateForm } from '@/components/partners/LinkCreateForm';
import { CopyButton } from '@/components/partners/CopyButton';
import type { AffLink, AffProduct } from '@/components/partners/types';

import { getFmt } from '@/lib/getFmt';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('affiliate'))('links.title') };
}

/** 공유 주소의 도메인 — SITE_ORIGIN 이 있으면 그것, 없으면 지금 요청의 호스트(개발·스테이징 그대로 맞음) */
async function siteOrigin(): Promise<string> {
  if (process.env.SITE_ORIGIN) return process.env.SITE_ORIGIN.replace(/\/$/, '');
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost';
  const proto = h.get('x-forwarded-proto') ?? (/^(localhost|127\.|\[::1\])/.test(host) ? 'http' : 'https');
  return `${proto}://${host}`;
}

/**
 * SB-AFC-LNK-010 내 소개링크
 *
 * GET /partner/affiliate/links (링크별 클릭·주문) · POST /partner/affiliate/links (발급).
 * ★ D001 — 뿌릴 것은 **공유 주소**(`{도메인}/r/{코드}`)입니다. 이 주소를 눌러야 클릭이 셉니다
 *   (하루·방문자당 1회, 미리보기 로봇 제외). 코드만 복사해 붙이면 아무 데도 가지 않습니다.
 * ★ 판매가 끝난 상품의 링크는 눌러도 아무 일이 없습니다 — 상태를 옆에 적어 둡니다.
 */
export default async function PartnerLinksPage() {
  const p = await me();
  if (!p) redirect('/login');
  const t = await getTranslations('affiliate');
  const fm = await getFmt();

  const origin = await siteOrigin();
  const [links, products] = await Promise.all([
    apiGetPersonal<AffLink[]>('/partner/affiliate/links').catch(() => null),
    apiGetPersonal<AffProduct[]>('/partner/affiliate/products').catch(() => [] as AffProduct[]),
  ]);

  return (
    <>
      <div className="page-head"><h1>{t('links.title')}</h1></div>
      <p className="lead">{t('links.lead')}</p>
      <div className="notice">
        {t.rich('links.tip', { b: (c) => <b>{c}</b> })}
      </div>
      <p className="hint">{t.rich('links.clickHint', { b: (c) => <b>{c}</b> })}</p>

      {links === null ? (
        <p className="form-error" role="alert">{t('links.loadFail')}</p>
      ) : links.length === 0 ? (
        <p className="empty">{t('links.empty')}</p>
      ) : (
        <table className="tbl">
          <thead><tr><th>{t('links.colLink')}</th><th>{t('common.colProduct')}</th><th className="num">{t('common.colCommission')}</th><th className="num">{t('links.colClicks')}<br /><span className="dim">{t('links.colClicksSub')}</span></th><th className="num">{t('links.colOrders')}</th><th>{t('common.colState')}</th><th /></tr></thead>
          <tbody>
            {links.map((l) => {
              const onSale = l.productStatus === 'ON_SALE';
              const shareUrl = origin + (l.sharePath ?? `/r/${l.code}`);
              return (
                <tr key={l.id} data-link-code={l.code}>
                  {/* v10.31 (W5 · 결함) — 390 폭에서 주소가 한 글자씩 줄바꿈되던 것: 이 칸에 최소 폭을 주고 주소는 「/ · -」 같은 자리에서만 꺾습니다(표는 가로로 밀어 봄) */}
                  <td className="p2lnk">
                    <b>{l.label ?? t('links.noName')}</b> <span className="dim mono">{l.code}</span><br />
                    <code className="mono" data-testid="share-url">{shareUrl}</code>
                  </td>
                  <td>{l.product ?? '—'}</td>
                  <td className="num">{fm.won(l.commission, '—')}</td>
                  <td className="num">{(l.clicksToday ?? 0).toLocaleString('ko-KR')} / {l.clicks.toLocaleString('ko-KR')}</td>
                  <td className="num">{l.orders.toLocaleString('ko-KR')}</td>
                  <td>
                    {!l.isActive ? <span className="state state-suspended">{t('links.stopped')}</span>
                      : onSale ? <span className="state state-published">{t('links.active')}</span>
                      : <span className="state state-rejected">{t('links.notOnSale')}</span>}
                  </td>
                  <td><CopyButton text={shareUrl} label={t('links.copyUrl')} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* v10.29 — 대시보드 「내 소개링크 생성」 단추가 여기로(#new) 옵니다 */}
      <h2 className="sec-title p2gap" id="new">{t('common.makeLink')}</h2>
      {products.length ? (
        <LinkCreateForm products={products.map((x) => ({ id: x.id, name: x.name, commission: x.commission }))} />
      ) : (
        <p className="empty">{t.rich('links.noProducts', { a: (c) => <Link href="/partners/products">{c}</Link> })}</p>
      )}

      <div className="notice warn">
        {t.rich('links.stoppedWarn', { b: (c) => <b>{c}</b>, a: (c) => <Link href="/partners/products">{c}</Link> })}
      </div>
    </>
  );
}

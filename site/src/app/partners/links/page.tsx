import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { LinkCreateForm } from '@/components/partners/LinkCreateForm';
import { CopyButton } from '@/components/partners/CopyButton';
import { krw } from '@/components/partners/fmt';
import type { AffLink, AffProduct } from '@/components/partners/types';

export const metadata: Metadata = { title: '내 소개링크' };

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

  const origin = await siteOrigin();
  const [links, products] = await Promise.all([
    apiGetPersonal<AffLink[]>('/partner/affiliate/links').catch(() => null),
    apiGetPersonal<AffProduct[]>('/partner/affiliate/products').catch(() => [] as AffProduct[]),
  ]);

  return (
    <>
      <div className="page-head"><h1>내 소개링크</h1></div>
      <p className="lead">상품마다 링크를 따로 만드십시오.</p>
      <div className="notice">
        <b>어디에 뿌릴지마다 링크를 따로 만드십시오.</b> 블로그·카톡·문자를 나누면 <b>어느 경로가 잘 되는지</b> 보입니다.
      </div>
      <p className="hint">클릭은 <b>같은 사람이 하루에 여러 번 눌러도 한 번</b>으로 셉니다. 카톡·블로그의 미리보기 로봇은 세지 않습니다.</p>

      {links === null ? (
        <p className="form-error" role="alert">링크 목록을 불러오지 못했습니다. 잠시 후 새로고침해 주십시오.</p>
      ) : links.length === 0 ? (
        <p className="empty">아직 만든 링크가 없습니다. 아래에서 상품을 골라 만드십시오.</p>
      ) : (
        <table className="tbl">
          <thead><tr><th>링크</th><th>상품</th><th className="num">수수료</th><th className="num">클릭<br /><span className="dim">오늘 / 누적</span></th><th className="num">주문</th><th>상태</th><th /></tr></thead>
          <tbody>
            {links.map((l) => {
              const onSale = l.productStatus === 'ON_SALE';
              const shareUrl = origin + (l.sharePath ?? `/r/${l.code}`);
              return (
                <tr key={l.id} data-link-code={l.code}>
                  {/* v10.31 (W5 · 결함) — 390 폭에서 주소가 한 글자씩 줄바꿈되던 것: 이 칸에 최소 폭을 주고 주소는 「/ · -」 같은 자리에서만 꺾습니다(표는 가로로 밀어 봄) */}
                  <td className="p2lnk">
                    <b>{l.label ?? '이름 없음'}</b> <span className="dim mono">{l.code}</span><br />
                    <code className="mono" data-testid="share-url">{shareUrl}</code>
                  </td>
                  <td>{l.product ?? '—'}</td>
                  <td className="num">{krw(l.commission)}</td>
                  <td className="num">{(l.clicksToday ?? 0).toLocaleString('ko-KR')} / {l.clicks.toLocaleString('ko-KR')}</td>
                  <td className="num">{l.orders.toLocaleString('ko-KR')}</td>
                  <td>
                    {!l.isActive ? <span className="state state-suspended">중지</span>
                      : onSale ? <span className="state state-published">사용 중</span>
                      : <span className="state state-rejected">상품 판매 중 아님</span>}
                  </td>
                  <td><CopyButton text={shareUrl} label="주소 복사" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* v10.29 — 대시보드 「내 소개링크 생성」 단추가 여기로(#new) 옵니다 */}
      <h2 className="sec-title p2gap" id="new">링크 만들기</h2>
      {products.length ? (
        <LinkCreateForm products={products.map((x) => ({ id: x.id, name: x.name, commission: x.commission }))} />
      ) : (
        <p className="empty">지금 판매 중인 제휴상품이 없어 새 링크를 만들 수 없습니다. <Link href="/partners/products">추천상품 보기</Link></p>
      )}

      <div className="notice warn">
        <b>판매가 중단된 상품의 링크는 눌러도 아무 일이 없습니다.</b> <Link href="/partners/products">추천상품</Link>에서 판매 중인지 확인하십시오.
      </div>
    </>
  );
}

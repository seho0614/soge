'use client';
/**
 * v10.225 (docs/361) — 소개몰 안내 띠. 소개몰 공통 머리(HltNav)와 소개몰 첫 화면 위에 붙습니다.
 *
 *   ① 판매 중지 — 주문 받기(mall.order_open)가 꺼졌을 때만 · 누구나. 장바구니 · 주문 화면은 그 화면 안내(data-orders-closed)가 있어 띠를 띄우지 않습니다.
 *   ② 입점 판매자(승인 뒤 · 로그인) — 정지 · 이용 제한 · 폐점이면 그 사유, 그렇지 않고 입점 판매(mall.tenant)가 꺼졌으면 「아직 판매되지 않음」.
 *   ③ 판매자가 아닌 회원 · 파트너(로그인) — 입점 신청(mall.tenant_apply)을 받는지. 「아직 열리지 않음」은 닫기(×) — 그 창을 닫을 때까지.
 *   ② · ③ 은 한 사람에게 하나만. 입점 신청 · 판매자센터 화면(/health/seller…)은 그 화면이 상태를 보여 주므로 띄우지 않습니다.
 *
 * 로그인 여부는 머리줄과 같은 /cart-count 로 봅니다 — 로그인하지 않은 사람에게 /me API 를 불러 브라우저 오류 기록(401)을 남기지 않으려고.
 * 문구는 서버 부품(HltNav)이 사전에서 꺼내 넘깁니다({reason} 은 여기서 채움).
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export type BandText = Record<
  'orderOff' | 'saleOff' | 'paused' | 'blocked' | 'closed' | 'pending' | 'applyOn' | 'applyOff' | 'center' | 'apply' | 'view' | 'dismiss' | 'aria',
  string
>;

type Seller = { status?: string; statusReason?: string | null } | null;
type Band = { kind: string; tone: 'warn' | 'info' | 'muted'; text: string; href?: string; link?: string; dismiss?: boolean };

const DISMISS_KEY = 'sgb_hlt_band_apply_off';
const under = (p: string, base: string) => p === base || p.startsWith(base + '/');
const getJson = (u: string) => fetch(u, { credentials: 'same-origin', cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

export function HltNoticeBand({ text }: { text: BandText }) {
  const p = usePathname() ?? '/';
  const [bands, setBands] = useState<Band[]>([]);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let live = true;
    try { setHidden(sessionStorage.getItem(DISMISS_KEY) === '1'); } catch { /* 저장소를 못 쓰면 늘 보임 */ }
    (async () => {
      const [order, tenant, cc] = await Promise.all([getJson('/api/v1/health/order-config'), getJson('/api/v1/health/tenant/config'), getJson('/cart-count')]);
      const out: Band[] = [];
      if (order && order.open === false && !under(p, '/health/cart') && !under(p, '/health/order')) {
        out.push({ kind: 'order-off', tone: 'warn', text: text.orderOff });
      }
      if (cc?.in === true && !under(p, '/health/seller')) {
        const mine = await getJson('/api/v1/me/health/seller');
        const s: Seller = mine?.seller ?? null;
        const why = (k: string) => text[k as keyof BandText].replace('{reason}', (s?.statusReason ?? '').trim() || '-');
        if (s?.status === 'PAUSED') out.push({ kind: 'seller-paused', tone: 'warn', text: why('paused'), href: '/health/seller/center', link: text.center });
        else if (s?.status === 'BLOCKED') out.push({ kind: 'seller-blocked', tone: 'muted', text: why('blocked'), href: '/health/seller', link: text.view });
        else if (s?.status === 'CLOSED') out.push({ kind: 'seller-closed', tone: 'muted', text: why('closed'), href: '/health/seller', link: text.view });
        else if (s?.status === 'ACTIVE') {
          if (tenant && tenant.saleOpen === false) out.push({ kind: 'sale-off', tone: 'info', text: text.saleOff, href: '/health/seller/center', link: text.center });
        } else if (s?.status === 'PENDING') out.push({ kind: 'seller-pending', tone: 'info', text: text.pending, href: '/health/seller', link: text.view });
        else if (tenant?.enabled === true) out.push({ kind: 'apply-on', tone: 'info', text: text.applyOn, href: '/health/seller', link: text.apply });
        else if (tenant) out.push({ kind: 'apply-off', tone: 'muted', text: text.applyOff, dismiss: true });
      }
      if (live) setBands(out);
    })();
    return () => { live = false; };
  }, [p, text]);

  const shown = bands.filter((b) => !(b.dismiss && hidden));
  if (!shown.length) return null;
  return (
    <div className="hlt-bands" role="note" aria-label={text.aria} data-hlt-bands="">
      {shown.map((b) => (
        <div key={b.kind} className={`hlt-band ${b.tone}`} data-hlt-band={b.kind}>
          <span>{b.text}</span>
          {b.href && b.link && <Link href={b.href}>{b.link}</Link>}
          {b.dismiss && (
            <button type="button" className="hlt-band-x" aria-label={text.dismiss} data-hlt-band-x=""
              onClick={() => { setHidden(true); try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* 이 화면에서만 닫힘 */ } }}>×</button>
          )}
        </div>
      ))}
    </div>
  );
}

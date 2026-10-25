/**
 * 소개몰(건강관) 공용 조각 — 로컬 내비 · 상품 카드 · 판매자 정보 · 단계 표시 · 빈 상태.
 *
 * 서버 컴포넌트입니다. 담기 버튼만 클라이언트(CartAdd)로 떼어 둡니다.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { apiGet } from '@/lib/api';
import { Msgs } from '@/i18n/Msgs';
import type { HltProduct } from './types';
import { CartAdd } from './CartAdd';
import { ProductArt, Rosette } from './ProductArt';
import { useFmt } from '@/lib/useFmt';

/**
 * 「← 뒤로」 — 시안의 하위 화면 머리(v10.25 · 2026-10-08 「시안을 기준으로」).
 *
 * 전에는 여기에 둘째 메뉴 줄(홈 · 직판관 · 성분별 · 고민별 · 전체제품 · 검색 · 이용안내 · 장바구니)이 있었습니다.
 * 시안은 그 메뉴를 **메인에만** 두고(작은 메뉴 줄), 하위 화면에는 「← 뒤로」와 경로 줄만 둡니다.
 * back 은 시안의 부모 화면입니다(직판관 → 메인 · 성분 상세 → 성분별 · 주문서 → 장바구니 …). 주지 않으면 소개몰 메인입니다.
 * on 은 예전 메뉴 줄의 표시용이었습니다 — 부르는 쪽을 한꺼번에 고치지 않으려고 받기만 합니다.
 */
export function HltNav({ back = '/health' }: { on?: string; back?: string }) {
  const t = useTranslations('hlt.common');
  return (
    <div className="hlt-backrow">
      <Link className="hlt-btn sm" href={back} data-back>{t('back')}</Link>
    </div>
  );
}

export function Crumb({ items }: { items: { href?: string; label: string }[] }) {
  const t = useTranslations('hlt.common');
  return (
    <div className="hlt-crumb">
      <Link href="/health">{t('mall')}</Link>
      {items.map((it, i) => (
        <span key={i}> › {it.href ? <Link href={it.href}>{it.label}</Link> : it.label}</span>
      ))}
    </div>
  );
}

/** 빈 상태 — 문구만 두지 않고 반드시 다음 행동 링크를 붙입니다 (시안 empty()) */
export function HltEmpty({ msg, href, label }: { msg: string; href?: string; label?: string }) {
  return (
    <div className="hlt-empty">
      <p>{msg}</p>
      {href && label && <Link className="hlt-btn" href={href}>{label}</Link>}
    </div>
  );
}

/** 주문 단계 — 장바구니 → 주문서 → 결제 → 완료 */
export function HltSteps({ at }: { at: 0 | 1 | 2 | 3 }) {
  const t = useTranslations('hlt.steps');
  const s = [t('cart'), t('form'), t('pay'), t('done')];
  return (
    <ol className="hlt-steps" aria-label={t('aria')}>
      {s.map((l, i) => <li key={l} className={i === at ? 'on' : i < at ? 'done' : undefined}>{l}</li>)}
    </ol>
  );
}

/**
 * 상품 카드 — 시안의 매대 카드(spec/proto.html card() · v10.26) 그대로.
 *   그림(사진 또는 그린 그림) + 배지 톱니 + 품절 가림막 → 판매자 배지 · 판매자 이름 → **성분 | 함량**(상품명보다 위) → 상품 이름 →
 *   정가(취소선) → 할인율 + 판매가 → 「한 달 N원 부터」(살 수 있는 옵션만) → 청약철회 짧은 글 → 담기 🛒(재고 있는 옵션 가운데 가장 싼 것)
 * 시안과 다른 곳: 후기 수는 v10.27(후기 자료가 생긴 뒤)이라 두지 않습니다. 심의필 번호가 있으면 청약철회 글 옆에 둡니다(개발분에 남기기로 한 것).
 */
export function ProductCard({ p }: { p: HltProduct }) {
  const t = useTranslations('hlt.card');
  const f = useFmt();
  const seller = p.sellerType === 'DIRECT' || !p.sellerType;
  return (
    <article className="hlt-card" data-product={p.code}>
      <Link href={`/health/p/${encodeURIComponent(p.code)}`} className="hlt-card-link">
        <div className="hlt-thumb">
          <ProductArt p={p} size={168} />
          {p.badge && <Rosette label={p.badge} />}
          {p.soldOut && <div className="hlt-soldveil"><span>{t('soldOut')}</span></div>}
        </div>
        <div className="hlt-card-b">
          <div className="hlt-card-sl">
            <span className={`hlt-bdg ${seller ? 'direct' : 'tenant'}`}>{seller ? t('direct') : t('tenant')}</span>
            {' '}<span className="hlt-sm hlt-mut3">{p.sellerName ?? t('defaultSeller')}</span>
          </div>
          {p.mainIngredient && (
            <div className="hlt-ingline" data-ingline="1">{p.mainIngredient.name}{p.mainIngredient.amount && <> <span className="bar">|</span> {p.mainIngredient.amount}</>}</div>
          )}
          <div className="hlt-card-nm">{p.name}</div>
          {p.offPct ? <div className="hlt-p26"><span className="was">{f.won(p.listPrice, '-')}</span></div> : null}
          <div className="hlt-p26">
            {p.offPct ? <span className="off">{p.offPct}%</span> : null}
            <span className="now">{f.won(p.price, '-')}</span>
          </div>
          {p.minUnit != null && <div className="hlt-u26" data-unit="1">{t.rich('unitFrom', { amt: f.won(p.minUnit, '-'), k: (c) => <span className="hlt-k">{c}</span>, b: (c) => <b>{c}</b> })}</div>}
          {/* v10.28 (D036) — 보이는 리뷰가 있으면 별점 · 수(시안 카드의 ★) */}
          {(p.reviewCount ?? 0) > 0 && <div className="hlt-sm" data-card-rating><span className="hlt-stars">★</span> {Number(p.ratingAvg ?? 0).toFixed(1)} <span className="hlt-mut">({p.reviewCount})</span></div>}
          <div className="hlt-sm hlt-mut3 hlt-wd" data-wd="1">
            {t.has(`withdrawal.${p.withdrawal}` as never) ? t(`withdrawal.${p.withdrawal}` as never) : p.withdrawal}{p.reviewNo && <> · {p.reviewNo}</>}
          </div>
        </div>
      </Link>
      <div className="hlt-card-f">
        <span className="hlt-sm hlt-mut3">{p.category}</span>
        {p.soldOut || !p.cartOptionId
          ? <span className="hlt-sm hlt-mut3" data-soldhint="1">{t('soldHint')}</span>
          : <CartAdd code={p.code} name={p.name} optionId={p.cartOptionId} compact />}
      </div>
    </article>
  );
}

export function ProductGrid({ list }: { list: HltProduct[] }) {
  /* 담기 단추(CartAdd · 브라우저 부품)가 hlt 사전을 쓰므로 여기서 내려보냅니다 — 부르는 화면마다 감싸지 않도록(v10.99 · 2-4) */
  return <Msgs ns={['hlt']}><div className="hlt-grid">{list.map((p) => <ProductCard key={p.code} p={p} />)}</div></Msgs>;
}

/**
 * 판매자 정보 — 직판이라 판매자는 소개뱅크(운영 법인) 하나입니다.
 * 값은 사이트 설정(footer.*)에서 읽습니다. 지어내지 않습니다.
 */
export async function SellerBox({ compact = false }: { compact?: boolean }) {
  const s = await apiGet<Record<string, string | null>>('/site-settings/public', 300)
    .catch(() => ({} as Record<string, string | null>));
  const t = await getTranslations('hlt.seller');
  const rows: [string, string | null | undefined][] = [
    [t('company'), s['footer.company_name']],
    [t('ceo'), s['footer.ceo_name']],
    [t('bizNo'), s['footer.biz_reg_no']],
    [t('mailOrderNo'), s['footer.mail_order_no']],
    [t('address'), s['footer.address']],
    [t('phone'), s['footer.phone']],
  ];
  return (
    <section className="hlt-box" data-seller-block="1">
      <h3>{t('title')}</h3>
      {!compact && (
        <table className="tbl hlt-tbl">
          <tbody>
            {rows.map(([k, v]) => <tr key={k}><th>{k}</th><td>{v || t('tbd')}</td></tr>)}
          </tbody>
        </table>
      )}
      <p className="hlt-legal">
        {t.rich('legal', { company: s['footer.company_name'] ?? t('companyFallback'), b: (c) => <b>{c}</b> })}
      </p>
    </section>
  );
}

/** 합계 한 줄 */
export function SumRow({ k, v, tot = false }: { k: string; v: string; tot?: boolean }) {
  return <div className={`hlt-sum${tot ? ' tot' : ''}`}><span>{k}</span><span>{v}</span></div>;
}

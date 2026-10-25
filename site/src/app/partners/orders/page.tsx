import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { krw, ymdhm, ORDER_STATE, codeText } from '@/components/partners/fmt';
import type { AffOrder } from '@/components/partners/types';

import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('affiliate'))('orders.title') };
}

/* 탭 — 서버 state 값 그대로. 글자는 사전(전체 = affiliate.orders.tabAll · 나머지 = affiliate.orderState.<값>).
 * (탭 이름 「확인 중 · 확정 · 정산됨 · 취소」는 orderState 사전 글자와 같습니다.) 모르는 값이 주소로 오면 전체로 돌립니다. */
const TABS = [
  { v: '' },
  { v: 'PENDING' },
  { v: 'CONFIRMED' },
  { v: 'SETTLED' },
  { v: 'CANCELED' },
];

/** 클릭 → 주문까지 걸린 시간. 72시간 규칙을 눈으로 보게 합니다. */
function gap(click: string | null, order: string) {
  if (!click) return '—';
  const h = Math.round((new Date(order).getTime() - new Date(click).getTime()) / 3_600_000);
  return h < 48 ? `${h}시간` : `${Math.round(h / 24)}일`;
}

/**
 * SB-AFC-ORD-010 주문/고객현황 — GET /partner/affiliate/orders?state=
 *
 * ★ 귀속은 **72시간 last-click** 입니다. 귀속 안 된 주문은 서버가 적어 주는
 *   이유(noteIfUnattributed)를 그대로 보여 드립니다 — 안 적으면 "왜 수수료가 없냐" 고 묻습니다.
 */
export default async function PartnerOrdersPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const p = await me();
  if (!p) redirect('/login');
  const t = await getTranslations('affiliate');

  const { state } = await searchParams;
  const cur = TABS.some((x) => x.v === state) ? state ?? '' : '';
  const qs = cur ? `?state=${cur}` : '';
  const rows = await apiGetPersonal<AffOrder[]>(`/partner/affiliate/orders${qs}`).catch(() => null);

  return (
    <>
      <div className="page-head"><h1>{t('orders.title')}</h1></div>
      <p className="lead">{t('orders.lead')}</p>
      <div className="notice">
        {t.rich('orders.rule', { b: (c) => <b>{c}</b> })}
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((tab) => (
          <Link key={tab.v || 'all'} href={tab.v ? `/partners/orders?state=${tab.v}` : '/partners/orders'}
            role="tab" aria-selected={cur === tab.v} className={cur === tab.v ? 'on' : undefined}>{tab.v ? codeText(t, 'orderState', tab.v) : t('orders.tabAll')}</Link>
        ))}
      </div>

      {rows === null ? (
        <p className="form-error" role="alert">{t('orders.loadFail')}</p>
      ) : rows.length === 0 ? (
        <p className="empty">{cur ? t('orders.emptyState') : t('orders.empty')}</p>
      ) : (
        <table className="tbl">
          <thead><tr><th>{t('orders.colOrderNo')}</th><th>{t('common.colProduct')}</th><th>{t('orders.colLink')}</th><th className="num">{t('common.colCommission')}</th><th>{t('common.colState')}</th><th>{t('orders.colGap')}</th><th>{t('orders.colOrderedAt')}</th></tr></thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.orderNo}>
                <td className="mono">{o.orderNo}</td>
                <td>{o.product}</td>
                <td>{o.linkLabel ?? <span className="dim">—</span>}</td>
                <td className="num">{o.attributed ? krw(o.commission) : <span className="dim">—</span>}</td>
                <td>
                  {o.attributed
                    ? <span className={'state ' + (ORDER_STATE[o.state]?.c ?? '')}>{codeText(t, 'orderState', o.state)}</span>
                    : <span className="state state-rejected">{t('orders.unattributed')}</span>}
                  {o.noteIfUnattributed && <div className="dim">{o.noteIfUnattributed}</div>}
                </td>
                <td>{gap(o.clickedAt, o.orderedAt)}</td>
                <td>{ymdhm(o.orderedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

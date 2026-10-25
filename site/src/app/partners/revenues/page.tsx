import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { ymd, codeText } from '@/components/partners/fmt';
import type { AffRevenues } from '@/components/partners/types';

import { getFmt } from '@/lib/getFmt';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('affiliate'))('revenues.title') };
}

/**
 * SB-AFC-REV-010 수익관리 — GET /partner/affiliate/revenues?ym=YYYY-MM
 *
 * ★ 트랙이 섞이면 "왜 정산이 따로 오냐" 가 됩니다 — 트랙을 칸으로 둡니다.
 */
export default async function PartnerRevenuesPage({ searchParams }: { searchParams: Promise<{ ym?: string }> }) {
  const p = await me();
  if (!p) redirect('/login');
  const t = await getTranslations('affiliate');
  const fm = await getFmt();

  const { ym } = await searchParams;
  const okYm = ym && /^\d{4}-\d{2}$/.test(ym) ? ym : '';
  const d = await apiGetPersonal<AffRevenues>(`/partner/affiliate/revenues${okYm ? `?ym=${okYm}` : ''}`).catch(() => null);
  const total = d?.items.reduce((s, r) => s + Number(r.amount), 0) ?? 0;

  return (
    <>
      <div className="page-head"><h1>{t('revenues.title')}</h1></div>
      <p className="lead">{t('revenues.lead')}</p>

      <form className="p2filter" action="/partners/revenues">
        <label className="fld"><span>{t('revenues.month')}</span><input type="month" name="ym" defaultValue={okYm} /></label>
        <button className="btn-sm">{t('revenues.search')}</button>
        {okYm && <Link href="/partners/revenues" className="link-btn">{t('revenues.showAll')}</Link>}
      </form>

      {d === null ? (
        <p className="form-error" role="alert">{t('revenues.loadFail')}</p>
      ) : d.items.length === 0 ? (
        <p className="empty">{okYm ? t('revenues.emptyMonth', { ym: okYm }) : t('revenues.empty')}</p>
      ) : (
        <>
          <div className="p2kpis"><div className="kpi"><div className="k">{t('revenues.sum', { label: okYm || t('revenues.all') })}</div><div className="v">{fm.won(total, '—')}</div><div className="n">{t('revenues.count', { n: String(d.items.length) })}</div></div></div>
          <table className="tbl">
            <thead><tr><th>{t('revenues.colDate')}</th><th>{t('common.colTrack')}</th><th className="num">{t('revenues.colAmount')}</th><th>{t('revenues.colMemo')}</th></tr></thead>
            <tbody>
              {d.items.map((r, i) => (
                <tr key={`${r.date}-${i}`}>
                  <td>{ymd(r.date)}</td><td>{codeText(t, 'track', r.track)}</td>
                  <td className="num">{fm.won(r.amount, '—')}</td><td>{r.memo ?? <span className="dim">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <div className="notice">
        <b>{d?.note ?? t('revenues.separate')}</b><br />
        {t.rich('revenues.separateDesc', { a: (c) => <Link href="/partners/settlements">{c}</Link> })}
      </div>
    </>
  );
}

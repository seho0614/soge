import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { krw, ymd, TRACK } from '@/components/partners/fmt';
import type { AffRevenues } from '@/components/partners/types';

export const metadata: Metadata = { title: '수익관리' };

/**
 * SB-AFC-REV-010 수익관리 — GET /partner/affiliate/revenues?ym=YYYY-MM
 *
 * ★ 트랙이 섞이면 "왜 정산이 따로 오냐" 가 됩니다 — 트랙을 칸으로 둡니다.
 */
export default async function PartnerRevenuesPage({ searchParams }: { searchParams: Promise<{ ym?: string }> }) {
  const p = await me();
  if (!p) redirect('/login');

  const { ym } = await searchParams;
  const okYm = ym && /^\d{4}-\d{2}$/.test(ym) ? ym : '';
  const d = await apiGetPersonal<AffRevenues>(`/partner/affiliate/revenues${okYm ? `?ym=${okYm}` : ''}`).catch(() => null);
  const total = d?.items.reduce((s, r) => s + Number(r.amount), 0) ?? 0;

  return (
    <>
      <div className="page-head"><h1>수익관리</h1></div>
      <p className="lead">월별 수익 내역입니다.</p>

      <form className="p2filter" action="/partners/revenues">
        <label className="fld"><span>월</span><input type="month" name="ym" defaultValue={okYm} /></label>
        <button className="btn-sm">조회</button>
        {okYm && <Link href="/partners/revenues" className="link-btn">전체 보기</Link>}
      </form>

      {d === null ? (
        <p className="form-error" role="alert">수익 내역을 불러오지 못했습니다. 잠시 후 새로고침해 주십시오.</p>
      ) : d.items.length === 0 ? (
        <p className="empty">{okYm ? `${okYm} 에 발생한 수익이 없습니다.` : '아직 발생한 수익이 없습니다.'}</p>
      ) : (
        <>
          <div className="p2kpis"><div className="kpi"><div className="k">{okYm || '전체'} 합계</div><div className="v">{krw(total)}</div><div className="n">{d.items.length}건</div></div></div>
          <table className="tbl">
            <thead><tr><th>발생일</th><th>트랙</th><th className="num">금액</th><th>메모</th></tr></thead>
            <tbody>
              {d.items.map((r, i) => (
                <tr key={`${r.date}-${i}`}>
                  <td>{ymd(r.date)}</td><td>{TRACK[r.track] ?? r.track}</td>
                  <td className="num">{krw(r.amount)}</td><td>{r.memo ?? <span className="dim">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <div className="notice">
        <b>{d?.note ?? '소개비와 제휴수수료는 정산이 따로 나갑니다.'}</b><br />
        제휴수수료는 회사가 지급하고, 소개비는 당사자끼리 직접 주고받습니다(INV-9). <Link href="/partners/settlements">정산내역 보기</Link>
      </div>
    </>
  );
}

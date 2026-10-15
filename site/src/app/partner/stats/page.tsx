import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { Empty, GRADE_KO, Note, Pgh, S2, Tile, won } from '@/components/partner/ui';

export const metadata: Metadata = { title: '실적 · 등급' };

interface S {
  grade: string; received: number; viewed: number; billed: number;
  rates: Array<{ grade: string; rate: string; label?: string }>;
  dist?: Array<{ grade: string | null; label: string; count: number; fee: number }>;
  confirmed?: number; convRate?: number | null;
}

/**
 * SB-PTC-CTR-500 실적 — v10.31 (W5 · 10/10 시안 기준 scPtnStats)
 *   숫자 4칸(받은 리드 · 연락처 열람 · 성사 · 성사율) → 「8등급 분포」 표(등급 · 건수 · 분포 막대 · 확인비용 합계 · 합계 줄) → 안내.
 *   성사 = 소비자가 확인한 이행 보고(서버). 등급이 없는 리드(알림톡 연동 전)는 「미판정」 줄로 따로 셉니다(지어내지 않음).
 */
export default async function StatsPage() {
  const p = await me();
  if (!p) redirect('/login');
  const s = await apiGet<S>('/partner/stats', 0).catch(() => null);
  if (!s) return <><Pgh title="실적" /><Empty>파트너가 아닙니다.</Empty><i hidden data-root-end="" /></>;
  const dist = (s.dist ?? []).filter((d) => d.grade || d.count > 0);
  const mx = Math.max(1, ...dist.map((d) => d.count));
  const total = dist.reduce((a, d) => a + d.count, 0);
  const totalFee = dist.reduce((a, d) => a + Number(d.fee), 0);

  return (
    <><Pgh title="실적" sub="받은 리드가 어떤 등급으로 들어왔는지가 곧 지출 구조입니다." />
      <div className="pt-tiles">
        <Tile label="받은 리드" value={Number(s.received).toLocaleString('ko-KR')} unit="건" href="/partner/leads" />
        <Tile label="연락처 열람" value={Number(s.viewed).toLocaleString('ko-KR')} unit="건" href="/partner/cash" />
        <Tile label="성사" value={(s.confirmed ?? 0).toLocaleString('ko-KR')} unit="건" sub="소비자가 확인한 이행" href="/partner/performance" />
        <Tile label="성사율" value={s.convRate ?? '—'} unit={s.convRate != null ? '%' : undefined} sub={`파트너 등급 ${GRADE_KO[s.grade] ?? s.grade}`} />
      </div>

      <S2>8등급 분포</S2>
      <div className="pt-tw">
        <table className="pt-tb2">
          <thead><tr><th>등급</th><th className="num">건수</th><th>분포</th><th className="num">확인비용 합계</th></tr></thead>
          <tbody>
            {dist.map((d) => (
              <tr key={d.label}>
                <td><span className={`pt-gbadge ${d.grade ? `g${d.label.replace(/[+\-]/, '')}` : 'miss'}`}>{d.label}</span></td>
                <td className="num"><b>{d.count}</b>건</td>
                <td><div className="pt-bar"><i style={{ width: `${Math.round((d.count / mx) * 100)}%` }} /></div></td>
                <td className="num">{won(d.fee)}원</td>
              </tr>
            ))}
            <tr><td><b>합계</b></td><td className="num"><b>{total}</b>건</td><td /><td className="num"><b>{won(totalFee)}원</b></td></tr>
          </tbody>
        </table>
      </div>
      <Note kind="info"><b>등급 분포가 곧 지출 구조입니다.</b> S · A 대역이 늘면 건수는 그대로여도 확인비용 지출이 커집니다. 「미판정」은 알림톡 결과가 없어 기준 단가 그대로 낸 건입니다.</Note>
      <div className="pt-dact">
        <Link className="pt-bo" href="/partner/trust">신뢰지표</Link>
        <Link className="pt-bo" href="/partner/performance">성과 관리</Link>
      </div>
    <i hidden data-root-end="" /></>
  );
}

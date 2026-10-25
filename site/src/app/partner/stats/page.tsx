import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { Empty, GRADE_KO, Note, Pgh, ptCode, S2, Tile, won } from '@/components/partner/ui';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('partner.meta'))('stats') };
}

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
  const t = await getTranslations('partner.stats');
  const tp = await getTranslations('partner');
  const s = await apiGet<S>('/partner/stats', 0).catch(() => null);
  if (!s) return <><Pgh title={t('title')} /><Empty>{tp('common.notPartner')}</Empty><i hidden data-root-end="" /></>;
  const dist = (s.dist ?? []).filter((d) => d.grade || d.count > 0);
  const mx = Math.max(1, ...dist.map((d) => d.count));
  const total = dist.reduce((a, d) => a + d.count, 0);
  const totalFee = dist.reduce((a, d) => a + Number(d.fee), 0);

  return (
    <><Pgh title={t('title')} sub={t('sub')} />
      <div className="pt-tiles">
        <Tile label={t('recv')} value={Number(s.received).toLocaleString('ko-KR')} unit={tp('common.unit.case')} href="/partner/leads" />
        <Tile label={t('viewed')} value={Number(s.viewed).toLocaleString('ko-KR')} unit={tp('common.unit.case')} href="/partner/cash" />
        <Tile label={t('conv')} value={(s.confirmed ?? 0).toLocaleString('ko-KR')} unit={tp('common.unit.case')} sub={t('convSub')} href="/partner/performance" />
        <Tile label={t('convRate')} value={s.convRate ?? '—'} unit={s.convRate != null ? '%' : undefined} sub={t('gradeSub', { grade: ptCode(tp, 'grade', s.grade, GRADE_KO[s.grade] ?? s.grade) })} />
      </div>

      <S2>{t('dist')}</S2>
      <div className="pt-tw">
        <table className="pt-tb2">
          <thead><tr><th>{t('thGrade')}</th><th className="num">{t('thCount')}</th><th>{t('thDist')}</th><th className="num">{t('thFee')}</th></tr></thead>
          <tbody>
            {dist.map((d) => (
              <tr key={d.label}>
                <td><span className={`pt-gbadge ${d.grade ? `g${d.label.replace(/[+\-]/, '')}` : 'miss'}`}>{d.label}</span></td>
                <td className="num"><b>{d.count}</b>{tp('common.unit.case')}</td>
                <td><div className="pt-bar"><i style={{ width: `${Math.round((d.count / mx) * 100)}%` }} /></div></td>
                <td className="num">{won(d.fee)}{tp('common.unit.won')}</td>
              </tr>
            ))}
            <tr><td><b>{t('total')}</b></td><td className="num"><b>{total}</b>{tp('common.unit.case')}</td><td /><td className="num"><b>{won(totalFee)}{tp('common.unit.won')}</b></td></tr>
          </tbody>
        </table>
      </div>
      <Note kind="info">{t.rich('note', { b: (c) => <b>{c}</b> })}</Note>
      <div className="pt-dact">
        <Link className="pt-bo" href="/partner/trust">{t('trust')}</Link>
        <Link className="pt-bo" href="/partner/performance">{t('perf')}</Link>
      </div>
    <i hidden data-root-end="" /></>
  );
}

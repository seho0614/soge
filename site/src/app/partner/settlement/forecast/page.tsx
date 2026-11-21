import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { ymdKst } from '@/lib/format';
import { Empty, Note, Pgh, S2, Tile, Tw, won } from '@/components/partner/ui';
import { getFmt } from '@/lib/getFmt';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('smx.smq.fc'))('title') };
}

type Money = number | null;
interface Fc {
  ym: string; payDate: string; money: boolean; partner: { company: string; grade: string | null };
  counts: { confirmed: number; pending: number; cancelable: number; canceled: number; settled: number };
  amounts: { confirmed: Money; pending: Money; cancelable: Money; canceled: Money; settled: Money };
  estimate: { grossLow: Money; grossHigh: Money; taxLow: Money; taxHigh: Money; netLow: Money; netHigh: Money; rate: number };
  cancelRate90: number | null;
  settlements: Array<{ id: string; track: string; from: string; to: string; gross: number; net: number; state: string; paidAt: string | null }>;
  rewards: { points: number; got: number; wait: number };
  note: string;
}

/**
 * SB-PTC-SMQ-010 파트너센터 › 정산 › 이번 달 정산 예측 — v10.580 (docs/722) · GET /partner/settle-forecast
 *   숫자 4칸(확정 · 대기 · 취소 가능 · 예상 지급) → 예상 지급 아래 끝 ~ 위 끝(원천징수 3.3% 뺌) · 지급일 → 이미 만든 이번 달 정산 → 추천 보상 요약 → 안내
 *   내 파트너 것만(서버가 로그인한 사람의 파트너로 잡음) · 돈 칸은 대표 · 정산 권한 직원만(서버가 비움 — 건수만 보임) · 읽기만
 */
export default async function PartnerForecastPage() {
  const p = await me();
  if (!p) redirect('/login');
  const t = await getTranslations('smx.smq.fc');
  const tp = await getTranslations('partner');
  const f = await getFmt();
  const d = await apiGet<Fc>('/partner/settle-forecast', 0).catch(() => null);
  if (!d) return <><Pgh title={t('title')} /><Empty>{tp('common.notPartner')}</Empty><i hidden data-root-end="" /></>;
  const unit = tp('common.unit.case');
  const amt = (v: Money) => (d.money && v != null ? f.wonOf(won(v)) : '—');
  const e = d.estimate;
  return (
    <><Pgh title={t('title')} sub={t('sub', { ym: d.ym })} />
      <div className="pt-tiles" data-smq-fc-tiles={d.money ? 'money' : 'count'}>
        <Tile label={t('confirmed')} value={amt(d.amounts.confirmed)} sub={t('nCase', { n: String(d.counts.confirmed), u: unit })} />
        <Tile label={t('pending')} value={amt(d.amounts.pending)} sub={t('nCase', { n: String(d.counts.pending), u: unit })} />
        <Tile label={t('cancelable')} value={amt(d.amounts.cancelable)} sub={t('nCase', { n: String(d.counts.cancelable), u: unit })} />
        <Tile label={t('estimate')} value={d.money ? `${amt(e.netLow)} ~ ${amt(e.netHigh)}` : '—'} sub={t('payOn', { d: d.payDate })} />
      </div>
      {!d.money && <Note kind="warn" data-smq-fc-hidden="">{t('moneyHidden')}</Note>}
      {d.money && (
        <div data-smq-fc-estimate="">
          <Tw head={[t('th.part'), t('th.gross'), t('th.tax'), t('th.net')]} numCols={[1, 2, 3]}>
            <tr><td>{t('low')}</td><td className="num">{amt(e.grossLow)}</td><td className="num">{amt(e.taxLow)}</td><td className="num"><b>{amt(e.netLow)}</b></td></tr>
            <tr><td>{t('high')}</td><td className="num">{amt(e.grossHigh)}</td><td className="num">{amt(e.taxHigh)}</td><td className="num"><b>{amt(e.netHigh)}</b></td></tr>
          </Tw>
        </div>
      )}
      <p className="pt-ls" data-smq-fc-cancel90={d.cancelRate90 ?? ''}>
        {t('canceledLine', { n: String(d.counts.canceled), a: amt(d.amounts.canceled), r: d.cancelRate90 == null ? '—' : `${d.cancelRate90}%` })}
      </p>

      <S2>{t('madeH')}</S2>
      {d.settlements.length === 0 ? <Empty>{t('madeEmpty')}</Empty> : (
        <Tw head={[t('th.period'), t('th.gross'), t('th.net'), t('th.state')]} numCols={[1, 2]}>
          {d.settlements.map((s) => (
            <tr key={s.id}><td>{ymdKst(s.from)} ~ {ymdKst(s.to)}</td><td className="num">{f.wonOf(won(s.gross))}</td><td className="num"><b>{f.wonOf(won(s.net))}</b></td><td>{s.state}{s.paidAt ? ` · ${ymdKst(s.paidAt)}` : ''}</td></tr>
          ))}
        </Tw>
      )}

      <S2>{t('rewardH')}</S2>
      <p data-smq-fc-rewards={d.rewards.points}>{t('rewardLine', { p: d.rewards.points.toLocaleString('ko-KR'), g: String(d.rewards.got), w: String(d.rewards.wait) })}</p>

      <Note kind="info"><b>{f.srv(d.note, t('note'))}</b></Note>
      <div className="pt-dact">
        <Link className="pt-bo" href="/partner/settlement">{t('back')}</Link>
      </div>
    <i hidden data-root-end="" /></>
  );
}

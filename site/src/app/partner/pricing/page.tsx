import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { Bg, Empty, Note, Pgh, S2, Tw, won } from '@/components/partner/ui';
import { isGwanKey } from '@/i18n/keys';
import { getFmt } from '@/lib/getFmt';
import { getTranslations } from 'next-intl/server';
import { withCodes } from '@/lib/ruleCodes';   // v10.132 규칙 코드 작게

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('billing.pricing'))('title') };
}

interface Row {
  categoryId: string; categoryName: string; gwanCode: string; formType: string | null; formLabel: string; range: string; rows: number; cols: number;
  state: 'NO_FORM' | 'NO_AXES' | 'EMPTY' | 'PROVISIONAL' | 'SET';
  baseFee: number | null; baseIsDefault: boolean; topFee: number | null; myFee: number | null; matrixCells: number; provisional: boolean;
}
interface Rewards {
  items: Array<{ id: string; title: string; categoryName: string | null; status: string; topFee: number | null; topFeeSet: boolean; referralRate: number | null; rebateBonus: number | null }>;
  rates: Array<{ grade: string; label: string; rate: number }>;
  note: string;
}
/* v10.100 — 관 이름은 사전(header.gwan.*) · 상태 이름은 사전(billing.pricing.state.*) */
const ST: Record<Row['state'], ['set' | 'provisional' | 'empty' | 'noAxes' | 'noForm', 'ok' | 'wait' | 'no' | 'off']> = {
  SET: ['set', 'ok'], PROVISIONAL: ['provisional', 'wait'], EMPTY: ['empty', 'wait'],
  NO_AXES: ['noAxes', 'no'], NO_FORM: ['noForm', 'no'],
};

/**
 * SB-PTC-CTR-900 단가 · 소개비 — v10.31 (W5 · 10/10 시안 기준 scPtnPrice)
 *   「카테고리 · 단가 폼 · 구간 · 상태」 표(+ 개발에만 있던 관 · 기준가 · 내 단가 칸 유지) → 안내 → 「소개비 보상표」(서비스마다 S 확인비용 · 성사 소개비 · 재소개 보너스).
 *   결함 「21업종 전부 단가 미정」 — 상담 업종의 기준 단가가 비어 실제로는 기본 단가로 청구되던 것을 서버 시드(D072)로 채워 「입력됨 · 도입가」로 보입니다.
 *   ★ 남의 단가는 보이지 않습니다(담합의 재료).
 */
export default async function PricingPage() {
  const p = await me();
  if (!p) redirect('/login');
  const [rows, rw] = await Promise.all([
    apiGet<Row[]>('/partner/pricing', 0).catch(() => [] as Row[]),
    apiGet<Rewards>('/partner/pricing/rewards', 0).catch(() => null),
  ]);
  const t = await getTranslations('billing.pricing');
  const f = await getFmt();
  const tg = await getTranslations('header.gwan');
  const tf = await getTranslations('partnerOps.svcForm');
  const provisional = rows.some((r) => r.provisional);
  const maxS = rw?.items.reduce((m, x) => Math.max(m, Number(x.topFee ?? 0)), 0) ?? 0;

  return (
    <><Pgh title={t('title')} sub={t('sub')} />
      {rows.length === 0 ? (
        <Empty>{t('empty')}</Empty>
      ) : (
        <Tw head={[t('thCategory'), t('thForm'), t('thRange'), t('thState'), t('thGwan'), t('thBase'), t('thMine')]} numCols={[5, 6]}>
          {rows.map((r) => {
            const s = ST[r.state];
            const st: [string, 'ok' | 'wait' | 'no' | 'off'] = s ? [t(`state.${s[0]}`), s[1]] : [r.state, 'off'];
            return (
              <tr key={r.categoryId}>
                <td><b>{r.categoryName}</b></td>
                <td>{f.srv(r.formLabel, !r.formType ? t('formNone') : tf.has(`form.${r.formType}` as never) ? tf(`form.${r.formType}` as never) : r.formType)}</td>
                <td>{f.srv(r.range, !r.formType ? '—' : r.formType === 'MATRIX' ? (r.rows && r.cols ? t('rangeMx', { r: String(r.rows), c: String(r.cols) }) : t('rangeTbd'))
                  : r.formType === 'RENTAL' ? t('rangeMonthly') : r.formType === 'MEDICAL' ? t('rangeProc') : t('rangeCase'))}{r.formType === 'MATRIX' && r.matrixCells ? <span className="pt-ls"> · {t('cells', { n: String(r.matrixCells) })}</span> : null}</td>
                <td><Bg tone={st[1]}>{st[0]}</Bg></td>
                <td>{isGwanKey(r.gwanCode) ? tg(r.gwanCode) : r.gwanCode}</td>
                <td className="num">{r.baseFee != null ? f.wonOf(won(r.baseFee)) : '—'}</td>
                <td className="num"><b>{r.myFee != null ? f.wonOf(won(r.myFee)) : '—'}</b>{r.topFee ? <div className="pt-ls">{t('topFee')}</div> : null}</td>
              </tr>
            );
          })}
        </Tw>
      )}
      <Note kind="warn">
        <b>{t('warnB')}</b>
        {provisional ? t('provisional') : ''}
      </Note>

      <S2>{t('hRewards')}</S2>
      {!rw || rw.items.length === 0 ? <Empty>{t('noRewards')}</Empty> : (
        <Tw head={[t('thItem'), t('thAmount'), t('thNote')]}>
          <tr><td><b>S</b></td><td><b>{f.wonOf(won(maxS))}</b></td><td>{t('sNote', { rates: rw.rates.map((r) => `${r.label} ${Math.round(r.rate * 100)}%`).join(' · ') })}</td></tr>
          {rw.items.filter((x) => x.referralRate != null).map((x) => (
            <tr key={`r-${x.id}`}><td><b>{t('referral')}</b><div className="pt-ls">{x.title}</div></td><td><b>{t('referralAmt', { pct: String(Math.round(Number(x.referralRate) * 1000) / 10) })}</b></td><td>{t('referralRange')}</td></tr>
          ))}
          {rw.items.filter((x) => x.rebateBonus).map((x) => (
            <tr key={`b-${x.id}`}><td><b>{t('rebate')}</b><div className="pt-ls">{x.title}</div></td><td><b>{t('rebateAmt', { amount: f.wonOf(won(x.rebateBonus)) })}</b></td><td>{t('rebateCond')}</td></tr>
          ))}
          {rw.items.every((x) => x.referralRate == null && !x.rebateBonus) && (
            <tr><td colSpan={3} className="pt-ls">{t('noneSet')}</td></tr>
          )}
        </Tw>
      )}
      <Note kind="info"><b>{withCodes(f.srv(rw?.note, rw?.note ? t('noteSrv') : t('noteDefault')))}</b></Note>
      <div className="pt-dact"><Link className="pt-bo" href="/partner/services">{t('toServices')}</Link></div>
    <i hidden data-root-end="" /></>
  );
}

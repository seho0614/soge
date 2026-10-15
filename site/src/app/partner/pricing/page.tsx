import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { Bg, Empty, Note, Pgh, S2, Tw, won } from '@/components/partner/ui';

export const metadata: Metadata = { title: '단가 · 소개비' };

interface Row {
  categoryId: string; categoryName: string; gwanCode: string; formType: string | null; formLabel: string; range: string;
  state: 'NO_FORM' | 'NO_AXES' | 'EMPTY' | 'PROVISIONAL' | 'SET';
  baseFee: number | null; baseIsDefault: boolean; topFee: number | null; myFee: number | null; matrixCells: number; provisional: boolean;
}
interface Rewards {
  items: Array<{ id: string; title: string; categoryName: string | null; status: string; topFee: number | null; topFeeSet: boolean; referralRate: number | null; rebateBonus: number | null }>;
  rates: Array<{ grade: string; label: string; rate: number }>;
  note: string;
}
const GWAN: Record<string, string> = { MNY: '소개장터', MAL: '안심소개', BIZ: '소개창업', HLT: '소개몰' };
const ST: Record<Row['state'], [string, 'ok' | 'wait' | 'no' | 'off']> = {
  SET: ['입력됨', 'ok'], PROVISIONAL: ['입력됨 · 도입가', 'wait'], EMPTY: ['구간 비어 있음', 'wait'],
  NO_AXES: ['구간 미정 — 본사', 'no'], NO_FORM: ['폼 유형 미지정 — 입력 자체가 막힘', 'no'],
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
  const provisional = rows.some((r) => r.provisional);
  const maxS = rw?.items.reduce((m, x) => Math.max(m, Number(x.topFee ?? 0)), 0) ?? 0;

  return (
    <><Pgh title="단가 · 소개비" sub="단가 입력 방식은 카테고리가 정합니다." />
      {rows.length === 0 ? (
        <Empty>승인된 서비스가 없습니다. 서비스를 등록하고 검수를 통과하시면 여기에 단가가 나옵니다.</Empty>
      ) : (
        <Tw head={['카테고리', '단가 폼', '구간', '상태', '관', '기준가', '내 단가(S)']} numCols={[5, 6]}>
          {rows.map((r) => {
            const st = ST[r.state] ?? [r.state, 'off'];
            return (
              <tr key={r.categoryId}>
                <td><b>{r.categoryName}</b></td>
                <td>{r.formLabel}</td>
                <td>{r.range}{r.formType === 'MATRIX' && r.matrixCells ? <span className="pt-ls"> · {r.matrixCells}칸 입력</span> : null}</td>
                <td><Bg tone={st[1]}>{st[0]}</Bg></td>
                <td>{GWAN[r.gwanCode] ?? r.gwanCode}</td>
                <td className="num">{r.baseFee != null ? `${won(r.baseFee)}원` : '—'}</td>
                <td className="num"><b>{r.myFee != null ? `${won(r.myFee)}원` : '—'}</b>{r.topFee ? <div className="pt-ls">최고 확인비용</div> : null}</td>
              </tr>
            );
          })}
        </Tw>
      )}
      <Note kind="warn">
        <b>단가 폼은 카테고리가 정합니다. 폼 유형이 지정되지 않은 카테고리는 단가를 넣을 수 없습니다.</b>
        {provisional ? ' 지금 기준가는 도입가입니다 — 3주 실측 후 재산정하므로 이 값으로 수익을 계산하지 마십시오.' : ''}
      </Note>

      <S2>소개비 보상표</S2>
      {!rw || rw.items.length === 0 ? <Empty>보상표를 정한 서비스가 없습니다.</Empty> : (
        <Tw head={['항목', '금액', '비고']}>
          <tr><td><b>S</b></td><td><b>{won(maxS)}원</b></td><td>리드 확인비용(최고) — 등급별 {rw.rates.map((r) => `${r.label} ${Math.round(r.rate * 100)}%`).join(' · ')}</td></tr>
          {rw.items.filter((x) => x.referralRate != null).map((x) => (
            <tr key={`r-${x.id}`}><td><b>성사 소개비</b><div className="pt-ls">{x.title}</div></td><td><b>거래액의 {Math.round(Number(x.referralRate) * 1000) / 10}%</b></td><td>협의 구간 5~12%</td></tr>
          ))}
          {rw.items.filter((x) => x.rebateBonus).map((x) => (
            <tr key={`b-${x.id}`}><td><b>재소개 보너스</b><div className="pt-ls">{x.title}</div></td><td><b>건당 {won(x.rebateBonus)}원</b></td><td>3개월 내 재계약</td></tr>
          ))}
          {rw.items.every((x) => x.referralRate == null && !x.rebateBonus) && (
            <tr><td colSpan={3} className="pt-ls">성사 소개비 · 재소개 보너스를 정한 서비스가 없습니다 — 서비스 상세의 「서비스 수정」에서 정합니다.</td></tr>
          )}
        </Tw>
      )}
      <Note kind="info"><b>{rw?.note ?? '소개비는 당사자끼리 직접 주고받습니다.'}</b></Note>
      <div className="pt-dact"><Link className="pt-bo" href="/partner/services">내 서비스로</Link></div>
    <i hidden data-root-end="" /></>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { ymdKst } from '@/lib/format';
import { Bg, Empty, Note, Pgh, S2, Tile, Tw, won } from '@/components/partner/ui';
import { ReportForm } from './ReportForm';

export const metadata: Metadata = { title: '성과 관리' };

interface Perf {
  rows: Array<{ id: string; no: string; content: string; doneOn: string; amount: number | null; consumerState: string; consumerAt: string | null;
    rating: number | null; reportedAt: string; summary: string; consumerCanConfirm: boolean }>;
  open: Array<{ deliveryId: string; summary: string; categoryName: string | null; viewedAt: string }>;
  metrics: { received: number; viewed: number; avgViewMin: number | null; billed: number };
  note: string;
}
const mins = (m: number | null | undefined) => (m == null ? '—' : m < 60 ? `${m}분` : `${Math.round(m / 60)}시간`);

/**
 * SB-PTC-CTR-450 성과 관리 — v10.31 (W5 · 10/10 시안 기준 scPtnPerf)
 *   「거래 · 내용 · 이행 보고 · 보고 상태 · 소비자 확인」 표 → 안내 → 이행 보고 폼.
 *   계약 성사형은 파트너가 이행을 보고하고 **소비자가 확인해야 성사**입니다(서버 partner_fulfillment_reports).
 *   개발에만 있던 실적 4칸(받은 리드 · 열람률 · 평균 열람 · 이용료 확정)은 아래에 둡니다(유지).
 */
export default async function PerformancePage() {
  const p = await me();
  if (!p) redirect('/login');
  const d = await apiGet<Perf>('/partner/performance', 0).catch(() => null);
  if (!d) return <><Pgh title="성과 관리" /><Empty>파트너가 아닙니다.</Empty><i hidden data-root-end="" /></>;
  const m = d.metrics;
  const rate = m.received ? Math.round((m.viewed / m.received) * 1000) / 10 : null;

  return (
    <><Pgh title="성과 관리" sub="계약 성사형은 파트너가 이행을 보고하고 소비자가 확인해야 성사입니다." />
      {d.rows.length === 0 ? <Empty>아직 이행을 보고한 건이 없습니다. 일을 마치셨으면 아래에서 보고하십시오.</Empty> : (
        <Tw head={['거래', '내용', '이행 보고', '보고 상태', '소비자 확인']}>
          {d.rows.map((r) => (
            <tr key={r.id}>
              <td><b className="pt-code">{r.no}</b></td>
              <td>{r.content}<div className="pt-ls">{r.summary}{r.amount ? ` · ${won(r.amount)}원` : ''}</div></td>
              <td>{ymdKst(r.doneOn)}</td>
              <td><Bg tone="ok">이행 보고 완료</Bg></td>
              <td>{r.consumerState === 'CONFIRMED' ? <Bg tone="ok">확인 완료{r.rating ? ` · ★${r.rating}` : ''}</Bg>
                : r.consumerState === 'DISPUTED' ? <Bg tone="no">이의 있음</Bg>
                : <><Bg tone="wait">고객 확인 대기</Bg>{!r.consumerCanConfirm ? <div className="pt-ls">비회원 신청이라 확인 화면이 없습니다</div> : null}</>}</td>
            </tr>
          ))}
        </Tw>
      )}
      <Note kind="info"><b>{d.note}</b></Note>
      <Note kind="warn"><b>소비자 확인은 상담을 신청한 회원이 나의공간에서 합니다.</b> 확인 요청 알림이 갑니다 — 비회원 · 옛 신청은 확인 화면이 없어 「고객 확인 대기」로 남습니다.</Note>

      <S2>이행 보고</S2>
      <div className="pt-fset"><ReportForm open={d.open.map((o) => ({ deliveryId: o.deliveryId, summary: o.summary, categoryName: o.categoryName }))} /></div>

      <S2>실적 · 신뢰지표</S2>
      <div className="pt-tiles" data-ptn-perf>
        <Tile label="받은 리드" value={(m.received ?? 0).toLocaleString('ko-KR')} unit="건" href="/partner/leads" />
        <Tile label="열람률" value={rate ?? '—'} unit={rate != null ? '%' : undefined} sub="받은 리드 중 연 비율" href="/partner/trust" />
        <Tile label="평균 열람" value={mins(m.avgViewMin)} sub="받고 나서 열기까지" href="/partner/trust" />
        <Tile label="이용료 확정" value={(m.billed ?? 0).toLocaleString('ko-KR')} unit="건" sub="잔액에서 차감된 건" href="/partner/cash" />
      </div>
      <div className="pt-dact">
        <Link className="pt-bo" href="/partner/stats">실적 · 등급</Link>
        <Link className="pt-bo" href="/partner/trust">신뢰지표</Link>
        <Link className="pt-bo" href="/partner/services">내 서비스로</Link>
      </div>
    <i hidden data-root-end="" /></>
  );
}

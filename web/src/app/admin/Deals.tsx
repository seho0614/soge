import { useState } from 'react';
import { Pills } from '../../components/Pills';
import { SuccessStories } from './MarketOps';
import { useApi } from '../../lib/useApi';
import { ErrorView } from '../../components/ErrorView';
import { label } from '../../lib/codes';
import { won } from '../../lib/format';

interface Deal {
  id: string; status: string; agreedFee: number | null;
  attributedCode?: string | null; confirmMode: string | null;
  createdAt: string; confirmedAt: string | null;
  /* v10.31 — 서버가 붙여 주는 시안 칸 */
  title?: string | null; gwanName?: string | null; refCode?: string | null; introducerName?: string | null;
  dealAmount?: number | null; hasDispute?: boolean;
}

/**
 * SB-ADM-DEL-010 거래 모니터링
 *
 * ★ 조회 전용입니다. 관리자도 임의로 확정할 수 없습니다 (INV-4).
 *   확정은 양측 서명이나 7일 자동확정으로만 일어납니다.
 */
const ING = ['INQUIRY', 'NEGOTIATING', 'CONTRACTED', 'PAYMENT_REPORTED'];
const DONE = ['CONFIRMED', 'SETTLED'];

export function Deals({ onGo }: { onGo?: (tab: string) => void } = {}) {
  const { data, error, loading } = useApi<Deal[]>('/admin/deals');
  const [st, setSt] = useState<'all' | 'ing' | 'done' | 'dsp'>('all');
  if (error) return <ErrorView error={error} />;
  if (loading || !data) return <p className="muted">불러오는 중…</p>;

  const pick = (k: string) => data.filter((d) => k === 'all' || (k === 'ing' ? ING.includes(d.status) : k === 'done' ? DONE.includes(d.status) : (d.status === 'DISPUTED' || !!d.hasDispute)));
  const list = pick(st);

  /* v10.31 — 시안(scAdmDel) 표: 거래번호 · 소개 건 · 관 · 소개코드 · 소개자 · 거래금액 · 소개비 · 상태 · 일자.
   * 거래금액은 계약서에 적힌 값(없으면 「미확정」). 분쟁 탭은 열린 분쟁이 있는 거래(처리는 「분쟁」 탭) */
  return (
    <>
      <Pills label="거래 상태" value={st} onChange={setSt}
             items={[['all', '전체', data.length], ['ing', '진행 중', pick('ing').length], ['done', '성사', pick('done').length], ['dsp', '분쟁', pick('dsp').length]]} />
      <div className="ad-tw"><table className="tbl" data-deals>
        <thead>
          <tr><th>거래번호</th><th>소개 건</th><th>관</th><th>소개코드</th><th>소개자</th><th className="num-cell">거래금액</th><th className="num-cell">소개비</th><th>상태</th><th>일자</th></tr>
        </thead>
        <tbody>
          {list.length === 0 && <tr><td colSpan={9} className="muted">거래가 없습니다.</td></tr>}
          {list.map((d) => (
            <tr key={d.id} className={d.hasDispute ? 'bad' : undefined}>
              <td className="mono">D-{d.id.slice(0, 6).toUpperCase()}</td>
              <td><b>{d.title ?? '—'}</b></td>
              <td>{d.gwanName ?? '—'}</td>
              <td className="mono">{d.refCode ?? d.attributedCode ?? <span className="dim">없음</span>}</td>
              <td>{d.introducerName ?? <span className="dim">—</span>}</td>
              <td className="num-cell">{d.dealAmount != null ? won(d.dealAmount) : <span className="dim">미확정</span>}</td>
              <td className="num-cell money-cell">{d.agreedFee != null ? won(d.agreedFee) : <span className="dim">미확정</span>}</td>
              <td><span className={`ad-chip ${DONE.includes(d.status) ? 'ok' : d.status === 'DISPUTED' || d.hasDispute ? 'no' : d.status === 'CANCELLED' ? '' : 'warn'}`}>
                {d.hasDispute && d.status !== 'DISPUTED' ? '분쟁' : label('deal.status', d.status)}</span>
                {d.confirmMode && <span className="ad-ls">확정 {d.confirmMode === 'AUTO' ? '7일 자동' : '양측'}</span>}</td>
              <td>{new Date(d.createdAt).toLocaleDateString('ko-KR')}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {st === 'dsp' && onGo && <div className="ad-dact"><button className="btn-ok" onClick={() => onGo('disputes')}>분쟁 처리로</button></div>}
      <div className="ad-nt info">
        <b>플랫폼은 거래 당사자가 아닙니다.</b> 여기서 하는 일은 감독과 분쟁 개입이지 거래 개입이 아닙니다 —
        관리자가 임의로 성사를 확정할 수 없고, 확정은 양측 서명 또는 7일 자동확정으로만 일어납니다 (INV-4).
      </div>
      {st === 'done' && <>
        <h2 className="ad-s2">베스트매칭 · 성공현황 사례 <small className="dim">성사 확정 거래 중 두 당사자가 공개에 동의한 것만</small></h2>
        <SuccessStories deals={data} />
      </>}
    </>
  );
}

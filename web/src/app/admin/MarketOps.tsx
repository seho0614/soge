import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';
import { missing } from './PartnerCash';
import { won } from '../../lib/format';

/**
 * v10.31 — W2(관 화면 · 성공현황 · 베스트매칭 · 피해 사례)의 운영 쪽 화면.
 * API 는 W2 묶음의 MarketAdminController 이름 그대로입니다:
 *   GET /admin/success-stories · POST /admin/success-stories{dealId, headline, summary?, reasons?, sortRank?}
 *   PATCH /admin/success-stories/{id}{headline?, summary?, reasons?, status DRAFT|PUBLISHED|HIDDEN, sortRank?}
 *   GET /admin/safety/cases · POST /admin/safety/cases/{no}/hide{reason}
 * v10.31 합침 — W2 API 와 연결됨. 서버가 404 를 주면(서버 판이 이 화면보다 옛 판) 안내만 보입니다.
 */
function Pending({ what, path }: { what: string; path: string }) {
  return <div className="ad-nt info" data-merge-pending={path}><b>서버에 이 기능이 없습니다 — {what}.</b> 이 화면은 <span className="mono">{path}</span> 를 씁니다. 서버(API)가 운영 화면과 같은 판(v10.31 이상)인지 확인하십시오.</div>;
}
const maskMail = (e?: string | null) => (e ? e.replace(/^(.{1,3})[^@]*(@.*)$/, '$1****$2') : '—');

interface Story {
  id: string; storyNo: number; dealId: string; gwanCode: string; headline: string; summary: string | null; reasons: string[] | null;
  sellerConsentAt: string | null; buyerConsentAt: string | null; status: string; sortRank: number; createdAt: string; publishedAt: string | null;
  title: string | null; fee: number | null; tradeAmount: number | null;
}
const ST: Record<string, [string, string]> = { DRAFT: ['동의 대기', 'wait'], PUBLISHED: ['공개', 'ok'], HIDDEN: ['숨김', ''] };

/** 베스트매칭 · 성공현황 사례 — 성사 확정 거래에서 운영이 고르고, 두 당사자가 동의해야 공개(DB) */
export function SuccessStories({ deals }: { deals: Array<{ id: string; title?: string | null; status: string }> }) {
  const l = useApi<Story[]>('/admin/success-stories');
  const a = useAct();
  const [dealId, setDealId] = useState('');
  const [head, setHead] = useState('');
  const [sum, setSum] = useState('');
  if (l.error && missing(l.error)) return <Pending what="베스트매칭 · 성공현황 사례" path="/admin/success-stories" />;
  if (l.error) return <ErrorView error={l.error} onRetry={l.reload} />;
  const rows = l.data ?? [];
  const used = new Set(rows.map((s) => s.dealId));
  const cands = deals.filter((d) => ['CONFIRMED', 'SETTLED'].includes(d.status) && !used.has(d.id));
  const set = (s: Story, status: string) => a.run(s.id, () => api(`/admin/success-stories/${s.id}`, { method: 'PATCH', body: JSON.stringify({ status }) }), l.reload,
    status === 'PUBLISHED' ? '공개했습니다.' : status === 'HIDDEN' ? '숨겼습니다.' : '처리했습니다.');
  return (
    <>
      <Flash msg={a.msg} err={a.err} />
      <div className="ad-tw"><table className="tbl" data-success-stories>
        <thead><tr><th>번호</th><th>사례</th><th className="num-cell">거래금액 · 소개비</th><th>당사자 동의</th><th>상태</th><th /></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={6} className="muted">올린 사례가 없습니다.</td></tr>}
          {rows.map((s) => { const t = ST[s.status] ?? [s.status, '']; const both = !!(s.sellerConsentAt && s.buyerConsentAt); return (
            <tr key={s.id}>
              <td className="mono">#{s.storyNo}<span className="ad-ls">{s.gwanCode} · 순서 {s.sortRank}</span></td>
              <td><b>{s.headline}</b><span className="ad-ls">{s.title ?? '—'}{s.summary ? ` · ${s.summary}` : ''}</span></td>
              <td className="num-cell">{s.tradeAmount != null ? won(s.tradeAmount) : '—'}<span className="ad-ls">{s.fee != null ? won(s.fee) : '—'}</span></td>
              <td>매도 {s.sellerConsentAt ? '✓' : '—'} · 매수 {s.buyerConsentAt ? '✓' : '—'}</td>
              <td><span className={`ad-bg ${t[1]}`}>{t[0]}</span>{s.publishedAt && <span className="ad-ls">{ymdhm(s.publishedAt)}</span>}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {s.status !== 'PUBLISHED' && <button className="btn-ok btn-sm" disabled={!both || a.busy === s.id} title={both ? undefined : '두 당사자가 모두 동의해야 공개됩니다'} onClick={() => set(s, 'PUBLISHED')}>공개</button>}
                {s.status === 'PUBLISHED' && <button className="btn-plain btn-sm" disabled={a.busy === s.id} onClick={() => set(s, 'HIDDEN')}>숨기기</button>}
              </td>
            </tr>); })}
        </tbody>
      </table></div>
      <div className="ad-form" data-story-new>
        <select value={dealId} onChange={(e) => setDealId(e.target.value)} aria-label="성사 확정 거래">
          <option value="">성사 확정 거래 고르기 ({cands.length})</option>
          {cands.map((d) => <option key={d.id} value={d.id}>D-{d.id.slice(0, 6).toUpperCase()} · {d.title ?? '거래'}</option>)}
        </select>
        <input value={head} onChange={(e) => setHead(e.target.value)} placeholder="한 줄 제목(5~80자)" aria-label="사례 제목" />
        <input value={sum} onChange={(e) => setSum(e.target.value)} placeholder="요약(선택)" aria-label="사례 요약" />
        <button className="btn-ok" disabled={!dealId || head.trim().length < 5 || a.busy === 'new'}
                onClick={() => a.run('new', () => api('/admin/success-stories', { method: 'POST', body: JSON.stringify({ dealId, headline: head, summary: sum || undefined }) }),
                  () => { setDealId(''); setHead(''); setSum(''); l.reload(); })}>사례 초안 · 동의 요청</button>
      </div>
      <p className="dim" style={{ fontSize: 12 }}>금액 · 기간 · 과정은 거래 기록 그대로입니다. 매도자 · 매수자 두 분이 공개에 동의한 사례만 공개할 수 있습니다(DB 가 막음).</p>
    </>
  );
}

interface Case { no: number; type: string; title: string; status: string; hiddenReason: string | null; views: number; createdAt: string; authorEmail: string | null }
const TYPE: Record<string, string> = { CONTRACT: '계약', PAYMENT: '대금', GOODS: '물품', PRIVACY: '개인정보', ETC: '기타' };

/** 안심거래 › 피해 사례 게시판 — 운영 숨기기(사유 필수) */
export function SafetyCases() {
  const l = useApi<Case[]>('/admin/safety/cases');
  const a = useAct();
  const [why, setWhy] = useState<Record<number, string>>({});
  if (l.error && missing(l.error)) return <Pending what="피해 사례 게시판 운영" path="/admin/safety/cases" />;
  if (l.error) return <ErrorView error={l.error} onRetry={l.reload} />;
  const rows = l.data ?? [];
  return (
    <>
      <Flash msg={a.msg} err={a.err} />
      <div className="ad-tw"><table className="tbl" data-safety-cases>
        <thead><tr><th>번호</th><th>유형</th><th>제목</th><th>작성자</th><th className="num-cell">조회</th><th>상태</th><th /></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={7} className="muted">올라온 피해 사례가 없습니다.</td></tr>}
          {rows.map((c) => (
            <tr key={c.no}>
              <td className="mono">{c.no}</td><td>{TYPE[c.type] ?? c.type}</td>
              <td><b>{c.title}</b><span className="ad-ls">{ymdhm(c.createdAt)}</span></td>
              <td className="mono">{maskMail(c.authorEmail)}</td><td className="num-cell">{c.views}</td>
              <td>{c.status === 'PUBLISHED' ? <span className="ad-bg ok">공개</span> : <><span className="ad-bg">숨김</span>{c.hiddenReason && <span className="ad-ls">{c.hiddenReason}</span>}</>}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{c.status === 'PUBLISHED' && <>
                <input style={{ width: 130 }} value={why[c.no] ?? ''} onChange={(e) => setWhy((x) => ({ ...x, [c.no]: e.target.value }))} placeholder="숨기는 사유" aria-label="숨기는 사유" />{' '}
                <button className="btn-no btn-sm" disabled={(why[c.no] ?? '').trim().length < 2 || a.busy === String(c.no)}
                        onClick={() => a.run(String(c.no), () => api(`/admin/safety/cases/${c.no}/hide`, { method: 'POST', body: JSON.stringify({ reason: why[c.no] }) }), l.reload, '숨겼습니다.')}>숨기기</button></>}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </>
  );
}

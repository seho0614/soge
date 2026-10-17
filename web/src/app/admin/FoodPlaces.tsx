import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';

/**
 * v10.47 (D100 · docs/98) — 소개광장 › 우리동네 맛집 가게 (SB-ADM-CMU-010 안의 한 구역)
 *
 * 글 검수(첫 글 · 신고)는 위 검수 큐가 그대로 합니다 — 맛집 글도 소개광장 글이라 같은 큐에 옵니다(게시판 FOOD).
 * 여기서는 **가게**를 숨깁니다(폐업 · 잘못 고른 가게 · 분쟁). 숨기면 지도 · 목록 · 가게 화면에서 빠지고 글은 남습니다. 사유 필수.
 * 지도 사용이 꺼져 있고 가게가 하나도 없으면 아무것도 그리지 않습니다(검수 화면은 전과 같음).
 */

interface Place { id: string; name: string; category: string | null; address: string | null; sido: string | null; sigungu: string | null; dong: string | null;
  isHidden: boolean; hiddenReason: string | null; placeUrl: string | null; createdAt: string; postCount: number; pendingCount: number }

export function FoodPlaces() {
  const [q, setQ] = useState('');
  const [kw, setKw] = useState('');
  const l = useApi<{ items: Place[] }>(`/admin/community/food/places${kw ? `?q=${encodeURIComponent(kw)}` : ''}`, [kw]);
  const a = useAct();
  const [why, setWhy] = useState<Record<string, string>>({});
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => { api<{ enabled: boolean }>('/site-settings/map').then((c) => setOn(!!c.enabled)).catch(() => setOn(false)); }, []);

  if (l.error) return <ErrorView error={l.error} onRetry={l.reload} />;
  const rows = l.data?.items ?? [];
  if (on === null || (!on && rows.length === 0 && !kw)) return null;

  const hide = (p: Place, hidden: boolean) => a.run(p.id, () => api(`/admin/community/food/places/${p.id}`, {
    method: 'PATCH', body: JSON.stringify(hidden ? { hidden: true, reason: (why[p.id] ?? '').trim() } : { hidden: false }),
  }), l.reload, hidden ? '숨겼습니다.' : '다시 보이게 했습니다.');

  return (
    <>
      <h3 className="sec">우리동네 맛집 가게 <small className="dim">v10.47 · 글 검수는 위 큐 · 여기서는 가게 숨기기</small></h3>
      <Flash msg={a.msg} err={a.err} />
      <form className="ip-row" onSubmit={(e) => { e.preventDefault(); setKw(q.trim()); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="가게 이름 · 주소" aria-label="가게 찾기" />
        <button className="btn-sm" type="submit">찾기</button>
      </form>
      <div className="ad-tw"><table className="tbl" data-food-places>
        <thead><tr><th>가게</th><th>동네</th><th className="num-cell">공개 글</th><th className="num-cell">검수 중</th><th>상태</th><th /></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={6} className="muted">등록된 가게가 없습니다.</td></tr>}
          {rows.map((p) => (
            <tr key={p.id}>
              <td><b>{p.name}</b><span className="ad-ls">{p.address ?? '—'}</span>
                {p.placeUrl && <span className="ad-ls"><a href={p.placeUrl} target="_blank" rel="noopener noreferrer">카카오맵 ↗</a></span>}</td>
              <td>{[p.sigungu, p.dong].filter(Boolean).join(' ') || '—'}</td>
              <td className="num-cell">{p.postCount}</td><td className="num-cell">{p.pendingCount}</td>
              <td>{p.isHidden ? <><span className="ad-bg">숨김</span>{p.hiddenReason && <span className="ad-ls">{p.hiddenReason}</span>}</> : <span className="ad-bg ok">공개</span>}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{p.isHidden
                ? <button className="btn-sm" disabled={a.busy === p.id} onClick={() => void hide(p, false)}>다시 보이기</button>
                : <><input style={{ width: 130 }} value={why[p.id] ?? ''} onChange={(e) => setWhy((x) => ({ ...x, [p.id]: e.target.value }))} placeholder="숨기는 사유" aria-label="숨기는 사유" />{' '}
                   <button className="btn-no btn-sm" disabled={(why[p.id] ?? '').trim().length < 2 || a.busy === p.id} onClick={() => void hide(p, true)}>숨기기</button></>}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </>
  );
}

import { useState } from 'react';
import { api } from '../../../lib/api';
import { useApi } from '../../../lib/useApi';
import { useAct } from '../../../lib/act';
import { ErrorView } from '../../../components/ErrorView';
import { Flash } from '../../../components/Flash';
import type { Ing } from './shared';

export function Ingredients() {
  const list = useApi<Ing[]>('/admin/health/ingredients');
  const a = useAct();
  const [nw, setNw] = useState({ code: '', name: '', aliases: '', parent: '', isGroup: false });
  const groups = (list.data ?? []).filter((g) => g.isGroup);
  const patch = (g: Ing, body: Record<string, unknown>, ok: string) => void a.run(g.code, () => api(`/admin/health/ingredients/${g.code}`, { method: 'PATCH', body: JSON.stringify(body) }), list.reload, ok);
  const add = () => void a.run('add', () => api('/admin/health/ingredients', { method: 'POST', body: JSON.stringify({
    code: nw.code.trim().toUpperCase(), name: nw.name.trim(), aliases: nw.aliases.split(',').map((x) => x.trim()).filter(Boolean), parent: nw.parent || undefined, isGroup: nw.isGroup }) }),
    () => { setNw({ code: '', name: '', aliases: '', parent: '', isGroup: false }); list.reload(); }, '성분을 더했습니다.');
  return (
    <div data-screen="SB-ADM-HPR-020">
      <Flash msg={a.msg} err={a.err} />
      <h3 className="ad-s2">성분 · 고민 <em>{(list.data ?? []).filter((g) => !g.excipient).length}</em> <span className="ad-sid">SB-ADM-HPR-020</span></h3>
      <div className="word-add">
        <input value={nw.code} onChange={(e) => setNw({ ...nw, code: e.target.value })} placeholder="코드(영문)" aria-label="성분 코드" />
        <input value={nw.name} onChange={(e) => setNw({ ...nw, name: e.target.value })} placeholder="이름" aria-label="성분 이름" />
        <input value={nw.aliases} onChange={(e) => setNw({ ...nw, aliases: e.target.value })} placeholder="다른 이름(쉼표로)" aria-label="다른 이름" />
        <select value={nw.parent} onChange={(e) => setNw({ ...nw, parent: e.target.value })} aria-label="성분군"><option value="">성분군 없음</option>{groups.map((g) => <option key={g.code} value={g.code}>{g.name}</option>)}</select>
        <label className="muted"><input type="checkbox" checked={nw.isGroup} onChange={(e) => setNw({ ...nw, isGroup: e.target.checked })} /> 성분군(묶음)</label>
        <button className="btn-sm btn-ok" disabled={a.busy === 'add' || !nw.code.trim() || !nw.name.trim()} onClick={add}>+ 성분 더하기</button>
      </div>
      {!!list.error && <ErrorView error={list.error} onRetry={list.reload} />}
      <div className="ad-tw"><table className="tbl" data-ingredients>
        <thead><tr><th>코드</th><th>이름</th><th>다른 이름 (검색에 쓰임)</th><th>성분군</th><th>많이 찾는 성분</th><th className="num-cell">판매 중 상품</th></tr></thead>
        <tbody>
          {(list.data ?? []).filter((g) => !g.excipient).map((g) => (
            <tr key={g.code} data-ingredient={g.code}>
              <td className="mono">{g.code}</td><td><b>{g.name}</b></td><td className="muted">{(g.aliases ?? []).join(' · ') || '—'}</td>
              <td>{g.isGroup ? '군(묶음)' : g.parent ? `▸ ${groups.find((x) => x.code === g.parent)?.name ?? g.parent}` : '—'}</td>
              <td>{g.isGroup ? '—' : <label><input type="checkbox" checked={g.featured} disabled={a.busy === g.code}
                onChange={() => patch(g, { featured: !g.featured }, g.featured ? '「많이 찾는 성분」에서 뺐습니다.' : '「많이 찾는 성분」에 넣었습니다.')} /> {g.featured ? '켬' : ''}</label>}</td>
              <td className="num-cell">{g.onSale}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <div className="ad-nt info"><b>성분 트리는 2단까지입니다(군 → 성분).</b> 「많이 찾는 성분」을 켠 성분이 사용자 웹 「성분별」의 첫 구역에 나옵니다. 고민 이름은 광고 문구로 읽히므로 금지 표현 검사를 거칩니다.</div>
    </div>
  );
}

import { useApi } from '../../../lib/useApi';
import { ErrorView } from '../../../components/ErrorView';
import type { Cat } from './shared';

export function Categories() {
  const list = useApi<Cat[]>('/admin/health/sale-categories');
  const STATE: Record<string, string> = { OPEN: '열림', LOCKED: '잠김', NOT_SOLD: '팔지 않음' };
  return (
    <div data-screen="SB-ADM-HPR-030">
      <h3 className="ad-s2">갈래 · 판매 범위 <span className="ad-sid">SB-ADM-HPR-030</span></h3>
      {!!list.error && <ErrorView error={list.error} onRetry={list.reload} />}
      <div className="ad-tw"><table className="tbl" data-sale-categories>
        <thead><tr><th>갈래</th><th>판매 범위</th><th>안내(손님에게 보임)</th><th className="num-cell">판매 중 / 전체</th><th>고시 묶음</th><th className="num-cell">수수료율</th></tr></thead>
        <tbody>
          {(list.data ?? []).map((c) => (
            <tr key={c.code} data-category={c.code}>
              <td><b>{c.name}</b> <span className="mono">{c.code}</span></td>
              <td><span className={`ad-bg ${c.state === 'OPEN' ? 'ok' : c.state === 'LOCKED' ? '' : 'no'}`}>{STATE[c.state] ?? c.state}</span></td>
              <td className="muted">{c.note ?? '—'}</td>
              <td className="num-cell">{c.onSale} / {c.total}</td>
              <td>{c.noticeGroup ?? <span className="dim">없음</span>}</td>
              <td className="num-cell">{c.commissionRate != null ? `${Number(c.commissionRate)}%` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <div className="ad-nt warn"><b>판매 범위는 이 화면에서 바꾸지 않습니다.</b> 잠긴 갈래(건강기능식품)는 영업신고 · 표시 · 광고 심의 체계를 갖춘 뒤 DB 마이그레이션으로 엽니다(실수로 여는 일을 막음). 여기서는 읽기만 합니다.</div>
    </div>
  );
}

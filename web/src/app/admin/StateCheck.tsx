import { useApi } from '../../lib/useApi';

/**
 * v10.212 (docs/340) — 운영 상태 한눈에(첫 화면 · 보기 ADMIN · SUPER · 읽기만)
 *
 *   운영 적용 뒤 화면 확인(절차서 4-1)을 이 표 하나로 — 줄을 누르면 그 화면.
 *   ✓ 할 일 없음 · ○ 할 일 남음(오픈 전에는 정상) · ⚠ 바로 볼 것 · – 값만.
 */
interface Row { key: string; label: string; state: 'ok' | 'todo' | 'warn' | 'info'; now: string; go: string }
const MARK: Record<Row['state'], string> = { ok: '✓', todo: '○', warn: '⚠', info: '–' };

export function StateCheck({ onGo, canGo }: { onGo: (tab: string) => void; canGo: (tab: string) => boolean }) {
  const q = useApi<Row[]>('/admin/launch-watch/state', []);
  const rows = q.data;
  if (!rows) return null;
  const warn = rows.filter((r) => r.state === 'warn').length;
  return (
    <div className={`card${warn ? ' warn' : ''}`} data-state-check data-state-warn={warn}>
      <h3 className="sec">운영 상태 한눈에 <small className="dim">운영 적용 뒤 화면 확인을 이 표로 · ✓ 할 일 없음 · ○ 할 일 남음 · ⚠ 바로 볼 것</small></h3>
      <table className="tbl">
        <thead><tr><th>항목</th><th></th><th>지금</th><th></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} data-state-row={r.key} data-state={r.state}>
              <td>{r.label}</td>
              <td className={r.state === 'warn' ? 'warn-text' : r.state === 'todo' ? '' : 'muted'}>{MARK[r.state]}</td>
              <td>{r.now}</td>
              <td>{canGo(r.go) && <button className="linkbtn" onClick={() => onGo(r.go)} data-state-go={r.go}>보러 가기</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

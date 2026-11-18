import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';

type Row = Record<string, unknown> & { version: number; createdAt: string; by: string | null };

/**
 * 지난 판 보기 · 되돌리기 (v10.351 · docs/485) — 관 관리 › 「업무 안내」 · 「이용 흐름」이 함께 씀
 *
 * 대표 11/18 「다음개발」 → ③. 판마다 때 · 고친 사람 · 바로 아래(옛) 판과 다른 줄(− 빠짐 · + 더함).
 * 「이 판으로 되돌리기」(SUPER)는 그 옛 글을 새 판으로 쌓습니다(지난 판은 그대로 남음 · 지우기 없음).
 */
export function VersionHistory({ path, current, canRestore, lines, restore, onDone }: {
  path: string; current: number; canRestore: boolean;
  lines: (r: Row) => string[];
  restore: (r: Row) => Promise<unknown>;
  onDone: () => void;
}) {
  const q = useApi<{ rows: Row[] }>(path);
  const a = useAct();
  if (q.error) return <p className="warn-text">지난 판을 읽지 못했습니다.</p>;
  if (!q.data) return <p className="muted">불러오는 중…</p>;
  const rows = q.data.rows;
  const back = (r: Row) => {
    if (!confirm(`${r.version}판 글로 되돌립니다 — 그 글이 새 판(${current + 1}판)으로 쌓이고, 지금 판은 지난 판으로 남습니다.`)) return;
    void a.run(`r${r.version}`, () => restore(r), () => { q.reload(); onDone(); });
  };
  return (
    <div className="card" data-version-history={rows.length}>
      <Flash msg={a.msg} err={a.err} />
      {rows.map((r, i) => {
        const now = lines(r).filter(Boolean);
        const prev = rows[i + 1] ? lines(rows[i + 1]!).filter(Boolean) : null;
        const removed = prev ? prev.filter((x) => !now.includes(x)) : [];
        const added = prev ? now.filter((x) => !prev.includes(x)) : now;
        return (
          <div key={r.version} data-version-row={r.version} style={{ borderTop: i ? '1px solid var(--line, #ddd)' : undefined, padding: '6px 0' }}>
            <b>{r.version}판</b>{r.version === current && <span className="badge"> 지금</span>} <small className="dim">{ymdhm(r.createdAt)}{r.by ? ` · ${r.by}` : ' · 처음 넣은 글'}</small>
            {canRestore && r.version !== current && <> <button className="btn-sm" disabled={a.busy === `r${r.version}`} onClick={() => back(r)} data-version-restore={r.version}>이 판으로 되돌리기</button></>}
            {prev && !removed.length && !added.length && <div className="dim">바뀐 줄 없음</div>}
            {removed.map((x, k) => <div key={`-${k}`} className="warn-text" data-version-del="">− {x}</div>)}
            {added.map((x, k) => <div key={`+${k}`} data-version-add="">{prev ? '+ ' : ''}{x}</div>)}
          </div>
        );
      })}
    </div>
  );
}

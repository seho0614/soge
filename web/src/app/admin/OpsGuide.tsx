import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';

interface Step { t: string; go?: string }
interface Guide { code: string; version: number; title: string; who: string; steps: Step[]; note: string | null; updatedAt: string; by: string | null; versions: number }
interface Data { rows: Guide[]; canEdit: boolean }

/**
 * SB-ADM-SIT-110 업무 안내 (v10.339 · D229 · docs/472)
 *
 * 대표 11/17 「업무별 워크 플로우 작성」 → 흐름표 → 「다음개발」 ④. 운영진 업무마다 순서 · 「이 화면」 단추 · 누가 · 알아 둘 것.
 * 고치기는 SUPER — 저장하면 새 판(옛 판은 남음 · 지우기 없음). 단계의 「이 화면」은 운영 화면 탭 이름(예 inquiries · mainops/gwan).
 */
export function OpsGuide({ onGo, canGo }: { onGo: (tab: string) => void; canGo: (tab: string) => boolean }) {
  const q = useApi<Data>('/admin/ops-guides');
  const a = useAct();
  const [open, setOpen] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ code: string; title: string; who: string; steps: string; note: string } | null>(null);
  if (q.error) return <ErrorView error={q.error} onRetry={q.reload} />;
  if (!q.data) return <p className="muted">불러오는 중…</p>;
  const { rows, canEdit } = q.data;

  const toText = (s: Step[]) => s.map((x) => (x.go ? `${x.t} | ${x.go}` : x.t)).join('\n');
  const save = () => {
    if (!edit) return;
    const steps = edit.steps.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const i = l.lastIndexOf(' | ');
      return i > 0 ? { t: l.slice(0, i).trim(), go: l.slice(i + 3).trim() } : { t: l };
    });
    void a.run('save', () => api(`/admin/ops-guides/${edit.code}`, { method: 'POST', body: JSON.stringify({ title: edit.title, who: edit.who, steps, note: edit.note }) }),
      () => { setEdit(null); q.reload(); });
  };

  return (
    <section data-ops-guide={rows.length}>
      <Flash msg={a.msg} err={a.err} />
      <p className="muted">업무 {rows.length}가지 · 단계 번호는 실제 순서입니다. 「이 화면」을 누르면 그 탭으로 갑니다(권한이 없는 화면은 단추가 흐립니다).</p>
      {rows.map((g) => (
        <details key={g.code} className="card" open={open === g.code} data-ops-guide-row={g.code}
          onToggle={(e) => { if (e.currentTarget.open) setOpen(g.code); else if (open === g.code) setOpen(null); }}>
          <summary><b>{g.title}</b> <span className="badge">{g.who}</span> <small className="dim">{g.version}판</small></summary>
          <ol>
            {g.steps.map((s, i) => (
              <li key={i} data-ops-guide-step={i + 1}>
                {s.t}{' '}
                {s.go && <button className="btn-sm btn-plain" disabled={!canGo(s.go)} onClick={() => onGo(s.go!)} data-ops-guide-go={s.go}>이 화면</button>}
              </li>
            ))}
          </ol>
          {g.note && <p className="ad-nt info">{g.note}</p>}
          <p className="muted">{ymdhm(g.updatedAt)}{g.by ? ` · ${g.by}` : ''}{g.versions > 1 ? ` · 판 ${g.versions}개` : ''}
            {canEdit && <> · <button className="btn-sm" onClick={() => setEdit({ code: g.code, title: g.title, who: g.who, steps: toText(g.steps), note: g.note ?? '' })} data-ops-guide-edit={g.code}>고치기</button></>}
          </p>
          {edit?.code === g.code && (
            <div className="card" data-ops-guide-form={g.code}>
              <p><label>업무 이름 <input name="og-title" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} maxLength={60} /></label>{' '}
                <label>누가 <input name="og-who" value={edit.who} onChange={(e) => setEdit({ ...edit, who: e.target.value })} maxLength={40} /></label></p>
              <p><textarea name="og-steps" value={edit.steps} onChange={(e) => setEdit({ ...edit, steps: e.target.value })} rows={8} style={{ width: '100%' }} /></p>
              <p className="muted">한 줄 = 한 단계(15개까지). 끝에 「 | 탭이름」을 붙이면 「이 화면」 단추가 생깁니다(예: … | inquiries).</p>
              <p><textarea name="og-note" value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} rows={2} maxLength={500} placeholder="알아 둘 것(선택)" style={{ width: '100%' }} /></p>
              <p><button className="btn-ok" disabled={a.busy === 'save'} onClick={save} data-ops-guide-save="">새 판으로 저장</button>{' '}
                <button className="btn-plain" onClick={() => setEdit(null)}>취소</button></p>
            </div>
          )}
        </details>
      ))}
    </section>
  );
}

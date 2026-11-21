import { useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, n } from '../../lib/act';
import { Flash } from '../../components/Flash';

/* ---------------------------------------------------------------------
 * v10.585 (docs/727) 14차 운영 ① DB 복원 반자동 리허설 — 관 관리 › 「업무 안내」 › DB 복원 시험 기록 아래(SUPER 만)
 *   운영 서버에서 deploy/aws/restore-drill.sh --run 이 끝에 찍은 JSON 을 붙여 넣으면 복원 시험 기록(D238)에 「스크립트」로 쌓임.
 *   행 수 맞음은 서버가 다시 셈 · 리허설(compare) 결과는 받지 않음.
 * ------------------------------------------------------------------- */

interface TableRow { name: string; src: number; drill: number; ok?: boolean }
interface ScriptRow { id: string; drillDate: string; snapshot: string; minutes: number; rowsMatch: boolean; ok: boolean; note: string | null;
  detail: { tool?: string; mode?: string; tolPct?: number; tables?: TableRow[] } | null; createdAt: string }
interface View { rows: ScriptRow[]; tolPct: number; canEdit: boolean; note: string }

export function Ops2DrillPaste() {
  if (!tokenRoles().includes('SUPER')) return null;   // 주소가 SUPER 만 — 다른 역할은 부르지 않음(403 을 남기지 않게)
  return <DrillPasteInner />;
}

function DrillPasteInner() {
  const q = useApi<View>('/admin/ops2/restore-drills/script');
  const a = useAct();
  const [txt, setTxt] = useState('');
  const [parseErr, setParseErr] = useState<string | null>(null);
  if (q.error || !q.data) return null;
  const d = q.data;
  const save = () => {
    let body: unknown;
    try {
      const s = txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1);   // 앞뒤 안내 글이 같이 복사돼도 JSON 만
      body = JSON.parse(s);
    } catch { setParseErr('JSON 을 읽지 못했습니다 — 「붙여 넣을 결과」 사이의 {…} 를 그대로 붙여 넣으십시오.'); return; }
    setParseErr(null);
    void a.run('save', () => api('/admin/ops2/restore-drills/result', { method: 'POST', body: JSON.stringify(body) }), () => { setTxt(''); q.reload(); });
  };
  return (
    <div className="card" data-ops2-drill={d.rows.length}>
      <Flash msg={a.msg} err={parseErr ?? a.err} />
      <b>스크립트 결과 붙여 넣기</b> <small className="dim">행 수 차이 한도 {d.tolPct}퍼센트(또는 100줄) · 복원이 운영보다 많으면 다름</small>
      <p className="muted">{d.note}</p>
      {d.canEdit && (
        <p data-ops2-drill-form="">
          <textarea name="ops2-drill-json" value={txt} onChange={(e) => setTxt(e.target.value)} rows={5} style={{ width: '100%', fontSize: 12 }}
            placeholder='{"tool":"restore-drill.sh v10.585","mode":"aws","drillDate":"2026-11-21","snapshot":"rds:…","minutes":18,"rowsMatch":true,"ok":true,"tables":[…]}' />
          <button className="btn-sm btn-ok" disabled={a.busy === 'save' || txt.trim().length < 20} onClick={save} data-ops2-drill-save="">적기</button>
        </p>
      )}
      {d.rows.map((r) => (
        <details key={r.id} data-ops2-drill-row={r.ok ? 'ok' : 'bad'}>
          <summary>{r.drillDate} · {r.snapshot} · {r.minutes}분 · 행 수 {r.rowsMatch ? '맞음' : <b className="warn-text">다름</b>} · {r.ok ? '이상 없음' : <b className="warn-text">이상 있음</b>}
            {' '}<small className="dim">{r.detail?.mode ?? ''} {r.detail?.tool ?? ''}</small></summary>
          {r.note && <p className="muted">{r.note}</p>}
          <table className="tbl"><thead><tr><th>표</th><th>운영</th><th>복원</th><th>차이</th><th></th></tr></thead><tbody>
            {(r.detail?.tables ?? []).map((t) => (
              <tr key={t.name}><td className="mono">{t.name}</td><td className="num-cell">{n(t.src)}</td><td className="num-cell">{n(t.drill)}</td>
                <td className="num-cell">{n(t.src - t.drill)}</td><td>{t.ok === false ? <b className="warn-text">다름</b> : '맞음'}</td></tr>
            ))}
          </tbody></table>
        </details>
      ))}
    </div>
  );
}

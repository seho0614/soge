import { Fragment, useState } from 'react';
import { useApi } from '../../lib/useApi';
import { api } from '../../lib/api';
import { ErrorView } from '../../components/ErrorView';

interface Row {
  id: string; state: string; targetType: string; targetId: string;
  reasonCode: string; reasonLabel?: string; severity?: string;
  detail?: string; createdAt: string; sameTarget: number;
}

const TT: Record<string, string> = {
  LISTING: '등록글', REQUEST: '요청글', SERVICE: '서비스', PROFILE: '프로필',
};

/** 며칠 방치됐는지. 신고해 놓고 답이 없으면 신고 자체를 안 하게 됩니다. */
function days(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d <= 0 ? '오늘' : `${d}일 전`;
}

/**
 * SB-ADM-RPT-010 신고 처리
 *
 * ── 오래된 것이 위로 옵니다 ─────────────────────────────────────────
 * 최신순으로 두면 오래된 신고가 영영 안 보입니다. **신고해 놓고
 * 답이 없으면 다음부터 신고를 안 합니다** — 그러면 자동 노출을
 * 지탱하는 축 하나가 무너집니다.
 *
 * ── 처리 내용 없이는 닫을 수 없습니다 ───────────────────────────────
 * DB 가 강제합니다. 신고한 사람에게 그대로 전달되므로,
 * 근거 없는 기각이 기록에 남지 않습니다.
 */
export function ReportQueue() {
  const { data, error, reload } = useApi<Row[]>('/admin/report-queue');
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (error) return <ErrorView error={error} />;
  if (!data) return <p className="dim">불러오는 중…</p>;

  async function resolve(id: string, state: 'UPHELD' | 'DISMISSED') {
    if (text.trim().length < 2) {
      setMsg('처리 내용을 적어 주십시오. 신고한 분에게 그대로 전달됩니다.');
      return;
    }
    setBusy(true); setMsg(null);
    try {
      /* v10.26 (G-178) — 공용 함수 api() 로 보냅니다. 전에는 fetch 로 바로 보내 로그인 토큰(Authorization)이 빠졌고, 서버가 403 으로 거절해 눌러도 처리되지 않았습니다 */
      await api(`/admin/reports/${id}/resolve`, {
        method: 'PATCH',
        body: JSON.stringify({ state, resolution: text.trim() }),
      });
      setOpen(null); setText(''); reload();
    } catch {
      setMsg('처리하지 못했습니다. 잠시 후 다시 시도해 주십시오.');
    }
    setBusy(false);
  }

  const old = data.filter((r) => Date.now() - new Date(r.createdAt).getTime() > 3 * 86400000);

  return (
    <div>
      <p className="hint">
        처리 대기 <b>{data.length}건</b>
        {old.length > 0 ? <> · <b style={{ color: 'var(--sgb-rd-text)' }}>3일 넘은 것 {old.length}건</b></> : null}
      </p>

      {old.length > 0 && (
        <div className="notice warn">
          <b>3일 넘게 방치된 신고가 있습니다.</b>
          신고해 놓고 답이 없으면 다음부터 신고를 안 합니다 —
          자동 노출을 지탱하는 축이 신고입니다.
        </div>
      )}

      {data.length === 0 ? (
        <p className="dim">처리할 신고가 없습니다.</p>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>대상</th><th>사유</th><th>내용</th>
              <th>같은 대상</th><th>접수</th><th>처리</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <Fragment key={r.id}>
                <tr>
                  <td>{TT[r.targetType] ?? r.targetType}</td>
                  <td>
                    <b>{r.reasonLabel ?? r.reasonCode}</b>
                    {r.severity === 'HIGH' && <span className="badge badge-urgent"> 높음</span>}
                  </td>
                  <td className="dim" style={{ maxWidth: 240 }}>{r.detail ?? '—'}</td>
                  <td>
                    {r.sameTarget > 1
                      ? <b style={{ color: 'var(--sgb-rd-text)' }}>{r.sameTarget}건</b>
                      : <span className="dim">1건</span>}
                  </td>
                  <td className="dim">{days(r.createdAt)}</td>
                  <td>
                    <button className="btn-sm"
                      onClick={() => { setOpen(open === r.id ? null : r.id); setText(''); setMsg(null); }}>
                      {open === r.id ? '닫기' : '처리'}
                    </button>
                  </td>
                </tr>
                {open === r.id && (
                  <tr>
                    <td colSpan={6} style={{ background: '#FAFBFD' }}>
                      <div style={{ padding: '4px 0' }}>
                        <textarea
                          rows={2} value={text} maxLength={500}
                          placeholder="처리 내용을 적어 주십시오. 신고한 분에게 그대로 전달됩니다."
                          onChange={(e) => setText(e.target.value)}
                          style={{ width: '100%', padding: 9, borderRadius: 'var(--sgb-r-sm)' }} />
                        <div style={{ display: 'flex', gap: 7, marginTop: 8 }}>
                          <button className="btn-primary" disabled={busy}
                            onClick={() => void resolve(r.id, 'UPHELD')}>
                            신고가 맞습니다
                          </button>
                          <button className="btn-sm" disabled={busy}
                            onClick={() => void resolve(r.id, 'DISMISSED')}>
                            아닙니다 (기각)
                          </button>
                        </div>
                        {msg && <p className="dim" style={{ color: 'var(--sgb-rd-text)', marginTop: 6 }}>{msg}</p>}
                        <p className="hint" style={{ marginTop: 6 }}>
                          <b>인정해도 글이 자동으로 내려가지는 않습니다.</b>
                          검수 큐에서 따로 결정하십시오 — 신고와 조치는 별개입니다.
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}

      <div className="notice">
        <b>같은 대상에 신고가 여러 건이면 우선 보십시오.</b>
        다만 <b>숫자만으로 판단하지 마십시오</b> — 경쟁사 여럿이 짜고
        올릴 수 있습니다. 내용을 보고 정하십시오.
      </div>
      {/* v10.31 — 시안 안내 */}
      <div className="ad-nt info"><b>인정해도 글이 자동으로 내려가지는 않습니다.</b> 검수 큐에서 따로 결정하십시오 — 신고와 조치는 별개입니다.</div>
    </div>
  );
}

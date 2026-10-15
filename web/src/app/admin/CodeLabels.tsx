import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { ErrorView } from '../../components/ErrorView';

interface Label {
  domain: string; code: string; label: string;
  shortLabel: string | null; uiTone: string | null; audience: string; isActive: boolean;
}

/**
 * SB-ADM-COD-010 코드 라벨 관리.
 *
 * domain 이 핵심입니다 — REJECTED 는 매물에서 "반려", 분쟁에서 "기각"입니다.
 * 여기서 바꾸면 배포 없이 화면 문구가 바뀝니다 (60초 캐시).
 */
export function CodeLabels() {
  const [rows, setRows] = useState<Label[]>([]);
  const [err, setErr] = useState<unknown>(null);
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => api<Label[]>('/admin/code-labels').then(setRows).catch(setErr);
  useEffect(() => { void load(); }, []);

  const domains = useMemo(
    () => [...new Set(rows.map((r) => r.domain))].sort(), [rows]);
  const shown = domain ? rows.filter((r) => r.domain === domain) : rows;

  async function save(r: Label, label: string) {
    if (label === r.label) return;
    setBusy(r.domain + r.code);
    try {
      await api(`/admin/code-labels/${encodeURIComponent(r.domain)}/${r.code}`, {
        method: 'PATCH', body: JSON.stringify({ label }),
      });
      await load();
    } catch (e) { setErr(e); } finally { setBusy(null); }
  }

  async function saveShort(r: Label, shortLabel: string) {
    if (shortLabel === (r.shortLabel ?? '') || !shortLabel.trim()) return;
    setBusy(r.domain + r.code);
    try {
      await api(`/admin/code-labels/${encodeURIComponent(r.domain)}/${r.code}`, {
        method: 'PATCH', body: JSON.stringify({ label: r.label, shortLabel: shortLabel.trim() }),
      });
      await load();
    } catch (e) { setErr(e); } finally { setBusy(null); }
  }

  if (err) return <ErrorView error={err} onRetry={() => { setErr(null); void load(); }} />;

  return (
    <section>
      {/* v10.31 (시안 scAdmCod) — 안내 · 표(영역 · 코드 · 라벨 · 짧게 · 대상) · 「코드는 바꾸지 마십시오」 경고 */}
      <div className="ad-nt info"><b>라벨을 바꾸는 데 배포가 필요하면 안 됩니다.</b> &lsquo;노출 중&rsquo;을 &lsquo;게시 중&rsquo;으로 바꾸려고 배포하는 일이 생깁니다. 그래서 라벨은 데이터입니다 — 바꾸면 60초 안에 반영됩니다.</div>
      <h2 className="ad-s2">라벨 <em>{shown.length}</em></h2>

      <select className="sel" value={domain} onChange={(e) => setDomain(e.target.value)}>
        <option value="">전체 도메인</option>
        {domains.map((d) => <option key={d} value={d}>{d}</option>)}
      </select>

      <table className="tbl">
        <thead>
          <tr><th>영역</th><th>코드</th><th>라벨</th><th>짧게</th><th>대상</th></tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.domain + r.code}>
              <td className="mono">{r.domain}</td>
              <td className="mono">{r.code}</td>
              <td>
                <input
                  defaultValue={r.label}
                  disabled={busy === r.domain + r.code}
                  onBlur={(e) => save(r, e.target.value)}
                />
              </td>
              <td>
                <input defaultValue={r.shortLabel ?? ''} placeholder="—" style={{ width: 110 }} aria-label={`${r.code} 짧게`}
                       disabled={busy === r.domain + r.code} onBlur={(e) => saveShort(r, e.target.value)} />
              </td>
              <td>{r.audience === 'ADMIN' ? '운영' : r.audience === 'USER' ? '이용자' : '전체'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ad-nt warn"><b>코드는 바꾸지 마십시오.</b> 라벨은 화면용이고 코드는 데이터입니다 — 코드를 바꾸면 쌓인 기록이 어느 상태였는지 알 수 없게 됩니다.</div>
    </section>
  );
}

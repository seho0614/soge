import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { ErrorView } from '../../components/ErrorView';

interface Word {
  id: string; word: string; matchType: string;
  severity: string; gwanCode: string | null; isActive: boolean;
}

/**
 * 금칙어 관리 (SB-ADM-POL-010 하위).
 *
 * BLOCK 은 등록을 거부하고, WARN 은 통과시키되 자동검수에서 빼 사람이 봅니다.
 * "최고" "카톡" 같은 단어는 문맥에 따라 정상일 수 있어 차단하지 않습니다.
 */
export function BannedWords() {
  const [rows, setRows] = useState<Word[]>([]);
  const [err, setErr] = useState<unknown>(null);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => api<Word[]>('/admin/banned-words').then(setRows).catch(setErr);
  useEffect(() => { void load(); }, []);

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setBusy('_add');
    try {
      await api('/admin/banned-words', {
        method: 'POST',
        body: JSON.stringify({
          word: String(fd.get('word')),
          severity: String(fd.get('severity')),
          matchType: String(fd.get('matchType')),
        }),
      });
      form.reset();
      await load();
    } catch (e2) { setErr(e2); } finally { setBusy(null); }
  }

  async function toggle(w: Word) {
    setBusy(w.id);
    try {
      await api(`/admin/banned-words/${w.id}`, {
        method: 'PATCH', body: JSON.stringify({ isActive: !w.isActive }),
      });
      await load();
    } catch (e) { setErr(e); } finally { setBusy(null); }
  }

  if (err) return <ErrorView error={err} onRetry={() => { setErr(null); void load(); }} />;

  const shown = filter ? rows.filter((r) => r.severity === filter) : rows;
  const block = rows.filter((r) => r.severity === 'BLOCK' && r.isActive).length;
  const warn = rows.filter((r) => r.severity === 'WARN' && r.isActive).length;

  return (
    <section>
      <h3 className="sub-title">금칙어 <span className="cnt">{rows.length}</span></h3>
      <p className="hint">
        <b>BLOCK {block}</b> 은 등록을 거부합니다 · <b>WARN {warn}</b> 은 통과시키되
        자동검수에서 빼 사람이 봅니다 — 문맥에 따라 정상일 수 있는 단어들입니다.
      </p>

      <form className="word-add" onSubmit={add}>
        <input name="word" required placeholder="단어 또는 정규식" />
        <select name="matchType" defaultValue="CONTAINS">
          <option value="CONTAINS">포함</option>
          <option value="EXACT">완전일치</option>
          <option value="REGEX">정규식</option>
        </select>
        <select name="severity" defaultValue="WARN">
          <option value="BLOCK">차단</option>
          <option value="WARN">주의</option>
        </select>
        <button className="btn-ok" disabled={busy === '_add'}>추가</button>
      </form>
      <p className="hint">추가 즉시 적용됩니다. 기존 매물은 소급 검사하지 않습니다.</p>

      <select className="sel" value={filter} onChange={(e) => setFilter(e.target.value)}>
        <option value="">전체</option>
        <option value="BLOCK">차단만</option>
        <option value="WARN">주의만</option>
      </select>

      <table className="tbl">
        <thead><tr><th>단어</th><th>방식</th><th>등급</th><th>관</th><th>사용</th></tr></thead>
        <tbody>
          {shown.map((w) => (
            <tr key={w.id} className={w.isActive ? '' : 'off'}>
              <td className={w.matchType === 'REGEX' ? 'mono' : ''}>{w.word}</td>
              <td className="mono">{w.matchType}</td>
              <td>
                <span className={`pill pill-${w.severity === 'BLOCK' ? 'danger' : 'warning'}`}>
                  {w.severity === 'BLOCK' ? '차단' : '주의'}
                </span>
              </td>
              <td className="mono">{w.gwanCode ?? '전체'}</td>
              <td>
                <input
                  type="checkbox" checked={w.isActive}
                  disabled={busy === w.id} onChange={() => toggle(w)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

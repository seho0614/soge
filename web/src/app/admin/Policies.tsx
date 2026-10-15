import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { ErrorView } from '../../components/ErrorView';
import { BannedWords } from './BannedWords';
import { PolicyItems } from './PolicyItems';
import { label, codeList } from '../../lib/codes';

interface Restriction {
  code: string; name: string; legalBasis: string; gwanCode: string;
  mode: 'BLOCK' | 'GATED' | 'ALLOW'; blockMessage: string; isActive: boolean;
}
interface AutoPolicy { enabled: boolean; numValue: number | null; description: string }
interface Bundle {
  restrictedIndustries: Restriction[];
  bannedWordCount: number;
  autoReviewPolicies: Record<string, AutoPolicy>;
}

const MODE_TONE: Record<string, string> = {
  BLOCK: 'danger', GATED: 'warning', ALLOW: 'muted',
};

/**
 * SB-ADM-POL-010 금칙어 · 제한업종 · 요율.
 *
 * 여기서 BLOCK 으로 바꾸면 그 업종의 노출 중인 매물이 즉시 중단되고
 * 등록자에게 안내가 나갑니다. 되돌리려면 매물을 하나씩 다시 노출해야 합니다.
 * 그래서 확인 단계를 둡니다.
 */
export function Policies() {
  const [data, setData] = useState<Bundle | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ r: Restriction; mode: string } | null>(null);

  const load = () => api<Bundle>('/admin/policies').then(setData).catch(setErr);
  useEffect(() => { void load(); }, []);

  async function apply(r: Restriction, mode: string) {
    setBusy(r.code);
    setConfirm(null);
    try {
      await api(`/admin/policies/restrictions/${r.code}`, {
        method: 'PATCH',
        body: JSON.stringify({ gwanCode: r.gwanCode, mode }),
      });
      await load();
    } catch (e) { setErr(e); } finally { setBusy(null); }
  }

  function change(r: Restriction, mode: string) {
    if (mode === r.mode) return;
    // BLOCK 으로 바꾸는 것만 확인을 받습니다 — 되돌릴 수 없는 쪽이라서요
    if (mode === 'BLOCK') setConfirm({ r, mode });
    else void apply(r, mode);
  }

  if (err) return <ErrorView error={err} onRetry={() => { setErr(null); void load(); }} />;
  if (!data) return <p className="empty">불러오는 중…</p>;

  return (
    <section>
      {/* v10.31 — 시안 정책 원본 표(9줄 · 확정/미결)를 맨 위에. 아래 제한업종 · 금칙어는 개발에만(규칙을 바꾸는 자리) */}
      <PolicyItems />
      <h2 className="ad-s2">제한업종 · 금칙어 <small className="dim">규칙을 바꾸는 자리</small></h2>
      <p className="hint">
        규칙은 코드가 아니라 데이터입니다. 여기서 바꾸면 <b>배포 없이</b> 즉시 반영됩니다.
      </p>

      {confirm && (
        <div className="confirm">
          <p>
            <b>{confirm.r.name}</b>을(를) {label('restriction.mode','BLOCK')}으로 바꾸면
            <b> 노출 중인 해당 업종 매물이 즉시 중단되고 등록자에게 안내가 발송됩니다.</b><br />
            되돌리려면 매물을 하나씩 다시 노출해야 합니다.
          </p>
          <div className="row-actions">
            <button className="btn-no" onClick={() => apply(confirm.r, confirm.mode)}>
              차단하겠습니다
            </button>
            <button className="btn-plain" onClick={() => setConfirm(null)}>취소</button>
          </div>
        </div>
      )}

      <h3 className="sub-title">제한업종 <span className="cnt">{data.restrictedIndustries.length}</span></h3>
      <ul className="rows">
        {data.restrictedIndustries.map((r) => (
          <li key={r.gwanCode + r.code} className="row">
            <div className="row-head">
              <strong>{r.name}</strong>
              <span className="mono">{r.gwanCode}</span>
              <span className={`pill pill-${MODE_TONE[r.mode]}`}>{label('restriction.mode', r.mode)}</span>
            </div>
            <p className="legal">{r.legalBasis}</p>
            <p className="block-msg">
              <b>차단 안내</b> {r.blockMessage}
            </p>
            <div className="row-actions">
              {codeList('restriction.mode').map(({ code: m }) => (
                <button
                  key={m}
                  className={m === r.mode ? 'btn-ok' : 'btn-plain'}
                  disabled={busy === r.code || m === r.mode}
                  onClick={() => change(r, m)}
                >
                  {label('restriction.mode', m)}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>

      <h3 className="sub-title">자동검수 규칙</h3>
      <p className="hint">
        사람이 봐야 하는 경우입니다. 자세한 조정은 <b>자동검수 규칙</b> 탭에서 합니다.
      </p>
      <table className="tbl">
        <thead><tr><th>규칙</th><th>설명</th><th>기준값</th><th>상태</th></tr></thead>
        <tbody>
          {Object.entries(data.autoReviewPolicies).map(([k, p]) => (
            <tr key={k}>
              <td className="mono">{k}</td>
              <td>{p.description}</td>
              <td className="num-cell">
                {p.numValue == null ? '—' : p.numValue.toLocaleString('ko-KR')}
              </td>
              <td>{p.enabled ? '사용' : '중지'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <BannedWords />
    </section>
  );
}

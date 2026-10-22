import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { label } from '../../lib/codes';
import { ErrorView } from '../../components/ErrorView';

/** SB-ADM-REV-030 자동검수 규칙 관리 */

interface Policy { enabled: boolean; numValue: number | null; description: string }
interface Restriction { code: string; name: string; legalBasis: string; gwanCode: string | null; mode: string; isActive: boolean }
interface Bundle { autoReviewPolicies: Record<string, Policy>; restrictedIndustries?: Restriction[] }
interface Word { id: string; word: string; matchType: string; severity: string; gwanCode: string | null; isActive: boolean }

/** 개입 사유별 발생 건수. 어떤 규칙이 사람의 시간을 얼마나 쓰는지 보여야 조정할 수 있습니다. */
interface ReasonStat { reason: string; cnt: number }

const RULE_ORDER = [
  'manual_unverified_business', 'manual_first_listing', 'manual_fee_threshold',
  'manual_after_reject', 'manual_gated_category', 'min_body_length',
];
const REASON_OF: Record<string, string> = {
  manual_unverified_business: 'UNVERIFIED_BUSINESS',
  manual_first_listing: 'FIRST_LISTING',
  manual_fee_threshold: 'HIGH_FEE',
  manual_after_reject: 'PRIOR_REJECT',
  manual_gated_category: 'GATED_CATEGORY',
  min_body_length: 'THIN_CONTENT',
};

export function AutoReviewRules({ onGo }: { onGo?: (tab: string) => void } = {}) {
  const [pol, setPol] = useState<Record<string, Policy>>({});
  const [stats, setStats] = useState<ReasonStat[]>([]);
  const [rate, setRate] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [restr, setRestr] = useState<Restriction[]>([]);
  const [words, setWords] = useState<Word[]>([]);
  const [adding, setAdding] = useState(false);
  const [nw, setNw] = useState({ word: '', matchType: 'CONTAINS', severity: 'BLOCK' });
  const [msg, setMsg] = useState<[boolean, string] | null>(null);

  const load = () => {
    Promise.all([
      api<Bundle>('/admin/policies'),
      api<ReasonStat[]>('/admin/auto-review/reasons').catch(() => []),
      api<{ autoRatePct: number }[]>('/admin/auto-review/rate').catch(() => []),
      api<Word[]>('/admin/banned-words').catch(() => [] as Word[]),
    ]).then(([b, s, r, w]) => {
      setPol(b.autoReviewPolicies ?? {});
      setRestr((b.restrictedIndustries ?? []).filter((x) => x.isActive && x.mode !== 'ALLOW'));
      setWords((w as Word[]).filter((x) => x.isActive));
      setStats(s);
      setRate(r[0]?.autoRatePct ?? null);
      setError(null);
    }).catch(setError);
  };
  useEffect(load, []);

  const save = (key: string, patch: Partial<Policy>) => {
    setBusy(key);
    api(`/admin/policies/auto-review/${key}`, { method: 'PATCH', body: JSON.stringify(patch) })
      .then(load).catch(setError).finally(() => setBusy(null));
  };

  /* v10.31 — 시안 「규칙 추가」 = 금칙어 더하기(제한업종 바꾸기는 「정책」 · 최고 관리자) */
  const addWord = () => {
    setBusy('add'); setMsg(null);
    api('/admin/banned-words', { method: 'POST', body: JSON.stringify(nw) })
      .then(() => { setMsg([true, `「${nw.word}」 를 금칙어로 더했습니다 — 바로 반영됩니다.`]); setNw({ ...nw, word: '' }); setAdding(false); load(); })
      .catch((e: { body?: { message?: string } }) => setMsg([false, e?.body?.message ?? '더하지 못했습니다.']))
      .finally(() => setBusy(null));
  };
  const master = pol['auto_approve_enabled'];
  const cntOf = (k: string) => stats.find((s) => s.reason === REASON_OF[k])?.cnt ?? 0;

  if (error) return <ErrorView error={error} onRetry={load} />;

  /* v10.29 — 시안처럼 본문 폭 그대로(전에는 가운데 720 좁은 칸) · 사람이 보는 경우를 표로 */
  return (
    <div data-auto-rules>
      {/* v10.31 (10/10 시안 기준 · scAdmRev3) — 시안 순서: 「규칙 추가」 · 와일드카드 경고 · 금칙어 표 · 제한업종 표 · 반려 사유 안내.
          개발에만 있는 자동검수 켜기 · 사람이 보는 경우 · 표본 감사 비율은 그 아래에 둡니다 */}
      <div className="ad-dact end" style={{ marginTop: 0 }}>
        <button className="btn-ok" onClick={() => setAdding((a) => !a)} data-rule-add>규칙 추가</button>
      </div>
      {adding && (
        <div className="ad-panel" data-rule-form>
          <h3>금칙어 더하기 <small>잘못 넣으면 정상 등록이 반려됩니다</small></h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input value={nw.word} onChange={(e) => setNw({ ...nw, word: e.target.value })} placeholder="단어 또는 패턴" aria-label="금칙어" />
            <select value={nw.matchType} onChange={(e) => setNw({ ...nw, matchType: e.target.value })} aria-label="방식">
              <option value="CONTAINS">CONTAINS — 그대로 포함</option><option value="REGEX">REGEX — 패턴</option>
            </select>
            <select value={nw.severity} onChange={(e) => setNw({ ...nw, severity: e.target.value })} aria-label="수위">
              <option value="BLOCK">BLOCK — 등록 거부</option><option value="WARN">WARN — 사람이 봄</option>
            </select>
            <button className="btn-ok btn-sm" disabled={!nw.word.trim() || busy === 'add'} onClick={addWord}>더하기</button>
          </div>
        </div>
      )}
      {msg && <p className={msg[0] ? 'form-ok' : 'form-error'} role="status">{msg[1]}</p>}
      <div className="ad-nt warn">
        <b>와일드카드를 조심하십시오.</b> &lsquo;100% 성공&rsquo;을 CONTAINS 로 넣으면 &lsquo;100원에 성공하세요&rsquo; 같은 정상 문구까지 걸립니다 —
        CONTAINS 는 문자 그대로 비교하므로 안전하지만, 패턴이 필요하면 REGEX 를 쓰십시오.
      </div>
      <h2 className="ad-s2">금칙어 <em>{words.length}</em></h2>
      <div className="ad-tw"><table className="tbl" data-rule-words>
        <thead><tr><th>단어</th><th>방식</th><th>수위</th><th>관</th></tr></thead>
        <tbody>
          {words.length === 0 && <tr><td colSpan={4} className="muted">금칙어가 없습니다.</td></tr>}
          {words.slice(0, 50).map((w) => (
            <tr key={w.id}><td className="mono"><b>{w.word}</b></td><td>{w.matchType}</td>
              <td><span className={`ad-bg ${w.severity === 'BLOCK' ? 'no' : 'wait'}`}>{w.severity}</span></td><td>{w.gwanCode ?? '전관'}</td></tr>
          ))}
        </tbody>
      </table></div>
      {words.length > 50 && <p className="dim">앞 50개만 보입니다 — 전체는 「정책」 화면에서 찾고 고칩니다.</p>}
      <h2 className="ad-s2">제한업종 <em>{restr.length}</em></h2>
      <div className="ad-tw"><table className="tbl" data-rule-restricted>
        <thead><tr><th>업종</th><th>관</th><th>근거</th><th>방식</th></tr></thead>
        <tbody>
          {restr.map((r) => (
            <tr key={r.code}><td><b>{r.name}</b></td><td>{r.gwanCode ?? '전관'}</td><td>{r.legalBasis}</td>
              <td><span className={`ad-bg ${r.mode === 'BLOCK' ? 'no' : 'wait'}`}>{r.mode === 'BLOCK' ? '등록 차단' : '자격 확인 후 허용'}</span></td></tr>
          ))}
        </tbody>
      </table></div>
      <div className="ad-nt info">
        <b>반려 사유는 이용자에게 그대로 보입니다.</b> &lsquo;금칙어 포함&rsquo;만 쓰면 무엇을 고쳐야 할지 모릅니다 — 어느 표현인지 함께 알려 줍니다.
        제한업종의 차단 · 허용을 바꾸는 것은 「정책」 화면(최고 관리자)에서 합니다.
        {onGo && <> <button className="linkbtn" onClick={() => onGo('policy')}>정책으로</button></>}
      </div>

      <h2 className="ad-s2">자동 승인 · 사람이 보는 경우 <small className="dim">개발에만</small></h2>
      <div className="card ad-switch">
        <div style={{ flex: 1 }}>
          <b>자동검수</b>
          <p>끄면 전건 수동으로 전환됩니다. 사고 시 즉시 잠글 수 있어야 합니다.</p>
        </div>
        {rate != null && <span className="ad-rate">최근 자동검수율 <b>{rate}%</b></span>}
        <Toggle
          on={master?.enabled ?? false}
          busy={busy === 'auto_approve_enabled'}
          onChange={(v) => save('auto_approve_enabled', { enabled: v })}
        />
      </div>

      <h3 className="ad-s3">사람이 보는 경우 <em>{RULE_ORDER.filter((k) => pol[k]).length}</em></h3>
      <table className="tbl">
        <thead><tr><th style={{ width: 70 }}>사용</th><th>규칙</th><th>기준 값</th><th className="num-cell">개입 건수</th></tr></thead>
        <tbody>
          {RULE_ORDER.map((k) => [k, pol[k]] as const)
            .filter((e): e is readonly [string, Policy] => !!e[1])
            .map(([k, p]) => (
            <tr key={k}>
              <td><Toggle on={p.enabled} busy={busy === k} onChange={(v) => save(k, { enabled: v })} /></td>
              <td><b>{label('review.manual_reason', REASON_OF[k] ?? '') || p.description}</b></td>
              <td>
                {p.numValue != null ? (
                  <input
                    type="number" defaultValue={p.numValue}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (v !== p.numValue) save(k, { numValue: v });
                    }}
                    className="num" style={{ width: 140, marginTop: 0 }}
                  />
                ) : <span className="dim">—</span>}
              </td>
              {/* 개입 건수를 규칙 옆에 함께 보여 줍니다 */}
              <td className="num-cell">{cntOf(k)}건</td>
            </tr>
          ))}
        </tbody>
      </table>

      {pol['sample_audit_rate'] && (
        <>
          <h3 className="ad-s3">표본 감사 비율</h3>
          <div className="card pad">
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', fontSize: 13 }}>
              <span>자동 승인 건 중</span>
              <input type="number" defaultValue={pol['sample_audit_rate'].numValue ?? 5}
                     onBlur={(e) => save('sample_audit_rate', { numValue: Number(e.target.value) })}
                     className="num" style={{ width: 72, marginTop: 0 }} />
              <span>% 를 무작위로 다시 확인</span>
            </label>
            <p className="dim" style={{ margin: '8px 0 0' }}>표본 감사 없이 자동화하면 오판을 영원히 모릅니다.</p>
          </div>
        </>
      )}

    </div>
  );
}

function Toggle({ on, busy, onChange }: { on: boolean; busy: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch" aria-checked={on} disabled={busy}
      onClick={() => onChange(!on)}
      style={{
        width: 44, height: 24, borderRadius: 'var(--sgb-r-md)', cursor: busy ? 'wait' : 'pointer',
        border: '1px solid var(--line)', padding: 2,
        background: on ? 'var(--money)' : 'var(--line)',
        display: 'flex', justifyContent: on ? 'flex-end' : 'flex-start',
      }}
    >
      <span style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--paper)' }} />
    </button>
  );
}

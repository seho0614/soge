import { useState } from 'react';
import { useApi } from '../../../lib/useApi';
import { api, tokenRoles } from '../../../lib/api';
import { useAct } from '../../../lib/act';
import { Flash } from '../../../components/Flash';
import { ErrorView } from '../../../components/ErrorView';

/**
 * v10.135 (docs/202) — AI 운영 › AI 에이전트 › 「AI 한도 · 모델」 (SB-ADM-AGT-010 안의 한 구역 · 「AI 스위치」 아래)
 *
 * 대표 「AI 한도는 관리자가 정하게 · 모델도 고르게」(2026-10-27). 전에는 하루 횟수 · 모델이 DB 로만 바뀌었습니다.
 *   바꾸기는 최고 관리자(SUPER)만 — 서버도 막습니다(AI_SETTING_SUPER). 운영자(ADMIN)는 보기만.
 *   하루 횟수 · 모델 저장은 PATCH /admin/site-settings(감사 SITE_SETTING_UPDATE · 형식은 설정의 value_pattern).
 *   모델은 요금표에 있는 것만 — 서버가 MODEL_UNPRICED 로 막음(요금을 알아야 월 상한을 셈).
 *   요금표 넣기 · 고치기는 PUT /admin/agent/model-prices(감사 AGENT_MODEL_PRICE_SET · 기준일은 오늘 · 지우기 없음).
 */

interface Setting { key: string; value: string | null }
interface Price { model: string; inputPerM: string; outputPerM: string; cacheReadPerM: string; asOf: string; note?: string | null }
interface Status { prices: Price[] }

const LIMITS: { key: string; label: string; what: string }[] = [
  { key: 'agent.member_daily_limit', label: 'AI 상담 — 회원 1명 하루', what: '로그인한 회원 한 사람이 하루에 물을 수 있는 횟수' },
  { key: 'agent.guest_daily_limit', label: 'AI 상담 — 비회원 1명 하루', what: '비회원(방문자 키 하나)이 하루에 물을 수 있는 횟수' },
  { key: 'agent.guest_daily_per_ip', label: 'AI 상담 — 비회원 IP 하나 하루', what: '한 접속 주소(IP)에서 비회원이 하루에 물을 수 있는 횟수 — 방문자 키를 바꿔 가며 쓰는 것을 막음' },
  { key: 'agent.guest_daily_total', label: 'AI 상담 — 비회원 모두 합쳐 하루', what: '넘으면 비회원은 다음 날까지 AI 상담을 못 씀' },
  { key: 'i18n.board_daily_member', label: '볼 때 번역 — 회원 1명 하루', what: '소개광장 「번역 보기」 회원 한 사람의 하루 횟수' },
  { key: 'i18n.board_daily_guest', label: '볼 때 번역 — 비회원 1명 하루', what: '비회원 한 사람의 하루 횟수' },
  { key: 'i18n.board_daily_guest_total', label: '볼 때 번역 — 비회원 모두 합쳐 하루', what: '넘으면 비회원은 다음 날까지 번역 보기를 못 씀' },
];
const MODELS: { key: string; label: string }[] = [
  { key: 'agent.chat_model', label: 'AI 상담' },
  { key: 'agent.review_model', label: 'AI 검수 보조' },
  { key: 'i18n.translate_model', label: '번역(등록 글 · 볼 때 번역)' },
];
const EMPTY = { model: '', inputPerM: '', outputPerM: '', cacheReadPerM: '', note: '' };

export function AgentLimits({ onChanged }: { onChanged?: () => void }) {
  const r = useApi<Setting[]>('/admin/site-settings');
  const st = useApi<Status>('/admin/agent/status');
  const a = useAct();
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [np, setNp] = useState(EMPTY);
  const isSuper = tokenRoles().includes('SUPER');
  if (r.error) return <ErrorView error={r.error} onRetry={r.reload} />;
  if (st.error) return <ErrorView error={st.error} onRetry={st.reload} />;
  if (!r.data || !st.data) return null;
  const val = (k: string) => r.data!.find((s) => s.key === k)?.value ?? '';
  const prices = st.data.prices ?? [];
  const priceOf = (m: string) => prices.find((p) => p.model === m);
  const done = () => { r.reload(); st.reload(); onChanged?.(); };
  const save = (key: string, value: string, ok: string) =>
    void a.run(key, () => api('/admin/site-settings', { method: 'PATCH', body: JSON.stringify({ key, value }) }),
      () => { setEdit((e) => { const n = { ...e }; delete n[key]; return n; }); done(); }, ok);
  const saveLimit = (key: string, label: string) => {
    const v = (edit[key] ?? val(key)).trim();
    if (!/^[0-9]{1,5}$/.test(v)) { a.setErr(`${label} — 0 이상의 횟수(숫자)로 넣으십시오. 0 이면 막습니다.`); return; }
    save(key, v, `${label}을(를) ${v}회로 정했습니다.`);
  };
  const saveModel = (key: string, label: string, model: string) => {
    if (!window.confirm(`${label} 모델을 ${model} 로 바꿀까요? 1분 안에 다음 요청부터 이 모델을 부릅니다(요금이 달라질 수 있음).`)) return;
    save(key, model, `${label} 모델을 ${model} 로 정했습니다.`);
  };
  const savePrice = () => {
    const m = np.model.trim();
    const n = (s: string) => Number(s.trim());
    if (!/^claude-[a-z0-9-]+$/.test(m)) { a.setErr('모델 이름은 Anthropic 모델 이름 그대로(claude- 로 시작 · 소문자)로 넣으십시오.'); return; }
    if ([np.inputPerM, np.outputPerM, np.cacheReadPerM].some((x) => x.trim() === '' || !(n(x) >= 0))) { a.setErr('요금 세 칸은 100만 토큰당 달러 숫자로 넣으십시오(예: 2 · 10 · 0.2).'); return; }
    if (!window.confirm(`${m} 요금을 입력 $${np.inputPerM} · 출력 $${np.outputPerM} · 캐시 읽기 $${np.cacheReadPerM}(100만 토큰당)로 저장할까요? 이번 달 비용 계산에 바로 쓰입니다.`)) return;
    void a.run('price', () => api('/admin/agent/model-prices', { method: 'PUT', body: JSON.stringify({
      model: m, inputPerM: n(np.inputPerM), outputPerM: n(np.outputPerM), cacheReadPerM: n(np.cacheReadPerM), note: np.note.trim() || undefined }) }),
    () => { setNp(EMPTY); done(); }, `${m} 요금을 저장했습니다.`);
  };
  const editPrice = (p: Price) => setNp({ model: p.model, inputPerM: p.inputPerM, outputPerM: p.outputPerM, cacheReadPerM: p.cacheReadPerM, note: p.note ?? '' });

  return (
    <div data-agent-limits>
      <h3 className="sec">AI 한도 · 모델 {!isSuper && <small className="muted">— 바꾸기는 최고 관리자만</small>}</h3>
      <p className="hint">하루 횟수 · 모델은 관리자가 정합니다. 0 이면 그 기능을 막습니다. 바꾸면 1분 안에 반영되고 감사 기록에 남습니다.</p>
      <Flash msg={a.msg} err={a.err} />

      <table className="tbl" data-agent-limit-table>
        <thead><tr><th>하루 횟수</th><th>지금</th><th>설명</th><th></th></tr></thead>
        <tbody>
          {LIMITS.map((l) => (
            <tr key={l.key} data-agent-limit={l.key}>
              <td><b>{l.label}</b></td><td>{val(l.key) || '0'}회</td>
              <td className="muted">{l.what}</td>
              <td>{isSuper && <>
                <input value={edit[l.key] ?? val(l.key)} onChange={(e) => setEdit({ ...edit, [l.key]: e.target.value })} size={6} inputMode="numeric" aria-label={l.label} />{' '}
                <button className="btn-sm" disabled={a.busy === l.key} onClick={() => saveLimit(l.key, l.label)}>저장</button>
              </>}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <table className="tbl" data-agent-model-table>
        <thead><tr><th>기능</th><th>지금 모델</th><th>요금(100만 토큰당 · 입력 / 출력)</th><th></th></tr></thead>
        <tbody>
          {MODELS.map((m) => {
            const cur = val(m.key); const p = priceOf(cur);
            return (
              <tr key={m.key} data-agent-model={m.key}>
                <td><b>{m.label}</b></td><td><code>{cur || '없음'}</code></td>
                <td className="muted">{p ? `$${p.inputPerM} / $${p.outputPerM}` : <span className="warn-text">요금표에 없음 — 부르지 않음</span>}</td>
                <td>{isSuper && (
                  <select value={cur} disabled={a.busy === m.key} aria-label={`${m.label} 모델`} onChange={(e) => e.target.value !== cur && saveModel(m.key, m.label, e.target.value)}>
                    {!p && <option value={cur}>{cur || '고르십시오'}</option>}
                    {prices.map((x) => <option key={x.model} value={x.model}>{x.model} (${x.inputPerM} / ${x.outputPerM})</option>)}
                  </select>
                )}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h4 className="sec">모델 요금표</h4>
      <p className="hint">고를 수 있는 모델은 이 표에 있는 것뿐입니다. Anthropic 이 새 모델을 내거나 요금을 바꾸면 여기서 넣고 고칩니다(공개 요금을 확인하고 넣으십시오 · 지우기는 없음 — 지난 사용량의 근거).</p>
      <table className="tbl" data-agent-price-table>
        <thead><tr><th>모델</th><th>입력</th><th>출력</th><th>캐시 읽기</th><th>기준일</th><th>메모</th><th></th></tr></thead>
        <tbody>
          {prices.map((p) => (
            <tr key={p.model} data-agent-price={p.model}>
              <td><code>{p.model}</code></td><td>${p.inputPerM}</td><td>${p.outputPerM}</td><td>${p.cacheReadPerM}</td>
              <td>{p.asOf}</td><td className="muted">{p.note ?? ''}</td>
              <td>{isSuper && <button className="btn-sm ghost" onClick={() => editPrice(p)}>고치기</button>}</td>
            </tr>
          ))}
          {isSuper && (
            <tr data-agent-price-new>
              <td><input value={np.model} onChange={(e) => setNp({ ...np, model: e.target.value })} placeholder="claude-…" size={18} aria-label="모델 이름" /></td>
              <td><input value={np.inputPerM} onChange={(e) => setNp({ ...np, inputPerM: e.target.value })} size={5} inputMode="decimal" aria-label="입력 요금" /></td>
              <td><input value={np.outputPerM} onChange={(e) => setNp({ ...np, outputPerM: e.target.value })} size={5} inputMode="decimal" aria-label="출력 요금" /></td>
              <td><input value={np.cacheReadPerM} onChange={(e) => setNp({ ...np, cacheReadPerM: e.target.value })} size={5} inputMode="decimal" aria-label="캐시 읽기 요금" /></td>
              <td className="muted">오늘</td>
              <td><input value={np.note} onChange={(e) => setNp({ ...np, note: e.target.value })} size={14} aria-label="메모" /></td>
              <td><button className="btn-sm" disabled={a.busy === 'price'} onClick={savePrice}>저장</button></td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

import { useState } from 'react';
import { api, ApiFailure } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { ErrorView } from '../../components/ErrorView';
import { Pills } from '../../components/Pills';

/* v10.31 — 서버 응답 이름(GET /admin/risk/alerts · rules · rule-health)대로 읽습니다.
 * 전에는 rule_code · occurred_at · auto_detect 로 읽어 규칙 칸이 비고 「자동 탐지 끔」이 늘 나왔으며,
 * 「오탐」을 눌러도 서버가 받는 이름(?state=FALSE_POSITIVE)이 아니라 일반 처리로 닫혔습니다. */
interface Alert {
  id: number; rule: string; ruleName: string; severity: string; subject: string; detail: string;
  reason: string | null; action: string | null; state: string; occurredAt: string;
  ruleSource: string; falsePositive: string;
}
interface Rule { code: string; name: string; protects: string; source: string; falsePositive: string; severity: string; isActive: boolean }
interface Health { code: string; raised: string; false_positives: string; fp_rate: string | null }

const SEV: Record<string, [string, string]> = { HIGH: ['높음', 'no'], MEDIUM: ['보통', 'wait'], LOW: ['낮음', ''] };
type F = 'all' | 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * SB-ADM-RSK-010 AI 위험감지
 *
 * v10.31 (10/10 시안 기준 · scAdmRsk) — 「전체 · 높음 · 보통 · 낮음」 등급 탭 + 경보 카드(펼치면 근거 · 규칙 원문 · 오탐 가능성 · 처리) +
 * 「규칙 N종 — 숨기지 않습니다」 표(코드 · 이름 · 무엇을 보는가 · 지키려는 규칙 · 오탐 가능성) + 엔진 4칸(엔진 · 어떻게 계산하나 · 한계 · 다음 단계).
 * 개발에만 있던 규칙 성적(발생 · 오탐 · 오탐률)은 규칙 표의 칸으로 합쳤습니다.
 */
export function RiskAlerts() {
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState<F>('all');
  const [showClosed, setShowClosed] = useState(false);
  const alerts = useApi<Alert[]>('/admin/risk/alerts');
  const rules = useApi<Rule[]>('/admin/risk/rules');
  const health = useApi<Health[]>('/admin/risk/rule-health');

  async function close(id: number, falsePositive: boolean) {
    setErr(null); setMsg(null);
    try {
      await api(`/admin/risk/alerts/${id}/close${falsePositive ? '?state=FALSE_POSITIVE' : ''}`, { method: 'POST', body: '{}' });
      setMsg(falsePositive ? '오탐으로 기록했습니다. 규칙 조정의 근거가 됩니다.' : '조치 완료로 닫았습니다.');
      alerts.reload(); health.reload();
    } catch (e) {
      setErr(e instanceof ApiFailure ? e.body.message : '처리하지 못했습니다.');
    }
  }

  if (alerts.error) return <ErrorView error={alerts.error} onRetry={alerts.reload} />;

  const all = alerts.data ?? [];
  const live = showClosed ? all : all.filter((a) => a.state === 'OPEN' || a.state === 'REVIEWING');
  const cnt = (s: string) => live.filter((a) => a.severity === s).length;
  const shown = live.filter((a) => f === 'all' || a.severity === f);
  const H = new Map((health.data ?? []).map((h) => [h.code, h]));
  const R = rules.data ?? [];
  const broken = all.filter((a) => a.subject.startsWith('rule:') && a.state === 'OPEN');

  return (
    <section>
      <Pills label="경보 등급" value={f} onChange={setF}
             items={[['all', '전체', live.length], ['HIGH', '높음', cnt('HIGH')], ['MEDIUM', '보통', cnt('MEDIUM')], ['LOW', '낮음', cnt('LOW')]]} />
      <label className="dim" style={{ fontSize: 12.5, display: 'block', margin: '-4px 0 10px' }}>
        <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> 처리한 경보도 보기(최근 100건)
      </label>
      {broken.length > 0 && (
        <div className="ad-nt warn"><b>탐지 질의가 깨진 규칙 {broken.length}건.</b> 그 규칙은 아무것도 잡지 못합니다 — 배치는 계속 돌지만 조용히 지나갑니다.</div>
      )}
      {msg && <p className="form-ok">{msg}</p>}
      {err && <p className="form-error">{err}</p>}

      {shown.length === 0 && <p className="ad-empty">{f === 'all' ? '열린 경보가 없습니다.' : '이 등급의 열린 경보가 없습니다.'}</p>}
      {shown.map((a) => {
        const sv = SEV[a.severity] ?? [a.severity, ''];
        return (
          <details key={a.id} className={`ad-alert${a.severity === 'HIGH' ? ' hi' : ''}`} data-risk-alert={a.id}>
            <summary>
              <span className={`ad-bg ${sv[1]}`}>{sv[0]}</span>
              <b className="mono">{a.rule}</b>
              <span><b>{a.ruleName}</b> <span className="dim">{a.detail}</span></span>
              <span className="dim">{new Date(a.occurredAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}</span>
            </summary>
            <div className="bd">
              <div><b>대상</b> {a.subject}</div>
              {a.reason && <div><b>근거</b> {a.reason}</div>}
              <div><b>규칙 원문</b> {a.ruleSource}</div>
              <div><b>오탐 가능성</b> {a.falsePositive}</div>
              {a.action && <div><b>권장 조치</b> {a.action}</div>}
              {(a.state === 'OPEN' || a.state === 'REVIEWING') ? (
                <div className="acts" style={{ marginTop: 8 }}>
                  <button className="btn-ok btn-sm" onClick={() => close(a.id, false)}>조치 완료</button>
                  <button className="btn-plain btn-sm" onClick={() => close(a.id, true)}>오탐</button>
                </div>
              ) : <div className="dim">처리됨 — {a.state === 'FALSE_POSITIVE' ? '오탐' : '조치 완료'}</div>}
            </div>
          </details>
        );
      })}

      <h2 className="ad-s2">규칙 {R.length}종 — 숨기지 않습니다</h2>
      <div className="ad-tw"><table className="tbl" data-risk-rules>
        <thead><tr><th>코드</th><th>이름</th><th>무엇을 보는가</th><th>지키려는 규칙</th><th>오탐 가능성</th><th className="num-cell">발생 · 오탐</th></tr></thead>
        <tbody>{R.map((r) => {
          const h = H.get(r.code);
          return (
            <tr key={r.code} className={!r.isActive ? 'hl' : undefined}>
              <td className="mono"><b>{r.code}</b><span className="ad-ls">{(SEV[r.severity] ?? [r.severity])[0]}{!r.isActive && ' · 꺼짐'}</span></td>
              <td><b>{r.name}</b></td><td>{r.source}</td><td>{r.protects}</td><td className="dim">{r.falsePositive}</td>
              <td className="num-cell">{h ? `${h.raised} · ${h.false_positives}${h.fp_rate ? ` (${h.fp_rate}%)` : ''}` : '—'}</td>
            </tr>
          );
        })}</tbody>
      </table></div>

      <div className="ad-rw" data-engine>
        <div className="ad-rc"><span>엔진</span><b style={{ fontSize: 14 }}>규칙 엔진</b><small>조건식 {R.length}개를 로그에 겁니다. 이상탐지 모델이 아닙니다.</small></div>
        <div className="ad-rc"><span>어떻게 계산하나</span><b style={{ fontSize: 14 }}>조건 하나 = 규칙 하나</b><small>넘으면 경보, 아니면 조용합니다. 심각도는 규칙에 고정돼 있고 학습으로 바뀌지 않습니다.</small></div>
        <div className="ad-rc warn"><span>한계</span><b style={{ fontSize: 14 }}>규칙에 없는 수법은 못 잡습니다</b><small>그래서 규칙 원문을 화면에 그대로 열어 둡니다 — 숨기면 놓친 것을 아무도 모릅니다. 오탐도 남습니다.</small></div>
        <div className="ad-rc"><span>다음 단계</span><b style={{ fontSize: 14 }}>오탐률로 임계값 조정</b><small>처리 결과(조치 완료 · 오탐)가 risk_alerts 에 쌓이고 있습니다 — 오탐률이 높은 규칙부터 손봅니다.</small></div>
      </div>
    </section>
  );
}

import { useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';

/**
 * v10.799 (D333 · docs/915) — 외부 연동 › 「ERP 연동」 상자(연동 키 아래)
 *   ERP 서버가 소개뱅크에 운영자 토큰을 물을 때 내는 서비스 토큰 — 있음 / 없음 · 바꾼 시각만 보임(값은 DB 에 sha256).
 *   「새 토큰 만들기」(SUPER) → 원문을 이 화면에 한 번만 보여 줌 → ERP 서버 .env SGB_SERVICE_TOKEN 에 넣음 · 전 토큰은 바로 무효.
 */
export function ErpLinkBox() {
  const q = useApi<{ tokenSet: boolean; tokenUpdatedAt: string | null; erpUrl: string | null }>('/admin/erp/link');
  const a = useAct();
  const [shown, setShown] = useState<string | null>(null);
  const isSuper = tokenRoles().includes('SUPER');
  if (q.error) return <ErrorView error={q.error} onRetry={q.reload} />;
  if (!q.data) return null;
  const rotate = () => {
    if (!window.confirm(q.data!.tokenSet ? '새 토큰을 만들면 지금 토큰은 바로 쓸 수 없습니다. ERP 서버 .env 도 바꿔야 합니다. 계속할까요?' : 'ERP 서비스 토큰을 만들까요?')) return;
    void a.run('rotate', async () => {
      const r = await api<{ token: string; note: string }>('/admin/erp/service-token', { method: 'POST', body: JSON.stringify({}) });
      setShown(r.token);
      return r;
    }, q.reload, (r) => r.note);
  };
  /* v10.800 (docs/916) — 60초 · 한 번 넘겨주기 코드 → ERP 주소(#/handoff?code=)를 새 창으로 · ERP 주소가 설정되지 않았으면 안내만 */
  const openErp = () => void a.run('open', async () => {
    const r = await api<{ url: string | null; expiresIn: number }>('/admin/erp/handoff', { method: 'POST', body: JSON.stringify({}) });
    if (r.url) window.open(r.url, '_blank', 'noopener');
    return r;
  }, undefined, (r) => r.url ? `ERP 를 새 창으로 열었습니다(코드 ${r.expiresIn}초).` : 'ERP 화면 주소(ERP_WEB_URL)가 아직 설정되지 않았습니다.');
  return (
    <section className="card" data-erp-link={q.data.tokenSet ? 'set' : 'unset'} style={{ margin: '10px 0' }}>
      <b>ERP 연동</b> <small className="dim">ERP(erp.sogaebank.com)가 운영자 로그인을 확인할 때 쓰는 서비스 토큰입니다.</small>
      <div style={{ marginTop: 6 }}>
        서비스 토큰 {q.data.tokenSet ? <b className="form-ok">있음</b> : <span className="warn-text">없음(ERP 로그인 닫힘)</span>}
        {q.data.tokenUpdatedAt && <span className="dim"> · 바꾼 시각 {ymdhm(q.data.tokenUpdatedAt)}</span>}
        {q.data.erpUrl && <span className="dim"> · ERP 주소 {q.data.erpUrl}</span>}
        {' '}{isSuper && <button className="btn-plain" disabled={a.busy === 'rotate'} onClick={rotate} data-erp-rotate>{q.data.tokenSet ? '새 토큰 만들기' : '토큰 만들기'}</button>}
        {' '}<button className="btn-ok" disabled={!q.data.tokenSet || a.busy === 'open'} onClick={openErp} data-erp-open title={q.data.tokenSet ? undefined : '서비스 토큰을 먼저 만드십시오'}>ERP 열기</button>
      </div>
      <Flash msg={a.msg} err={a.err} />
      {shown && (
        <div className="warn-text" data-erp-token-shown style={{ marginTop: 6 }}>
          한 번만 보입니다 — <code className="mono" style={{ userSelect: 'all' }}>{shown}</code>
          {' '}<button className="btn-plain" onClick={() => setShown(null)}>닫기</button>
        </div>
      )}
    </section>
  );
}

import { useEffect, useState } from 'react';
import { api, setToken, ApiFailure } from '../lib';

/* e1.4 (docs/004) 로그인 넘겨받기 — 운영 화면 「ERP 열기」가 준 60초 · 한 번 코드 → ERP API POST /auth/handoff */
export function Handoff({ code, onDone }: { code: string; onDone: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    history.replaceState(null, '', location.pathname);   // 코드를 주소창 · 방문 기록에 남기지 않음
    api<{ accessToken: string }>('/auth/handoff', { method: 'POST', body: JSON.stringify({ code }) })
      .then((r) => { setToken(r.accessToken); onDone(); })
      .catch((e) => setErr(e instanceof ApiFailure ? e.message : '로그인을 넘겨받지 못했습니다.'));
  }, [code, onDone]);
  return (
    <main className="erp-center" data-erp-handoff={err ? 'fail' : 'wait'}>
      {err ? <p className="warn-text">{err}</p> : <p>소개뱅크 운영 화면에서 로그인을 넘겨받는 중입니다…</p>}
    </main>
  );
}

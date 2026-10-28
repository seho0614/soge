'use client';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export interface IdentityResult { success: boolean; stub: boolean }
type Mode = 'STUB' | 'MOCK' | 'NICE';
interface StartRes { mode: Mode; window: { url: string; method: 'POST' | 'GET'; fields: Record<string, string> } }

/**
 * 본인인증 (PASS).
 *
 * 계약·발신 IP 등록에 4~6주가 걸려 그 전까지는 스텁입니다.
 * 서버가 stub: true 를 실어 주므로 화면에 그대로 표시합니다 —
 * "클릭 즉시 통과"가 실동작처럼 보이는 것이 시연 리스크였습니다.
 *
 * v10.141 (D137 · docs/214) — 방식(identity.provider)이 MOCK · NICE 면 「휴대폰 본인확인」이 표준창을 엽니다
 *   (POST /verifications/identity/start → NICE 는 표준창으로 POST · MOCK 은 /verify/mock-nice 로) → /verify/return 에서 끝냄.
 *   방식을 못 읽으면(서버 오류) 지금 단추(STUB)로 — 서버가 409 USE_STANDARD_WINDOW 로 다시 알려 줌.
 */
export function VerifyPanel({ next }: { next?: string | null }) {
  const router = useRouter();
  const t = useTranslations('join.verifyPanel');
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<Mode | null>(null);
  const [res, setRes] = useState<IdentityResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/v1/verifications/identity/mode').then((r) => (r.ok ? r.json() : null))
      .then((d) => setMode(d?.mode === 'MOCK' || d?.mode === 'NICE' ? d.mode : 'STUB')).catch(() => setMode('STUB'));
  }, []);

  function runStub() {
    setErr(null);
    start(async () => {
      try {
        const r = await fetch('/api/v1/verifications/identity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: 'PASS' }),
        });
        const d = await r.json();
        if (r.status === 409 && d.code === 'USE_STANDARD_WINDOW') { setMode('NICE'); setErr(d.message ?? t('failed')); return; }
        if (!r.ok) { setErr(d.message ?? t('failed')); return; }
        setRes(d as IdentityResult);
        router.refresh();
      } catch {
        setErr(t('noServer'));
      }
    });
  }

  function runWindow() {
    setErr(null);
    start(async () => {
      try {
        const r = await fetch('/api/v1/verifications/identity/start', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next ? { next } : {}),
        });
        const d = await r.json();
        if (r.status === 409 && d.code === 'USE_STUB') { setMode('STUB'); setErr(d.message ?? t('failed')); return; }
        if (!r.ok) { setErr(d.message ?? t('failed')); return; }
        openWindow(d as StartRes);
      } catch {
        setErr(t('noServer'));
      }
    });
  }

  if (!mode) return <div className="verify" aria-busy="true" />;
  const windowMode = mode !== 'STUB';
  return (
    <div className="verify" data-verify-mode={mode}>
      <button className="cta-primary" onClick={windowMode ? runWindow : runStub} disabled={pending} data-verify-start={windowMode ? 'window' : 'stub'}>
        {pending ? t('working') : windowMode ? t('submitWindow') : t('submit')}
      </button>
      {windowMode && <p className="hint">{t('windowNote')}</p>}
      {mode === 'MOCK' && <p className="stub-note" data-verify-mock>{t('mockNote')}</p>}

      {err && <p className="form-error" role="alert">{err}</p>}

      {res?.stub && (
        <p className="stub-note">
          {t.rich('stub', { strong: (c) => <strong>{c}</strong> })}
        </p>
      )}
    </div>
  );
}

/** 표준창으로 — NICE 는 POST 폼(같은 창) · MOCK 은 우리 화면으로 GET */
function openWindow(d: StartRes) {
  const { url, method, fields } = d.window;
  if (method === 'GET') { window.location.assign(`${url}?${new URLSearchParams(fields).toString()}`); return; }
  const f = document.createElement('form');
  f.method = 'POST'; f.action = url; f.style.display = 'none';
  for (const [k, v] of Object.entries(fields)) {
    const i = document.createElement('input'); i.type = 'hidden'; i.name = k; i.value = v; f.appendChild(i);
  }
  document.body.appendChild(f); f.submit();
}

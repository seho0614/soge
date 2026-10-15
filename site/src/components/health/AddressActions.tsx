'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { needsLogin } from './util';

/**
 * 배송지 한 줄의 버튼 — 기본으로 · 삭제 (D002)
 *   PATCH  /me/health/addresses/{id}/default
 *   DELETE /me/health/addresses/{id}
 *
 * 진행 중인 주문이 가리키는 배송지는 서버가 막습니다(409 ADDRESS_IN_USE) — 그 사유를 그대로 보여 드립니다.
 * 기본 배송지를 지우면 서버가 가장 최근 배송지를 기본으로 정합니다.
 */
export function AddressActions({ id, isDefault, label }: { id: string; isDefault: boolean; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function run(method: 'PATCH' | 'DELETE', path: string) {
    setErr(null);
    start(async () => {
      const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json' } });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        if (needsLogin(r.status, d?.code)) { router.push('/login'); return; }
        setErr(r.status >= 500 ? '처리하지 못했습니다. 잠시 뒤 다시 시도해 주십시오.' : d?.message ?? '처리하지 못했습니다.');
        return;
      }
      router.refresh();
    });
  }

  const base = `/api/v1/me/health/addresses/${encodeURIComponent(id)}`;
  return (
    <div className="hlt-btns">
      {!isDefault && (
        <button type="button" className="hlt-btn sm" disabled={pending}
          onClick={() => run('PATCH', `${base}/default`)}>기본으로</button>
      )}
      <button type="button" className="hlt-btn sm" disabled={pending}
        onClick={() => { if (confirm(`'${label}' 배송지를 지웁니다.`)) run('DELETE', base); }}>삭제</button>
      {err && <p className="form-error" role="alert">{err}</p>}
    </div>
  );
}

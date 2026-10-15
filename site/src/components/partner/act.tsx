'use client';
/**
 * v10.31 (W5) — 파트너센터 화면의 작은 동작 부품.
 *   api()        브라우저에서 /api/v1/… 를 부르고, 실패하면 서버가 준 사유(message)로 던집니다(화면에서 다시 쓰지 않음).
 *   ActButton    누르면 한 번 부르고(필요하면 먼저 묻고) 화면을 새로 그립니다.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export class ApiErr extends Error { constructor(msg: string, readonly code?: string, readonly status?: number) { super(msg); } }

export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1${url}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() } : { 'Idempotency-Key': crypto.randomUUID() },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiErr(j?.message ?? '처리하지 못했습니다. 잠시 뒤 다시 해 주십시오.', j?.code, res.status);
  return j as T;
}

export function ActButton({ method = 'POST', url, body, ask, label, busyLabel, className = 'pt-bo', done }: {
  method?: string; url: string; body?: unknown; ask?: string; label: string; busyLabel?: string; className?: string; done?: string;
}) {
  const [msg, setMsg] = useState<[ 'ok' | 'err', string ] | null>(null);
  const [busy, setBusy] = useState(false);
  const [, start] = useTransition();
  const router = useRouter();
  async function go() {
    if (ask && !confirm(ask)) return;
    setBusy(true); setMsg(null);
    try {
      const j = await api<any>(method, url, body ?? {});
      setMsg(['ok', done ?? j?.note ?? '처리했습니다.']);
      start(() => router.refresh());
    } catch (e) { setMsg(['err', (e as Error).message]); }
    finally { setBusy(false); }
  }
  return (
    <span className="pt-act" style={{ display: 'inline-flex', flexDirection: 'column', gap: 4 }}>
      <button type="button" className={className} onClick={() => void go()} disabled={busy}>{busy ? (busyLabel ?? '처리 중…') : label}</button>
      {msg && <span className={`pt-msg ${msg[0]}`} role="status">{msg[1]}</span>}
    </span>
  );
}

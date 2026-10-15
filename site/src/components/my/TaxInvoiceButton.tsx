'use client';
/**
 * v10.31 (시안 지급 내역 「미발행」 단추) — 세금계산서는 소개자가 직접 발행합니다(소개뱅크는 대신 발행하지 않음).
 * 발행하신 뒤 여기서 「발행 완료」로 표시합니다(승인번호는 선택). POST /me/settlements/{id}/tax-invoice — 한 번만.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function TaxInvoiceButton({ id }: { id: string }) {
  const r = useRouter();
  const [open, setOpen] = useState(false);
  const [no, setNo] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function mark() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/v1/me/settlements/${encodeURIComponent(id)}/tax-invoice`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(no.trim() ? { no: no.trim() } : {}),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) { setErr(j?.message ?? '표시하지 못했습니다.'); return; }
      r.refresh();
    } catch { setErr('연결하지 못했습니다.'); } finally { setBusy(false); }
  }
  if (!open) {
    return <button type="button" className="my-bo sm" onClick={() => setOpen(true)} data-taxinv={id}
      title="세금계산서는 소개자가 직접 발행합니다 — 플랫폼이 대신 발행하지 않습니다.">미발행</button>;
  }
  return (
    <span className="my-addf" data-taxinv-form={id}>
      <input value={no} onChange={(e) => setNo(e.target.value)} maxLength={40} placeholder="승인번호(선택)" aria-label="세금계산서 승인번호" />
      <button type="button" className="my-bp sm" disabled={busy} onClick={mark}>발행 완료로 표시</button>
      <button type="button" className="my-bo sm" onClick={() => setOpen(false)}>닫기</button>
      {err && <span className="my-ls warnx" role="alert">{err}</span>}
    </span>
  );
}

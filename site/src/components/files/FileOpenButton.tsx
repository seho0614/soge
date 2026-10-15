'use client';
import { useState } from 'react';
import { openFile, fmtSize } from '@/lib/upload';

/**
 * 파일 내려받기 · 열기 버튼 (D007) — GET /files/{id} 로 5분짜리 주소를 받아 엽니다.
 * 주소를 미리 심어 두지 않습니다 — 화면을 오래 열어 두면 만료되기 때문입니다.
 */
export function FileOpenButton({ fileId, name, size, inline = false, label }: {
  fileId: string; name?: string | null; size?: number | null; inline?: boolean; label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    setBusy(true); setErr(null);
    try { await openFile(fileId, inline); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <span className="p2copy">
      <button type="button" className="btn-sm" disabled={busy} onClick={() => void go()} data-file-id={fileId}>
        {busy ? '여는 중…' : (label ?? (inline ? '문서 열기' : '내려받기'))}
      </button>
      {name && <span className="dim"> {name}{size ? ` · ${fmtSize(Number(size))}` : ''}</span>}
      {err && <span className="form-error" role="alert"> {err}</span>}
    </span>
  );
}

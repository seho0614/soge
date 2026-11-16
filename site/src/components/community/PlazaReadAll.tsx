'use client';
/**
 * v10.322 (D222 · docs/449) 소개광장 › 공지 「모두 읽음」 — 로그인 회원 · 안 읽은 공지가 있을 때만.
 *   POST /me/notices/read-all — 읽음 표시만(펼쳐 본 회원 수에는 안 셈 · 요율 변경 공지는 빼고) → 머리줄 공지 점 다시 셈 · 화면 새로 읽음.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function PlazaReadAll({ label, failLabel }: { label: string; failLabel: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  return (
    <span className="plz-ntcra">
      <button type="button" className="btn-plain" disabled={busy} data-plaza-read-all onClick={() => {
        setBusy(true); setErr(false);
        void fetch('/api/v1/me/notices/read-all', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
          .then((r) => { if (!r.ok) throw new Error(String(r.status)); window.dispatchEvent(new Event('sgb:notice-read')); router.refresh(); })
          .catch(() => setErr(true))
          .finally(() => setBusy(false));
      }}>{label}</button>
      {err && <span className="form-error" role="alert" data-plaza-read-all-fail> {failLabel}</span>}
    </span>
  );
}

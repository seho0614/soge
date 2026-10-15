'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { dtKst } from '@/lib/format';

interface Term { code: string; title: string; isRequired: boolean; agreed: boolean; changedAt?: string | null }

/**
 * v10.28 (G-214 · D038) 선택 항목 바꾸기 — 마케팅 · 맞춤형 광고 · 야간 광고 · 위탁 등 선택 약관을 언제든 켜고 끔.
 * 바꿀 때마다 동의 기록이 한 줄씩 쌓이고(지우거나 고치지 않음), 광고 · 알림은 가장 최근 줄을 따릅니다. 필수 약관은 여기서 끌 수 없습니다.
 */
export function OptionalConsents({ terms }: { terms: Term[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const opt = terms.filter((t) => !t.isRequired);
  if (!opt.length) return null;
  async function flip(t: Term) {
    setBusy(t.code); setErr(null); setMsg(null);
    try {
      const r = await fetch('/api/v1/terms/agree', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ code: t.code, agreed: !t.agreed }] }) });
      const d = await r.json().catch(() => null);
      if (!r.ok) { setErr(d?.message ?? '바꾸지 못했습니다.'); return; }
      setMsg(`「${t.title}」을(를) ${t.agreed ? '거부' : '동의'}로 바꿨습니다. 바꾼 기록이 남습니다.`); router.refresh();
    } finally { setBusy(null); }
  }
  return (
    <section className="card" data-optional-consents style={{ margin: '12px 0' }}>
      <h2 style={{ marginTop: 0 }}>선택 항목 바꾸기</h2>
      <table className="tbl">
        <thead><tr><th>항목</th><th>지금</th><th></th><th>마지막으로 바꾼 때</th></tr></thead>
        <tbody>{opt.map((t) => (
          <tr key={t.code} data-opt-row={t.code} data-opt-state={t.agreed ? 'on' : 'off'}>
            <td>{t.title}</td><td><b>{t.agreed ? '동의' : '거부'}</b></td>
            <td><button type="button" className="btn-sm" disabled={busy === t.code} onClick={() => flip(t)} data-opt-flip={t.code}>{t.agreed ? '거부로 바꾸기' : '동의로 바꾸기'}</button></td>
            <td>{/* v10.28 — G-201 규칙: toLocaleString('ko-KR') 은 서버 「PM」 · 브라우저 「오후」로 달라 수화 오류(#418) — 한국 시각 24시간 */}{t.changedAt ? dtKst(t.changedAt) : '—'}</td>
          </tr>))}</tbody>
      </table>
      <p className="hint">바꿀 때마다 기록이 한 줄씩 쌓이고(지우거나 고치지 않음), 광고 · 알림은 가장 최근 기록을 따릅니다. 필수 약관은 여기서 끌 수 없습니다(탈퇴로만).</p>
      {msg && <p className="hint" role="status" data-opt-msg>{msg}</p>}
      {err && <p className="warn-text" role="alert">{err}</p>}
    </section>
  );
}

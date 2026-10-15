'use client';
/**
 * v10.31 (시안 계약 진행 카드 「확인 요청」) — 상대 차례인 계약에 상대에게 알림을 보냅니다(하루 한 번 · 서버가 판정).
 * POST /deals/{거래}/contract/nudge. 서버가 거절하면 그 까닭(내 차례 · 오늘 이미 보냄)을 그대로 보입니다.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function NudgeButton({ dealId, disabled, title }: { dealId: string; disabled?: boolean; title?: string }) {
  const r = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  async function go() {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/v1/deals/${encodeURIComponent(dealId)}/contract/nudge`, { method: 'POST' });
      const j = await res.json().catch(() => null);
      setMsg(res.ok ? { ok: true, t: j?.note ?? '상대방에게 확인 요청을 보냈습니다.' } : { ok: false, t: j?.message ?? '보내지 못했습니다.' });
      if (res.ok) r.refresh();
    } catch { setMsg({ ok: false, t: '연결하지 못했습니다. 잠시 뒤 다시 시도해 주십시오.' }); }
    finally { setBusy(false); }
  }
  return (
    <>
      <button type="button" className="my-bo" disabled={busy || disabled} title={title} onClick={go} data-ctr-nudge={dealId}>
        {busy ? '보내는 중…' : '확인 요청'}
      </button>
      {msg && <span className={`my-ls ${msg.ok ? '' : 'warnx'}`} role="status" data-ctr-nudge-msg="">{msg.t}</span>}
    </>
  );
}

'use client';
/**
 * v10.31 — 받은 제안(시안 scReqDetail 「받은 제안 n건」 · prop 「거절 / 수락하고 대화 시작」).
 *   요청자: 모든 제안 + 수락 · 거절 단추 → POST /api/v1/requests/{id}/proposals/{pid}/decision. 수락하면 그 대화로 갑니다.
 *   제안한 사람: 내 제안만(서버가 거름). 그 밖: 서버가 빈 목록을 줌 — 건수만 보입니다.
 *   이름은 첫 글자만(김OO) · 연락처는 서버가 가린 글 그대로.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ago } from '@/lib/format';

export interface Proposal {
  id: string; proposerName: string; companyName: string | null; relationLabel: string | null;
  message: string | null; status: string; statusLabel: string | null; createdAt: string;
  conversationId: string | null; mine: boolean;
}
const TONE: Record<string, string> = { PROPOSED: 'w2', ACCEPTED: 'a2', REJECTED: 'r2', WITHDRAWN: 'r2' };

export function ProposalList({ requestId, items, owner }: { requestId: string; items: Proposal[]; owner: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function decide(p: Proposal, accept: boolean) {
    if (!accept && !window.confirm('이 제안을 거절하시겠습니까? 거절한 제안은 되돌릴 수 없습니다.')) return;
    setErr(null); setBusy(p.id);
    try {
      const r = await fetch(`/api/v1/requests/${requestId}/proposals/${p.id}/decision`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: accept ? 'ACCEPT' : 'REJECT' }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(b.message ?? '처리하지 못했습니다.'); return; }
      if (accept && b.conversationId) { router.push(`/chat/${b.conversationId}`); return; }
      router.refresh();
    } catch { setErr('연결이 끊겼습니다.'); }
    finally { setBusy(null); }
  }

  return (
    <div>
      {items.map((p) => (
        <div key={p.id} className="w1-prop" data-proposal={p.status}>
          <div className="ph">
            <span className="pn2">{p.companyName ?? p.proposerName}</span>
            {p.companyName && <span className="w1-nt3">{p.proposerName}{p.relationLabel ? ` · ${p.relationLabel}` : ''}</span>}
            <span className={`pst ${TONE[p.status] ?? 'r2'}`}>{p.status === 'PROPOSED' ? (owner ? '수락 대기' : '검토중') : (p.statusLabel ?? p.status)}</span>
            {p.mine && <span className="w1-nt3">내 제안</span>}
            <span className="ptm">{ago(p.createdAt)}</span>
          </div>
          {p.message && <div className="px">{p.message}</div>}
          {owner && p.status === 'PROPOSED' && (
            <div className="pa">
              <button type="button" className="w1-bo sm" disabled={!!busy} onClick={() => decide(p, false)}>거절</button>
              <button type="button" className="w1-bdone" style={{ padding: '7px 14px', fontSize: 13 }} disabled={!!busy}
                onClick={() => decide(p, true)}>{busy === p.id ? '처리 중…' : '수락하고 대화 시작'}</button>
            </div>
          )}
          {p.status === 'ACCEPTED' && p.conversationId && (owner || p.mine) && (
            <div className="pa"><a className="w1-bo sm" href={`/chat/${p.conversationId}`}>대화 열기 →</a></div>
          )}
        </div>
      ))}
      {err && <p className="w1-err" role="alert">{err}</p>}
    </div>
  );
}

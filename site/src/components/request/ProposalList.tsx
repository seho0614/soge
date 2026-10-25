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
import { useFmt } from '@/lib/useFmt';
import { useTranslations } from 'next-intl';

export interface Proposal {
  id: string; proposerName: string; companyName: string | null; relationLabel: string | null;
  message: string | null; status: string; statusLabel: string | null; createdAt: string;
  conversationId: string | null; mine: boolean;
}
const TONE: Record<string, string> = { PROPOSED: 'w2', ACCEPTED: 'a2', REJECTED: 'r2', WITHDRAWN: 'r2' };

export function ProposalList({ requestId, items, owner }: { requestId: string; items: Proposal[]; owner: boolean }) {
  const router = useRouter();
  const t = useTranslations('request.proposals');
  const f = useFmt();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function decide(p: Proposal, accept: boolean) {
    if (!accept && !window.confirm(t('rejectConfirm'))) return;
    setErr(null); setBusy(p.id);
    try {
      const r = await fetch(`/api/v1/requests/${requestId}/proposals/${p.id}/decision`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: accept ? 'ACCEPT' : 'REJECT' }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(b.message ?? t('errDecide')); return; }
      if (accept && b.conversationId) { router.push(`/chat/${b.conversationId}`); return; }
      router.refresh();
    } catch { setErr(t('errNetwork')); }
    finally { setBusy(null); }
  }

  return (
    <div>
      {items.map((p) => (
        <div key={p.id} className="w1-prop" data-proposal={p.status}>
          <div className="ph">
            <span className="pn2">{p.companyName ?? p.proposerName}</span>
            {p.companyName && <span className="w1-nt3">{p.proposerName}{p.relationLabel ? ` · ${p.relationLabel}` : ''}</span>}
            <span className={`pst ${TONE[p.status] ?? 'r2'}`}>{p.status === 'PROPOSED' ? (owner ? t('awaiting') : t('reviewing')) : (p.statusLabel ?? p.status)}</span>
            {p.mine && <span className="w1-nt3">{t('mine')}</span>}
            <span className="ptm">{f.ago(p.createdAt, ago(p.createdAt))}</span>
          </div>
          {p.message && <div className="px">{p.message}</div>}
          {owner && p.status === 'PROPOSED' && (
            <div className="pa">
              <button type="button" className="w1-bo sm" disabled={!!busy} onClick={() => decide(p, false)}>{t('reject')}</button>
              <button type="button" className="w1-bdone" style={{ padding: '7px 14px', fontSize: 13 }} disabled={!!busy}
                onClick={() => decide(p, true)}>{busy === p.id ? t('processing') : t('accept')}</button>
            </div>
          )}
          {p.status === 'ACCEPTED' && p.conversationId && (owner || p.mine) && (
            <div className="pa"><a className="w1-bo sm" href={`/chat/${p.conversationId}`}>{t('openChat')}</a></div>
          )}
        </div>
      ))}
      {err && <p className="w1-err" role="alert">{err}</p>}
    </div>
  );
}

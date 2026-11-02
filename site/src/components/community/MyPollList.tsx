'use client';
/**
 * v10.177 (D166 · docs/275) — 내가 만든 투표. 마감하기(POST …/close) · 지우기(DELETE — 표가 없을 때만).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ymdKst } from '@/lib/format';
import type { Poll } from './poll';

export interface MyPoll extends Poll { createdAt: string; reportHidden: boolean }

export function MyPollList({ polls }: { polls: MyPoll[] }) {
  const t = useTranslations('plaza');
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function act(id: string, how: 'close' | 'delete') {
    if (!confirm(how === 'close' ? t('pollMine.confirmClose') : t('pollMine.confirmDelete'))) return;
    setBusy(id); setErr(null);
    const r = await fetch(`/api/v1/community/my-polls/${encodeURIComponent(id)}${how === 'close' ? '/close' : ''}`,
      { method: how === 'close' ? 'POST' : 'DELETE', headers: { 'Content-Type': 'application/json' }, body: how === 'close' ? '{}' : undefined }).catch(() => null);
    const b = r ? await r.json().catch(() => null) as { message?: string } | null : null;
    setBusy(null);
    if (!r?.ok) { setErr(b?.message ?? t('pollNew.fail')); return; }
    router.refresh();
  }

  return (
    <div className="poll-mine">
      {err && <p className="form-error" role="alert">{err}</p>}
      {polls.map((p) => (
        <article key={p.id} data-my-poll={p.id} data-state={p.state}>
          <div className="poll-top">
            <span className="poll-kind">{t(p.kind === 'USED' ? 'poll.kind.USED' : 'poll.kind.ASK')}</span>
            <span className="poll-state">{p.state === 'HIDDEN' ? '' : p.open ? t('pollMine.open') : t('pollMine.closed')} · {t('pollMine.made', { date: ymdKst(p.createdAt) })}</span>
          </div>
          <h2>{p.title}</h2>
          {p.state === 'HIDDEN' && <p className="poll-msg err" data-hidden="">{p.reportHidden ? t('pollMine.hidden') : t('pollMine.hiddenAdmin')}</p>}
          <p className="dim">{p.options.map((o) => `${o.label} ${o.votes}`).join(' · ')} — {t('pollMine.votes', { n: p.total.toLocaleString('ko-KR') })}</p>
          <div className="acts">
            {p.open && <button type="button" className="btn-sm" disabled={busy === p.id} onClick={() => void act(p.id, 'close')} data-my-close="">{t('pollMine.close')}</button>}
            {p.total === 0 && p.state !== 'HIDDEN' && <button type="button" className="btn-sm" disabled={busy === p.id} onClick={() => void act(p.id, 'delete')} data-my-delete="">{t('pollMine.delete')}</button>}
          </div>
        </article>
      ))}
    </div>
  );
}

'use client';
/**
 * v10.504 (D273 · docs/642) SB-MYP-MBX-050 회원 대화 — 브라우저 부품
 *   GET /me/dm/{id}(20초마다 새로 · 읽음 표시) · POST /me/dm/check(보내기 전 확인) · POST /me/dm/{id}/messages(confirm)
 *   POST /me/dm/{id}/block · POST /me/dm/{id}/report
 *   경고 상자(시안 scAsk 「수정하겠습니다 · 그래도 보내기」와 같은 모양): MASK 면 가려서 보냄 · BLOCK 이면 보낼 수 없음
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

interface Msg { id: string; body: string; masked: boolean; hitCodes: string[]; readAt: string | null; createdAt: string; mine: boolean }
export interface DmThread {
  id: string; basisType: string; title: string | null; mySide: string | null; otherName: string; status: string; lockedReason: string | null;
  blocked: boolean; blockedByMe: boolean; reportedByMe: boolean; enabled: boolean; patternMode: 'WARN' | 'MASK' | 'BLOCK'; retentionDays: number; messages: Msg[];
}
interface Reason { code: string; label: string; hits?: string[] }
const REASONS = ['OFF_PLATFORM', 'FRAUD', 'ABUSE', 'SPAM', 'PRIVACY', 'OTHER'] as const;
type ReasonCode = (typeof REASONS)[number];
const HITS = ['PHONE', 'EMAIL', 'ACCOUNT', 'OFF_PLATFORM'] as const;
type HitCode = (typeof HITS)[number];
const hitOf = (c: string): HitCode => ((HITS as readonly string[]).includes(c) ? (c as HitCode) : 'OFF_PLATFORM');

export function DmRoom({ initial }: { initial: DmThread }) {
  const t = useTranslations('mbx.room');
  const [th, setTh] = useState<DmThread>(initial);
  const [body, setBody] = useState('');
  const [warn, setWarn] = useState<{ mode: string; reasons: Reason[]; preview?: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rep, setRep] = useState<{ open: boolean; reason: ReasonCode; detail: string }>({ open: false, reason: 'OFF_PLATFORM', detail: '' });
  const box = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    const r = await fetch(`/api/v1/me/dm/${th.id}`).catch(() => null);
    if (r && r.ok) setTh(await r.json() as DmThread);
  }, [th.id]);
  useEffect(() => { const h = window.setInterval(() => void reload(), 20000); return () => window.clearInterval(h); }, [reload]);
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }); }, [th.messages.length]);

  const canSend = th.enabled && th.status === 'OPEN' && !th.blocked;

  async function send(confirm: boolean) {
    const text = body.trim();
    if (!text) return;
    setBusy(true); setMsg(null);
    try {
      if (!confirm) {
        /* 보내기 전 확인 — 저장하지 않음 */
        const c = await fetch('/api/v1/me/dm/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: text }) });
        const cd = await c.json().catch(() => null) as { warn?: boolean; mode?: string; reasons?: Reason[]; preview?: string } | null;
        if (cd?.warn) { setWarn({ mode: cd.mode ?? th.patternMode, reasons: cd.reasons ?? [], preview: cd.preview }); return; }
      }
      const r = await fetch(`/api/v1/me/dm/${th.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: text, confirm }) });
      const d = await r.json().catch(() => null) as { code?: string; message?: string; details?: { mode?: string; reasons?: Reason[] } } | null;
      if (!r.ok) {
        if (d?.code === 'MBX_DM_WARN') { setWarn({ mode: d.details?.mode ?? th.patternMode, reasons: d.details?.reasons ?? [] }); return; }
        setMsg(d?.code === 'MBX_DM_BLOCKED' ? t('blockedPattern') : d?.message ?? t('failed'));
        return;
      }
      setBody(''); setWarn(null);
      await reload();
    } finally { setBusy(false); }
  }

  async function block(on: boolean) {
    setMsg(null);
    if (on && !window.confirm(t('blockConfirm'))) return;
    const r = await fetch(`/api/v1/me/dm/${th.id}/block`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on }) });
    const d = await r.json().catch(() => null) as { message?: string; note?: string } | null;
    setMsg(r.ok ? d?.note ?? null : d?.message ?? t('failed'));
    await reload();
  }

  async function report() {
    setMsg(null);
    const r = await fetch(`/api/v1/me/dm/${th.id}/report`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: rep.reason, detail: rep.detail.trim() || undefined }) });
    const d = await r.json().catch(() => null) as { message?: string; note?: string } | null;
    if (!r.ok) { setMsg(d?.message ?? t('failed')); return; }
    setRep({ open: false, reason: 'OFF_PLATFORM', detail: '' }); setMsg(t('reported'));
    await reload();
  }

  return (
    <div className="mbx-wrap" data-mbx-room={th.id}>
      <h1 className="mbx-h1">{th.otherName} · {th.title ?? '—'}</h1>
      <p className="mbx-sub">{th.basisType === 'DEAL' ? t('basisDeal') : t('basisInquiry')} · {t('retention', { days: String(th.retentionDays) })}</p>
      <p className="mbx-note warn" data-mbx-room-notice="">{t('notice')}</p>
      {th.status === 'LOCKED' && <p className="mbx-note warn" data-mbx-room-locked="">{t('locked', { why: th.lockedReason ?? '' })}</p>}
      {th.blocked && <p className="mbx-note" data-mbx-room-blocked="">{th.blockedByMe ? t('blockedByMe') : t('blockedByOther')}</p>}
      {!th.enabled && <p className="mbx-note">{t('off')}</p>}
      {msg && <p className="mbx-note" role="status">{msg}</p>}

      <div className="mbx-room" ref={box} data-mbx-room-msgs={th.messages.length}>
        {th.messages.length === 0 ? <p className="mbx-sub">{t('empty')}</p> : th.messages.map((m) => (
          <div key={m.id} className={`mbx-bub${m.mine ? ' mine' : ''}`} data-mbx-msg={m.mine ? 'mine' : 'other'}>
            {m.body}
            <small suppressHydrationWarning>{new Date(m.createdAt).toLocaleString(undefined, { timeZone: 'Asia/Seoul', hour12: false })}
              {m.masked ? ` · ${t('masked')}` : ''}{m.mine && m.readAt ? ` · ${t('read')}` : ''}</small>
          </div>
        ))}
      </div>

      {canSend && (
        <>
          <div className="mbx-form">
            <textarea value={body} maxLength={1000} onChange={(e) => { setBody(e.target.value); setWarn(null); }} placeholder={t('placeholder')} aria-label={t('placeholder')} data-mbx-input="" />
            <button type="button" className="mbx-btn pri" disabled={busy || !body.trim()} onClick={() => void send(false)} data-mbx-send="">{t('send')}</button>
          </div>
          {warn && (
            <div className="mbx-warn" role="alert" data-mbx-warn={warn.mode}>
              <b>{t('warnHead')}</b>
              <ul>{warn.reasons.map((r) => <li key={r.code}>{t(('hit.' + hitOf(r.code)) as `hit.${HitCode}`)}{r.hits?.length ? ` — ${r.hits.join(', ')}` : ''}</li>)}</ul>
              <p>{warn.mode === 'BLOCK' ? t('warnBlock') : warn.mode === 'MASK' ? t('warnMask') : t('warnPlain')}</p>
              <div className="mbx-row">
                <button type="button" className="mbx-btn" onClick={() => setWarn(null)} data-mbx-warn-fix="">{t('fix')}</button>
                {warn.mode !== 'BLOCK' && <button type="button" className="mbx-btn" disabled={busy} onClick={() => void send(true)} data-mbx-warn-send="">{t('sendAnyway')}</button>}
              </div>
            </div>
          )}
        </>
      )}

      <div className="mbx-row">
        {(!th.blocked || th.blockedByMe) && (
          <button type="button" className="mbx-btn" onClick={() => void block(!th.blockedByMe)} data-mbx-block={th.blockedByMe ? 'off' : 'on'}>{th.blockedByMe ? t('unblock') : t('block')}</button>
        )}
        {!th.reportedByMe && <button type="button" className="mbx-btn" onClick={() => setRep({ ...rep, open: !rep.open })} data-mbx-report-open="">{t('report')}</button>}
        {th.reportedByMe && <span className="mbx-badge">{t('reportedBadge')}</span>}
      </div>
      {rep.open && (
        <div className="mbx-warn" data-mbx-report-form="">
          <b>{t('reportHead')}</b>
          <div className="mbx-row">
            <select value={rep.reason} onChange={(e) => setRep({ ...rep, reason: e.target.value as ReasonCode })} aria-label={t('reportHead')} data-mbx-report-reason="">
              {REASONS.map((c) => <option key={c} value={c}>{t(('reason.' + c) as `reason.${ReasonCode}`)}</option>)}
            </select>
            <input value={rep.detail} maxLength={500} onChange={(e) => setRep({ ...rep, detail: e.target.value })} placeholder={t('reportDetail')} aria-label={t('reportDetail')} data-mbx-report-detail="" />
            <button type="button" className="mbx-btn pri" onClick={() => void report()} disabled={rep.reason === 'OTHER' && rep.detail.trim().length < 2} data-mbx-report-send="">{t('reportSend')}</button>
          </div>
          <p className="mbx-sub">{t('reportNote')}</p>
        </div>
      )}
    </div>
  );
}

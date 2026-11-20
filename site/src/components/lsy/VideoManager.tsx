'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { uploadFile, UploadError, type UploadPurpose } from '@/lib/upload';

export interface VideoItem { id: string; title: string; status: string; listingNo: number; videoId: string | null; videoState: string | null; durationMs: number | null; rejectReason: string | null; photoWarn: number }
export interface VideoPolicy { on: boolean; maxMb: number; maxSec: number; photoCheck: boolean }

async function call(path: string, method: string, body?: unknown) {
  const r = await fetch(`/api/v1${path}`, { method, cache: 'no-store', headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : '{}' });
  const b = (await r.json().catch(() => ({}))) as { message?: string; note?: string };
  return { ok: r.ok, body: b };
}

/**
 * v10.526 (D279) 매물 하나의 동영상 — MP4 고르기 → 기존 파일 올리기(LISTING_VIDEO) → 붙이기(검수 대기) · 빼기
 *   v10.525 사진 점검 경고 수(있으면 「사진 점검 보기」로 자세히)
 */
export function VideoRow({ item, policy }: { item: VideoItem; policy: VideoPolicy }) {
  const t = useTranslations('lsy');
  const router = useRouter();
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [checks, setChecks] = useState<{ labels: string[] }[] | null>(null);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setErr(null); setMsg(null);
    if (f.size > policy.maxMb * 1024 * 1024) { setErr(t('tooBig', { mb: String(policy.maxMb) })); return; }
    try {
      setBusy('up');
      const up = await uploadFile(f, 'LISTING_VIDEO' as string as UploadPurpose, (s) => setMsg(s));
      const r = await call(`/me/lsy/listings/${item.id}/video`, 'POST', { fileId: up.fileId });
      if (!r.ok) { setErr(r.body.message ?? t('fail')); setMsg(null); return; }
      setMsg(t('attached')); router.refresh();
    } catch (e) {
      setErr(e instanceof UploadError ? e.message : t('fail')); setMsg(null);
    } finally { setBusy(''); }
  };
  const remove = async () => {
    if (!window.confirm(t('removeAsk'))) return;
    setBusy('rm'); setErr(null);
    const r = await call(`/me/lsy/listings/${item.id}/video`, 'DELETE');
    setBusy('');
    if (!r.ok) { setErr(r.body.message ?? t('fail')); return; }
    setMsg(t('removed')); router.refresh();
  };
  const showChecks = async () => {
    const r = await fetch(`/api/v1/me/lsy/listings/${item.id}/photo-checks`, { cache: 'no-store' });
    const b = (await r.json().catch(() => ({}))) as { items?: { labels: string[] }[] };
    setChecks(b.items ?? []);
  };
  /* 열쇠는 글자 그대로(next build 형 검사 — 템플릿 열쇠 금지) */
  const STATE: Record<string, string> = { PENDING: t('statePENDING'), APPROVED: t('stateAPPROVED') };
  const state = item.videoState ? (STATE[item.videoState] ?? item.videoState) : t('stateNONE');
  return (
    <div className="my-lrow" data-lsy-video-row={item.id}>
      <b className="my-lt">L-{item.listingNo} {item.title}</b>
      <p>{t('videoState')}: <span data-lsy-video-state={item.videoState ?? 'NONE'}>{state}</span>
        {item.durationMs ? ` · ${t('seconds', { sec: (item.durationMs / 1000).toFixed(1) })}` : ''}
        {!item.videoState && item.rejectReason ? ` · ${t('lastReject', { reason: item.rejectReason })}` : ''}</p>
      {policy.on && (
        <p>
          <label className="btn-sm">{busy === 'up' ? t('uploading') : item.videoState ? t('replace') : t('add')}
            <input type="file" accept="video/mp4" hidden disabled={!!busy} onChange={(e) => void pick(e.target.files?.[0])} data-lsy-video-file={item.id} />
          </label>{' '}
          {item.videoState && <button type="button" className="btn-sm" disabled={!!busy} onClick={() => void remove()} data-lsy-video-remove={item.id}>{t('remove')}</button>}
        </p>
      )}
      {policy.photoCheck && (
        <p>{t('photoWarn', { n: String(item.photoWarn) })}{' '}
          {item.photoWarn > 0 && <button type="button" className="btn-sm" onClick={() => void showChecks()} data-lsy-photo-checks={item.id}>{t('photoShow')}</button>}</p>
      )}
      {checks && <ul data-lsy-photo-list="">{checks.map((c, i) => <li key={i}>{t('photoN', { n: String(i + 1) })}: {c.labels.join(' · ') || t('photoOk')}</li>)}</ul>}
      {msg && <p role="status">{msg}</p>}
      {err && <p role="alert" className="warn-text">{err}</p>}
    </div>
  );
}

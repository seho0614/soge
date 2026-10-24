'use client';
/**
 * v10.31 (w2) — 매물 상세의 「내 매물 관리」(주인에게만): 사진 올리기 · 떼기(시안 큰 사진 「1/5」) · 급구 · 급매 신청(시안 급구 · 급매 화면).
 *   사진: POST /files(LISTING_IMAGE) → PUT → complete → POST /listings/{id}/photos · DELETE /listings/{id}/photos/{mediaId}
 *   급구 · 급매: POST /listings/{id}/badges {type, reason, until} → 운영 배지 심사 → 표시(기한이 지나면 자동 해제)
 *   사진은 재검수를 걸지 않습니다(내용 변경이 아님). 제목 · 금액 · 한줄 소개를 바꾸려면 수정(재검수)입니다.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { uploadFile, UploadError } from '@/lib/upload';

export function GwOwnerTools({ id, mediaIds, mediaUrls, urgent, published }: {
  id: string; mediaIds: string[]; mediaUrls: string[]; urgent?: { label: string; until: string } | null; published: boolean;
}) {
  const router = useRouter();
  const t = useTranslations('detail.owner');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState('URGENT');
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState(() => new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10));

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true); setMsg('');
    try {
      for (const f of Array.from(files).slice(0, Math.max(0, 10 - mediaIds.length))) {
        const up = await uploadFile(f, 'LISTING_IMAGE', (s) => setMsg(`${f.name} — ${s}`));
        const r = await fetch(`/api/v1/listings/${id}/photos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId: up.fileId }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new UploadError(j.message ?? t('attachFail'), r.status, j.code);
      }
      setMsg(t('uploaded')); router.refresh();
    } catch (e) { setMsg(e instanceof Error ? e.message : t('uploadFail')); }
    setBusy(false);
  }
  async function removePhoto(mid: string) {
    const r = await fetch(`/api/v1/listings/${id}/photos/${mid}`, { method: 'DELETE' });
    if (r.ok) router.refresh(); else setMsg((await r.json().catch(() => ({}))).message ?? t('detachFail'));
  }
  async function badge() {
    if (reason.trim().length < 5) { setMsg(t('reasonShort')); return; }
    const r = await fetch(`/api/v1/listings/${id}/badges`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, reason: reason.trim(), until: `${until}T23:59:59+09:00` }) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? (j.note ?? t('applied')) : j.message ?? t('applyFail'));
    if (r.ok) router.refresh();
  }
  return (
    <div className="gw-panel gw-owner" data-owner-tools="" style={{ marginTop: 14 }}>
      <div className="gw-sh2" style={{ padding: '0 0 10px' }}><b>{t('head')}</b><span className="gw-ls">{t.rich('onlyOwner', { edit: (c) => <Link href={`/listings/${id}/edit`}>{c}</Link> })}</span></div>
      <div className="gw-dsec" style={{ padding: 0 }}><h4>{t('photos', { n: String(mediaIds.length) })}</h4>
        <div className="gw-ophotos">
          {mediaUrls.map((u, i) => (
            <span key={mediaIds[i] ?? u} className="gw-oph">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt={t('photoAlt', { n: String(i + 1) })} />
              {mediaIds[i] && <button type="button" className="gw-bo gw-sm" onClick={() => void removePhoto(mediaIds[i]!)}>{t('detach')}</button>}
            </span>
          ))}
          {mediaIds.length < 10 && (
            <label className="gw-bo gw-sm gw-opadd">{busy ? t('uploading') : t('upload')}
              <input type="file" accept="image/jpeg,image/png" multiple hidden disabled={busy} onChange={(e) => void addPhotos(e.target.files)} /></label>
          )}
        </div>
        <p className="gw-ls">{t('photoNote')}</p>
      </div>
      <div className="gw-dsec" style={{ padding: 0, marginTop: 10 }}><h4>{t('urgentHead')} {urgent ? t('urgentNow', { label: urgent.label, until: urgent.until.slice(0, 10) }) : ''}</h4>
        {!published ? <p className="gw-ls">{t('onlyPublished')}</p> : (
          <div className="gw-inl" style={{ flexWrap: 'wrap', gap: 8 }}>
            <select className="gw-inp" style={{ flex: 'none', width: 'auto' }} aria-label={t('kindAria')} value={type} onChange={(e) => setType(e.target.value)}>
              <option value="URGENT">{t('optUrgent')}</option><option value="URGENT_SALE">{t('optSale')}</option></select>
            <input className="gw-inp" aria-label={t('reasonAria')} placeholder={t('reasonPh')} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
            <input className="gw-inp" style={{ flex: 'none', width: 'auto' }} type="date" aria-label={t('untilAria')} value={until} onChange={(e) => setUntil(e.target.value)} />
            <button type="button" className="gw-bp gw-sm" onClick={() => void badge()}>{t('apply')}</button>
          </div>
        )}
        <p className="gw-ls">{t('rules')}</p>
      </div>
      {msg && <p className="gw-barmsg" role="status">{msg}</p>}
    </div>
  );
}

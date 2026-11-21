'use client';
/**
 * v10.611 (docs/753) ㉗ 내 문의 내역 — 문의마다 「사진」 펼치기
 *   펼칠 때만 GET /api/v1/me/bzx/inquiries/{id}/photos(내가 더한 사진 · 운영 답변 사진) · 사진은 같은 주소 아래 바이트(로그인 쿠키)
 *   더 붙이기: 기능이 켜져 있고(bzx.inquiry_photos) 닫히지 않은 문의만 — POST /files(INQUIRY_ATTACHMENT) → POST …/photos
 *   글자는 이 파일 안 두 언어(ko · en) — 사전 묶음(index.ts)을 고치지 않으려고(다른 묶음과 겹침 없게 · NOTES)
 */
import { useState } from 'react';
import { useLocale } from 'next-intl';
import { uploadFile } from '@/lib/upload';

interface Ph { fileId: string; side: string; name: string; url: string }
interface Res { on: boolean; canAdd: boolean; max: number; items: Ph[]; attached: number }

const TXT = {
  ko: { open: '사진', mine: '내가 더한 사진', staff: '답변 사진', none: '더한 사진이 없습니다.', add: '사진 더 붙이기(JPG · PNG · 한 번에 3장)', busy: '올리는 중…', fail: '사진을 붙이지 못했습니다.', full: '사진은 문의마다 {n}장까지입니다.' },
  en: { open: 'Photos', mine: 'Photos I added', staff: 'Photos from our reply', none: 'No photos added.', add: 'Add photos (JPG or PNG, up to 3 at a time)', busy: 'Uploading…', fail: 'The photos could not be attached.', full: 'Up to {n} photos per inquiry.' },
};

export function InquiryPhotos({ id, closed }: { id: string; closed?: boolean }) {
  const t = TXT[useLocale() === 'ko' ? 'ko' : 'en'];
  const [d, setD] = useState<Res | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = async () => {
    const r = await fetch(`/api/v1/me/bzx/inquiries/${id}/photos`).catch(() => null);
    if (r?.ok) setD((await r.json()) as Res);
  };
  const add = async (files: FileList | null) => {
    const list = Array.from(files ?? []).slice(0, 3);
    if (!list.length) return;
    setBusy(true); setErr(null);
    try {
      const ids: string[] = [];
      for (const f of list) ids.push((await uploadFile(f, 'INQUIRY_ATTACHMENT')).fileId);
      const r = await fetch(`/api/v1/me/bzx/inquiries/${id}/photos`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fileIds: ids }) });
      if (!r.ok) { const b = (await r.json().catch(() => null)) as { message?: string } | null; setErr(b?.message ?? t.fail); }
      await load();
    } catch { setErr(t.fail); } finally { setBusy(false); }
  };
  const mine = (d?.items ?? []).filter((x) => x.side === 'MEMBER');
  const staff = (d?.items ?? []).filter((x) => x.side === 'STAFF');
  const row = (list: Ph[]) => list.map((x) => (
    <a key={x.fileId} href={x.url} target="_blank" rel="noopener noreferrer" data-inq-photo={x.side}>
      <img src={x.url} alt={x.name} width={72} height={72} style={{ objectFit: 'cover', borderRadius: 7, marginRight: 6 }} />
    </a>
  ));
  return (
    <details className="w1-ls" data-inq-photos={id} onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open && !d) void load(); }}>
      <summary>{t.open}{d ? ` ${d.items.length}` : ''}</summary>
      {d && (
        <div>
          {staff.length > 0 && <p>{t.staff}<br />{row(staff)}</p>}
          {mine.length > 0 && <p>{t.mine}<br />{row(mine)}</p>}
          {!d.items.length && <p>{t.none}</p>}
          {d.on && d.canAdd && !closed && (mine.length < d.max
            ? <label className="w1-bo">{busy ? t.busy : t.add}<input type="file" accept="image/jpeg,image/png" multiple hidden disabled={busy} onChange={(e) => void add(e.target.files)} data-inq-photo-add="" /></label>
            : <p>{t.full.replace('{n}', String(d.max))}</p>)}
          {err && <p role="alert">{err}</p>}
        </div>
      )}
    </details>
  );
}

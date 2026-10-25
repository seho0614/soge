'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { uploadFile, guessType, UploadError } from '@/lib/upload';
import { useTranslations } from 'next-intl';

type Err = { code?: string; message?: string; note?: string; ok?: boolean } | null;

/**
 * 본인 소유 부동산 초안 등록 — POST /listings (gwanCode=MAL 고정)
 *
 * ★ 초안(검수 중)은 공개가 아니라 통과합니다. **공개할 때** DB(fn_broker_gate)가
 *   중개사 인증 또는 등기 확인(소유 확인 VERIFIED)을 봅니다 — 그래서 올린 직후 소유 확인으로 보냅니다.
 * ★ 설명(body)을 받지 않습니다. 설명이 30자 이상이면 자동검수가 곧바로 공개(PUBLISHED)로 넣으려 하고,
 *   소유 확인 전이라 DB 가 422 "소유 확인이 먼저입니다" 로 막아 **초안조차 못 만듭니다**(2026-10-02 실측).
 *   설명은 소유 확인이 끝난 뒤 매물 수정에서 적으시게 합니다. (백엔드 결함으로 보고)
 */
export function OwnerListingForm({ categories }: { categories: { id: string; name: string }[] }) {
  const router = useRouter();
  const t = useTranslations('join.brokerForms');
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const title = String(fd.get('title') ?? '').trim();
    setErr(null);
    if (title.length < 5) { setErr(t('titleMin')); return; }
    start(async () => {
      const r = await fetch('/api/v1/listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          gwanCode: 'MAL',
          categoryId: String(fd.get('categoryId')),
          title,
          desiredFee: Number(fd.get('desiredFee')) || undefined,
          feeBearer: 'SELLER',
        }),
      });
      const d = (await r.json().catch(() => null)) as (Err & { listingId?: string }) | null;
      if (r.status === 401) { router.push('/login'); return; }
      if (!r.ok || !d?.listingId) { setErr(d?.message ?? t('createFail')); return; }
      router.push(`/mal/brokers?mine=${d.listingId}&created=1#own`);
      router.refresh();
    });
  }

  return (
    <form className="card p2pad p2form" onSubmit={submit}>
      <label className="fld"><span>{t('category')}</span>
        <select name="categoryId" required defaultValue={categories[0]?.id}>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label className="fld"><span>{t('title')}</span><input name="title" minLength={5} maxLength={100} required placeholder={t('titlePh')} /></label>
      <p className="hint">{t.rich('bodyLater', { b: (c) => <b>{c}</b> })}</p>
      <label className="fld"><span>{t('fee')}</span><input name="desiredFee" type="number" min={0} step={10000} placeholder={t('feePh')} />
        <em>{t('feeNote')}</em></label>
      {err && <p className="form-error" role="alert">{err}</p>}
      <div className="p2act"><button className="btn-sm p2primary" disabled={pending}>{pending ? t('uploading') : t('createSubmit')}</button></div>
    </form>
  );
}

/**
 * 등기사항증명서 제출 — POST /files → PUT → complete → POST /me/listings/{id}/ownership { fileId }
 *   (제출이 실패하면 DELETE /files/{id} 로 올린 파일을 치웁니다)
 *
 * ★ 발급일이 30일을 넘으면 받지 않습니다 — 그 사이 소유권이 이전됐을 수 있습니다.
 *   판정은 DB 트리거가 하지만 미리 알려 드립니다.
 * ★ D007 — 실제 파일(PDF · JPG · PNG, 10MB 이하)을 올립니다. 운영이 그 문서를 열어 보고 판단합니다.
 *   형식은 서버가 파일 앞부분으로 다시 판정합니다 — 확장자만 바꾼 파일은 거절됩니다.
 */
const DOC_MAX = 10 * 1024 * 1024;
const DOC_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

export function OwnershipForm({ listingId }: { listingId: string }) {
  const router = useRouter();
  const t = useTranslations('join.brokerForms');
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [step, setStep] = useState<string | null>(null);
  /* 10/2 — 한국 날짜로. toISOString 은 UTC 라 0~9시(KST)에는 어제가 되어 오늘 발급본을 고를 수 없었습니다 */
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const file = fd.get('doc');
    const issuedOn = String(fd.get('issuedOn') ?? '');
    setMsg(null);
    if (!(file instanceof File) || file.size === 0) { setMsg({ ok: false, t: t('needFile') }); return; }
    if (!DOC_TYPES.includes(guessType(file))) { setMsg({ ok: false, t: t('badType') }); return; }
    if (file.size > DOC_MAX) { setMsg({ ok: false, t: t('tooBig') }); return; }
    const age = (Date.now() - new Date(issuedOn).getTime()) / 86_400_000;
    if (!issuedOn || age < -1) { setMsg({ ok: false, t: t('badDate') }); return; }
    if (age > 30) { setMsg({ ok: false, t: t('tooOld') }); return; }
    start(async () => {
      let up;
      try {
        up = await uploadFile(file, 'OWNERSHIP_DOC', setStep);
      } catch (err) {
        setStep(null);
        if (err instanceof UploadError && err.status === 403 && err.code === 'UNAUTHENTICATED') { router.push('/login'); return; }
        setMsg({ ok: false, t: (err as Error).message }); return;
      }
      setStep(t('submitting'));
      const r = await fetch(`/api/v1/me/listings/${listingId}/ownership`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: up.fileId, issuedOn, hasEncumbrance: fd.get('hasEncumbrance') === 'on' }),
      });
      setStep(null);
      const d = (await r.json().catch(() => null)) as Err;
      /* 제출이 안 됐으면 올린 파일을 치웁니다 — 쓰이지 않은 등기부가 남지 않게 (DELETE /files/{id}) */
      if (!r.ok || d?.ok === false) void fetch(`/api/v1/files/${up.fileId}`, { method: 'DELETE' }).catch(() => undefined);
      if (r.status === 401) { router.push('/login'); return; }
      if (!r.ok) { setMsg({ ok: false, t: d?.message ?? t('submitFail') }); return; }
      if (d?.ok === false) { setMsg({ ok: false, t: d.note ?? t('submitFailShort') }); return; }
      setMsg({ ok: true, t: d?.note ?? t('received') });
      router.refresh();
    });
  }

  return (
    <form className="card p2pad p2form" onSubmit={submit}>
      <label className="fld"><span>{t('doc')}</span>
        <input name="doc" type="file" required accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" />
        <em>{t('docNote')}</em>
      </label>
      <label className="fld"><span>{t('issuedOn')}</span><input name="issuedOn" type="date" max={today} required />
        <em>{t('issuedNote')}</em></label>
      <label className="chk"><input type="checkbox" name="hasEncumbrance" /> {t('encumbrance')}</label>
      {step && <p className="dim" role="status">{step}</p>}
      {msg && <p className={msg.ok ? 'ok-note' : 'form-error'} role={msg.ok ? 'status' : 'alert'}>{msg.t}</p>}
      <div className="p2act"><button className="btn-sm p2primary" disabled={pending}>{pending ? t('submittingShort') : t('ownSubmit')}</button></div>
    </form>
  );
}

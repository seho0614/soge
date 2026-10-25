'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

interface Category { id: string; gwanCode: string; name: string; feeBearer: string | null }
interface Result { listingId: string; status: string; autoApproved: boolean }

/**
 * 매물 등록.
 *
 * 제한업종·금칙어·슬롯 한도는 서버(DB)가 판정합니다.
 * 여기서 다시 검사하지 않고, 422 message 를 그대로 보여 줍니다.
 */
export function RegisterForm({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const t = useTranslations('forms');
  const [pending, start] = useTransition();
  const [done, setDone] = useState<Result | null>(null);
  const [err, setErr] = useState<{ code: string; message: string } | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const categoryId = String(fd.get('categoryId') ?? '');
    const cat = categories.find((c) => c.id === categoryId);
    setErr(null);
    start(async () => {
      const r = await fetch('/api/v1/listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gwanCode: cat?.gwanCode ?? 'MNY',
          categoryId,
          title: String(fd.get('title') ?? ''),
          body: String(fd.get('body') ?? ''),
          desiredFee: fd.get('desiredFee') ? Number(fd.get('desiredFee')) : undefined,
          feeBearer: String(fd.get('feeBearer') ?? '') || undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) { setErr({ code: d.code ?? 'UNKNOWN', message: d.message ?? t('common.regFail') }); return; }
      setDone(d as Result);
      router.refresh();
    });
  }

  if (done) {
    return (
      <div className="result">
        {done.autoApproved ? (
          <>
            <p className="ok-note">{t('old.doneAuto')}</p>
            <a className="cta-primary as-link" href={`/money/${done.listingId}`}>{t('old.view')}</a>
          </>
        ) : (
          <>
            <p className="ok-note">{t('old.doneReview')}</p>
            <p className="hint">{t('old.doneReviewHint')}</p>
            <a className="cta-primary as-link" href="/my/listings">{t('old.myListings')}</a>
          </>
        )}
      </div>
    );
  }

  return (
    <form className="auth" onSubmit={submit}>
      <label className="fld">
        <span>{t('common.cat')}</span>
        <select name="categoryId" required>
          <option value="">{t('old.pick')}</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <em>{t('old.catHint')}</em>
      </label>

      <label className="fld">
        <span>{t('lf.title')}</span>
        <input name="title" required minLength={5} maxLength={100} />
      </label>

      <label className="fld">
        <span>{t('edit.body')}</span>
        <textarea name="body" rows={6} />
        <em>{t('old.bodyHint')}</em>
      </label>

      <label className="fld">
        <span>{t('old.fee')}</span>
        <input name="desiredFee" type="number" min={0} step={10000} placeholder="3000000" />
        <em>{t('old.feeHint')}</em>
      </label>

      <label className="fld">
        <span>{t('reg.bearerLabel')}</span>
        <select name="feeBearer">
          <option value="">{t('lf.bearerNego')}</option>
          <option value="BUYER">{t('lf.bearerBuyer')}</option>
          <option value="SELLER">{t('lf.bearerSeller')}</option>
        </select>
      </label>

      {err && <p className="form-error" role="alert">{err.message}{err.code === 'POSTING_SUSPENDED' && <> <a href="/support/new?type=ACCOUNT">{t('lf.support')}</a></>}</p>}

      <button className="cta-primary" disabled={pending}>
        {pending ? t('common.submitting') : t('old.submit')}
      </button>
    </form>
  );
}

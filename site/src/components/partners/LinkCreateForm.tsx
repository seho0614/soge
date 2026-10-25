'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useFmt } from '@/lib/useFmt';
import type { AffResult } from './types';
import { CopyButton } from './CopyButton';

interface P { id: string; name: string; commission: number | string }

/**
 * 링크 발급 — POST /partner/affiliate/links
 *
 * ★ 어디에 뿌릴지 이름(label)을 받습니다. 블로그·카톡을 나눠야
 *   어느 쪽이 되는지 보입니다(서버 설명 그대로).
 * ★ 파트너가 아니면 201 + ok:false 로 옵니다 — note 를 그대로 보여 드립니다.
 */
export function LinkCreateForm({ products, fixed, compact }: {
  products: P[]; fixed?: string; compact?: boolean;
}) {
  const router = useRouter();
  const t = useTranslations('affiliate.linkForm');
  const tc = useTranslations('affiliate.common');
  const fm = useFmt();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [made, setMade] = useState<{ code: string; note: string } | null>(null);
  const [open, setOpen] = useState(!compact);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const productId = fixed ?? String(fd.get('productId') ?? '');
    const label = String(fd.get('label') ?? '').trim();
    setErr(null); setMade(null);
    if (!productId) { setErr(t('pickProduct')); return; }
    start(async () => {
      const r = await fetch('/api/v1/partner/affiliate/links', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, label: label || undefined }),
      });
      const d = (await r.json().catch(() => null)) as (AffResult & { message?: string }) | null;
      if (!r.ok) { setErr(d?.message ?? t('fail')); return; }
      if (!d?.ok) { setErr(d?.note ?? t('failShort')); return; }
      setMade({ code: d.code ?? '', note: d.note ?? t('made') });
      router.refresh();
    });
  }

  if (compact && !open) {
    return <button type="button" className="btn-sm" onClick={() => setOpen(true)}>{tc('makeLink')}</button>;
  }

  return (
    <form className="p2form" onSubmit={submit}>
      {!fixed && (
        <label className="fld">
          <span>{t('product')}</span>
          <select name="productId" defaultValue="" required>
            <option value="" disabled>{t('placeholderOption')}</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{t('option', { name: p.name, amount: fm.won(Number(p.commission)) })}</option>
            ))}
          </select>
        </label>
      )}
      <label className="fld">
        <span>{t('label')}</span>
        <input name="label" maxLength={40} placeholder={t('labelPlaceholder')} />
      </label>
      {err && <p className="form-error" role="alert">{err}</p>}
      {made && (
        <p className="ok-note" role="status">
          {made.note} {t('code')} <code className="mono">{made.code}</code> <CopyButton text={made.code} label={t('copyCode')} />
          {' '}<Link href="/partners/links">{t('viewLinks')}</Link>
        </p>
      )}
      <div className="p2act">
        <button className="btn-sm p2primary" disabled={pending}>{pending ? t('pending') : tc('makeLink')}</button>
        {compact && <button type="button" className="link-btn" onClick={() => setOpen(false)}>{tc('close')}</button>}
      </div>
    </form>
  );
}

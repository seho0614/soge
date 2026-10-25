'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AddressInput, EMPTY_ADDRESS, type AddressValue } from '@/components/AddressInput';
import { useTranslations } from 'next-intl';
import { needsLogin } from './util';

/**
 * 새 배송지 — POST /me/health/addresses { receiver, phone, zipcode, addr1, addr2?, label? }
 *
 * 주소는 기존 AddressInput(Daum 우편번호, 스크립트를 못 받으면 직접 입력)으로 받습니다.
 * 첫 배송지는 서버가 기본 배송지로 둡니다. `next` 가 있으면 저장 뒤 그리로 돌아갑니다(주문서).
 */
export function AddressForm({ next }: { next?: string }) {
  const t = useTranslations('order');
  const router = useRouter();
  const [addr, setAddr] = useState<AddressValue>(EMPTY_ADDRESS);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setErr(null); setOk(false);
    const phone = String(fd.get('phone') ?? '').trim();
    if (!addr.zipcode.trim() || !addr.road.trim()) { setErr(t('addr.errAddr')); return; }
    if (!/^[0-9-]{9,14}$/.test(phone)) { setErr(t('addr.errPhone')); return; }
    start(async () => {
      const r = await fetch('/api/v1/me/health/addresses', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: String(fd.get('label') ?? '').trim() || undefined,
          receiver: String(fd.get('receiver') ?? '').trim(),
          phone,
          zipcode: addr.zipcode.trim(),
          addr1: addr.road.trim(),
          addr2: addr.detail.trim() || undefined,
        }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        if (needsLogin(r.status, d?.code)) { router.push('/login'); return; }
        setErr(r.status >= 500 ? t('addr.errSave') : d?.message ?? t('addr.errSaveShort'));
        return;
      }
      /* v10.25 — 「기본 배송지로 설정」에 체크했으면 저장한 배송지를 기본으로 바꿉니다(첫 배송지는 서버가 이미 기본으로 둡니다) */
      if (fd.get('makeDefault') && d?.id) {
        await fetch(`/api/v1/me/health/addresses/${encodeURIComponent(d.id)}/default`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => null);
      }
      if (next) { router.push(next); return; }
      form.reset();
      setAddr(EMPTY_ADDRESS);
      setOk(true);
      router.refresh();
    });
  }

  return (
    <form className="auth hlt-form" onSubmit={submit}>
      <label className="fld"><span>{t('addr.label')}</span><input name="label" placeholder={t('addr.labelPh')} maxLength={20} /></label>
      <label className="fld"><span>{t('addr.receiver')}</span><input name="receiver" required maxLength={30} /></label>
      <label className="fld"><span>{t('addr.phone')}</span><input name="phone" required inputMode="tel" placeholder="010-0000-0000" /></label>
      {/* v10.31 (시안 「우편번호 · 주소 찾기 / 도로명 주소 / 상세 주소」) */}
      <AddressInput value={addr} onChange={setAddr} required label={t('addr.zip')} />
      <label className="hlt-chk"><input type="checkbox" name="makeDefault" /> <span>{t('addr.makeDefault')}</span></label>
      {err && <p className="form-error" role="alert">{err}</p>}
      {ok && <p className="ok-note" role="status">{t('addr.saved')}</p>}
      <button className="cta-primary" disabled={pending}>{pending ? t('addr.saving') : next ? t('addr.saveToOrder') : t('addr.save')}</button>
    </form>
  );
}

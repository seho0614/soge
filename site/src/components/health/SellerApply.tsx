'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { needsLogin } from './util';

export interface MySeller {
  enabled: boolean; identityVerified: boolean; consent: boolean;
  seller: null | {
    id: string; code: string; name: string; type: string; status: string; personal: boolean;
    bizRegNo: string | null; ceoName: string | null; ecomRegNo: string | null; csTel: string | null;
    returnAddr: string | null; addr: string | null; rejectReason: string | null; appliedAt: string | null;
    statusReason?: string | null;   /* v10.223 (D193) — 정지 · 이용 제한 · 폐점 사유 */
    licenses: Array<{ kind: string; licenseNo: string; expiresAt: string | null }>;
  };
}

const KINDS = ['BIZ_REG', 'ECOM_REG', 'FOOD_SALE', 'COSMETIC', 'BRAND_RIGHT', 'HEALTH_FUNC', 'MED_DEVICE'] as const;

/**
 * v10.165 (D155 · docs/256) — 소개몰 입점 신청 · 상태.
 *   POST /me/health/seller — 개인 · 사업자 모두(P2P). 심사 중 · 반려면 고쳐서 다시 냄.
 *   본인확인 · 입점 약관(HLT_SELLER) 동의가 없으면 그 안내부터 보여 줌.
 */
export function SellerApply({ initial }: { initial: MySeller }) {
  const t = useTranslations('hlt.tenant');
  const router = useRouter();
  const [mine, setMine] = useState(initial);
  const s = mine.seller;
  const [personal, setPersonal] = useState(s?.personal ?? true);
  const [lic, setLic] = useState(s?.licenses?.length ? s.licenses.map((l) => ({ kind: l.kind, licenseNo: l.licenseNo, expiresAt: l.expiresAt?.slice(0, 10) ?? '' }))
    : [{ kind: 'ECOM_REG', licenseNo: '', expiresAt: '' }]);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [agreeChk, setAgreeChk] = useState(false);
  const [agreeErr, setAgreeErr] = useState<string | null>(null);

  if (s && (s.status === 'ACTIVE' || s.status === 'PAUSED')) {
    return <div className="hlt-box" data-tenant-state={s.status}><h3>{t('activeTitle', { name: s.name })}</h3><p>{t('activeBody')}</p>
      {s.status === 'PAUSED' && s.statusReason && <p className="form-error" data-tenant-paused="">{t('pausedNote', { reason: s.statusReason })}</p>}
      <Link className="cta-primary" href="/health/seller/center" data-tenant-center="">{t('toCenter')}</Link></div>;
  }
  if (s?.status === 'BLOCKED') return <div className="hlt-box" data-tenant-state="BLOCKED"><p>{s.statusReason ? t('blockedReason', { reason: s.statusReason }) : t('blocked')}</p></div>;

  /* v10.222 — 입점 약관 동의를 이 화면에서 바로(전에는 약관 보기 링크만 있고 동의할 곳이 없었음) · POST /terms/agree 뒤 내 입점을 다시 읽음 */
  function agree() {
    setAgreeErr(null);
    start(async () => {
      const r = await fetch('/api/v1/terms/agree', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ code: 'HLT_SELLER', agreed: true }] }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        if (needsLogin(r.status, d?.code)) { router.push('/login?next=%2Fhealth%2Fseller'); return; }
        setAgreeErr(r.status >= 500 ? t('errSave') : d?.message ?? t('errSave'));
        return;
      }
      const m = await fetch('/api/v1/me/health/seller').then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (m) setMine(m as MySeller);
      router.refresh();
    });
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const v = (k: string) => String(fd.get(k) ?? '').trim();
    setErr(null);
    start(async () => {
      const r = await fetch('/api/v1/me/health/seller', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: v('type') || 'TENANT', name: v('name'), personal,
          bizRegNo: personal ? undefined : v('bizRegNo') || undefined,
          ceoName: v('ceoName'), ecomRegNo: v('ecomRegNo') || undefined, csTel: v('csTel'),
          returnAddr: v('returnAddr'), addr: v('addr') || undefined,
          licenses: lic.filter((l) => l.licenseNo.trim()).map((l) => ({ kind: l.kind, licenseNo: l.licenseNo.trim(), expiresAt: l.expiresAt || undefined })),
        }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        if (needsLogin(r.status, d?.code)) { router.push('/login'); return; }
        setErr(r.status >= 500 ? t('errSave') : d?.message ?? t('errSave'));
        return;
      }
      setMine(d as MySeller);
      router.refresh();
    });
  }

  return (
    <>
      {s?.status === 'PENDING' && <p className="notice" data-tenant-state="PENDING">{t('pending')}</p>}
      {s?.status === 'REJECTED' && <p className="form-error" data-tenant-state="REJECTED">{t('rejected', { reason: s.rejectReason ?? '' })}</p>}
      {s?.status === 'CLOSED' && <p className="notice" data-tenant-state="CLOSED">{t('closedState', { reason: s.statusReason ?? '' })}</p>}
      {!mine.identityVerified && <p className="notice" data-tenant-need="identity">{t('needIdentity')} <Link className="hlt-btn sm" href="/verify">{t('verify')}</Link></p>}
      {!mine.consent && (
        <div className="notice" data-tenant-need="consent">
          <p>{t('needConsent')} <Link className="hlt-btn sm" href="/terms/HLT_SELLER" target="_blank">{t('termsRead')}</Link></p>
          <label className="hlt-chk"><input type="checkbox" checked={agreeChk} onChange={(e) => setAgreeChk(e.target.checked)} data-tenant-agree-chk="" /> <span>{t('agreeChk')}</span></label>
          <button type="button" className="hlt-btn sm" disabled={pending || !agreeChk} onClick={agree} data-tenant-agree="">{t('agreeBtn')}</button>
          {agreeErr && <p className="form-error" role="alert">{agreeErr}</p>}
        </div>
      )}
      <form className="auth hlt-form" onSubmit={submit} data-tenant-form="">
        <label className="fld"><span>{t('type')}</span>
          <select name="type" defaultValue={s?.type ?? 'TENANT'}><option value="TENANT">{t('typeTenant')}</option><option value="BRAND">{t('typeBrand')}</option></select></label>
        <label className="fld"><span>{t('name')}</span><input name="name" required minLength={2} maxLength={60} defaultValue={s?.name ?? ''} /></label>
        <label className="hlt-chk"><input type="checkbox" checked={personal} onChange={(e) => setPersonal(e.target.checked)} data-tenant-personal="" /> <span>{t('personal')}</span></label>
        {!personal && <label className="fld"><span>{t('bizRegNo')}</span><input name="bizRegNo" required pattern="[0-9]{3}-[0-9]{2}-[0-9]{5}" placeholder="123-45-67890" defaultValue={s?.bizRegNo ?? ''} /></label>}
        <label className="fld"><span>{t('ceoName')}</span><input name="ceoName" required minLength={2} maxLength={40} defaultValue={s?.ceoName ?? ''} /></label>
        <label className="fld"><span>{t('ecomRegNo')}</span><input name="ecomRegNo" maxLength={60} placeholder={t('ecomPh')} defaultValue={s?.ecomRegNo ?? ''} /></label>
        <label className="fld"><span>{t('csTel')}</span><input name="csTel" required inputMode="tel" pattern="[0-9-]{8,15}" placeholder="02-000-0000" defaultValue={s?.csTel ?? ''} /></label>
        <label className="fld"><span>{t('returnAddr')}</span><input name="returnAddr" required minLength={5} maxLength={200} defaultValue={s?.returnAddr ?? ''} /></label>
        <label className="fld"><span>{t('addr')}</span><input name="addr" maxLength={200} defaultValue={s?.addr ?? ''} /></label>
        <fieldset className="fld">
          <legend>{t('licenses')}</legend>
          <p className="hint">{t('licensesHelp')}</p>
          {lic.map((l, i) => (
            <div key={i} className="hlt-row" data-tenant-license={i}>
              <select value={l.kind} onChange={(e) => setLic(lic.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)))}>
                {KINDS.map((k) => <option key={k} value={k}>{t(`kind.${k}`)}</option>)}
              </select>
              <input placeholder={t('licenseNo')} value={l.licenseNo} maxLength={60} onChange={(e) => setLic(lic.map((x, j) => (j === i ? { ...x, licenseNo: e.target.value } : x)))} />
              <input type="date" aria-label={t('expiresAt')} value={l.expiresAt} onChange={(e) => setLic(lic.map((x, j) => (j === i ? { ...x, expiresAt: e.target.value } : x)))} />
            </div>
          ))}
          {lic.length < 10 && <button type="button" className="hlt-btn sm" onClick={() => setLic([...lic, { kind: 'FOOD_SALE', licenseNo: '', expiresAt: '' }])}>{t('addLicense')}</button>}
        </fieldset>
        <p className="hint">{t('money')}</p>
        {err && <p className="form-error" role="alert">{err}</p>}
        <button className="cta-primary" disabled={pending || !mine.identityVerified || !mine.consent}>{pending ? t('saving') : s ? t('resubmit') : t('submit')}</button>
      </form>
    </>
  );
}

'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { needsLogin } from './util';

export interface SellerAccountInfo {
  status: string; statusReason: string | null; statusAt: string | null;
  change: null | { id: string; state: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'; reason: string | null; requestedAt: string; decidedAt: string | null };
  closeBlockers: string[];
}

const KINDS = ['BIZ_REG', 'ECOM_REG', 'FOOD_SALE', 'COSMETIC', 'BRAND_RIGHT', 'HEALTH_FUNC', 'MED_DEVICE'] as const;
const FIELDS = [['name', 'fName'], ['ceoName', 'fCeo'], ['bizRegNo', 'fBiz'], ['ecomRegNo', 'fEcom'], ['csTel', 'fTel'], ['returnAddr', 'fReturn'], ['addr', 'fAddr']] as const;

/**
 * v10.223 (D193 · docs/358) — 판매자센터 「판매자 계정」: 정지 사유 · 정보 변경 요청(운영 승인 뒤 바뀜) · 폐점(판매자 탈퇴).
 *   GET /me/health/seller/account · POST …/change-request · …/change-request/cancel · …/close
 *   폐점은 진행 중 주문 · 취소 · 반품 · 정산이 남아 있으면 서버가 막음 — 막는 까닭을 미리 보여 줌.
 */
export function SellerAccount({ info }: { info: SellerAccountInfo }) {
  const t = useTranslations('hlt.account');
  const tk = useTranslations('hlt.tenant');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [lic, setLic] = useState<Array<{ kind: string; licenseNo: string; expiresAt: string }>>([]);
  const [closeChk, setCloseChk] = useState(false);
  const day = (s: string | null) => (s ? s.slice(0, 10) : '');

  async function send(path: string, body: unknown, done: string) {
    setErr(null); setMsg(null);
    const r = await fetch(`/api/v1/me/health/seller${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    const d = await r.json().catch(() => null);
    if (!r.ok) {
      if (needsLogin(r.status, d?.code)) { router.push('/login?next=%2Fhealth%2Fseller%2Fcenter'); return false; }
      setErr(r.status >= 500 ? t('errSave') : d?.message ?? t('errSave'));
      return false;
    }
    setMsg(done); router.refresh();
    return true;
  }

  function requestChange(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const body: Record<string, unknown> = {};
    for (const [k] of FIELDS) { const v = String(fd.get(k) ?? '').trim(); if (v) body[k] = v; }
    const l = lic.filter((x) => x.licenseNo.trim()).map((x) => ({ kind: x.kind, licenseNo: x.licenseNo.trim(), expiresAt: x.expiresAt || undefined }));
    if (l.length) body.licenses = l;
    if (!Object.keys(body).length) { setErr(t('noField')); return; }
    const note = String(fd.get('note') ?? '').trim();
    if (note) body.note = note;
    start(async () => { if (await send('/change-request', body, t('sent'))) { form.reset(); setLic([]); } });
  }

  const c = info.change;
  return (
    <section className="hlt-box" data-seller-account="">
      <h3>{t('title')}</h3>
      {info.status === 'PAUSED' && (
        <p className="form-error" role="alert" data-seller-paused="">{info.statusReason ? t('paused', { reason: info.statusReason }) : t('pausedNoReason')}</p>
      )}
      {msg && <p className="ok-note" role="status">{msg}</p>}
      {err && <p className="form-error" role="alert">{err}</p>}

      <h4>{t('changeTitle')}</h4>
      {c && (
        <p className="notice" data-seller-change={c.state}>
          {c.state === 'PENDING' ? t('stPENDING', { at: day(c.requestedAt) })
            : c.state === 'APPROVED' ? t('stAPPROVED', { at: day(c.decidedAt) })
            : c.state === 'REJECTED' ? t('stREJECTED', { reason: c.reason ?? '' }) : t('stCANCELLED')}
          {c.state === 'PENDING' && <> <button type="button" className="hlt-btn sm" disabled={pending} onClick={() => start(async () => { await send('/change-request/cancel', {}, t('cancelled')); })} data-seller-change-cancel="">{t('cancel')}</button></>}
        </p>
      )}
      {c?.state !== 'PENDING' && (
        <form className="auth hlt-form" onSubmit={requestChange} data-seller-change-form="">
          <p className="hint">{t('changeHelp')}</p>
          {FIELDS.map(([k, label]) => (
            <label key={k} className="fld"><span>{t(label)}</span><input name={k} maxLength={200} {...(k === 'bizRegNo' ? { pattern: '[0-9]{3}-[0-9]{2}-[0-9]{5}', placeholder: '123-45-67890' } : {})} /></label>
          ))}
          <fieldset className="fld">
            <legend>{t('fLic')}</legend>
            {lic.map((l, i) => (
              <div key={i} className="hlt-row" data-seller-change-license={i}>
                <select value={l.kind} onChange={(e) => setLic(lic.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)))}>
                  {KINDS.map((k) => <option key={k} value={k}>{tk(`kind.${k}`)}</option>)}
                </select>
                <input placeholder={t('licNo')} value={l.licenseNo} maxLength={60} onChange={(e) => setLic(lic.map((x, j) => (j === i ? { ...x, licenseNo: e.target.value } : x)))} />
                <input type="date" aria-label={t('licExp')} value={l.expiresAt} onChange={(e) => setLic(lic.map((x, j) => (j === i ? { ...x, expiresAt: e.target.value } : x)))} />
              </div>
            ))}
            {lic.length < 10 && <button type="button" className="hlt-btn sm" onClick={() => setLic([...lic, { kind: 'ECOM_REG', licenseNo: '', expiresAt: '' }])}>{t('addLic')}</button>}
          </fieldset>
          <label className="fld"><span>{t('note')}</span><input name="note" maxLength={500} /></label>
          <button className="cta-primary" disabled={pending}>{t('send')}</button>
        </form>
      )}

      <h4>{t('closeTitle')}</h4>
      <p className="hint">{t('closeHelp')}</p>
      {info.closeBlockers.length > 0 ? (
        <p className="notice" data-seller-close-blocked="">{t('closeBlocked', { why: info.closeBlockers.join(' · ') })}</p>
      ) : (
        <form className="auth hlt-form" data-seller-close-form="" onSubmit={(e) => {
          e.preventDefault();
          const reason = String(new FormData(e.currentTarget).get('reason') ?? '').trim();
          start(async () => { await send('/close', reason ? { reason } : {}, t('closed')); });
        }}>
          <label className="fld"><span>{t('closeReason')}</span><input name="reason" maxLength={200} /></label>
          <label className="hlt-chk"><input type="checkbox" checked={closeChk} onChange={(e) => setCloseChk(e.target.checked)} data-seller-close-chk="" /> <span>{t('closeChk')}</span></label>
          <button className="hlt-btn" disabled={pending || !closeChk} data-seller-close="">{t('closeBtn')}</button>
        </form>
      )}
    </section>
  );
}

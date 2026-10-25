'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useBrokerExtra } from './BrokerExtra';
import { useTranslations } from 'next-intl';

/**
 * 중개사 인증 신청 폼.
 *
 * 간주 모드에서는 **대조를 건너뛴다는 것**을 누르기 전에 알립니다.
 * 통과한 줄 알고 매물을 올렸다가 연동 후 취소되면 곤란합니다.
 *
 * v10.31 (w2 · 시안 scBrkApp) — 「제출 서류」 체크 4종(등록증 · 보증 증서 기본 체크) · 서류 파일(선택) · 보증(공제) 칸을 더하고,
 *   단추를 시안대로 「신청하고 대조하기」로 바꿨습니다. 신청(POST /partner/broker) 뒤 PUT /me/broker/extra 로 붙입니다.
 */
export function BrokerApply({ assumed }: { assumed: boolean }) {
  const router = useRouter();
  const t = useTranslations('join.brokerApply');
  const [f, setF] = useState({ licenseNo: '', officeName: '', ceoName: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const extra = useBrokerExtra(null);

  const done = f.licenseNo.trim().length >= 5
    && f.officeName.trim() && f.ceoName.trim();

  async function submit() {
    if (assumed && !confirm(t('confirmAssumed'))) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/v1/partner/broker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(f),
      });
      if (!r.ok) throw new Error(String(r.status));
    } catch {
      setErr(t('failed'));
      setBusy(false);
      return;
    }
    try { await extra.save((s) => setStep(s)); }
    catch (e) { setErr(t('extraFailed', { message: (e as Error).message })); setBusy(false); return; }
    router.push('/my/broker/status');
  }

  return (
    <div className="card" style={{ padding: '18px 20px' }}>
      <label className="fld">
        <span>{t('licenseNo')}</span>
        <input className="inp mono" value={f.licenseNo} maxLength={20}
          placeholder="11680-2022-00099"
          onChange={(e) => setF({ ...f, licenseNo: e.target.value })} />
      </label>
      <label className="fld">
        <span>{t('officeName')}</span>
        <input className="inp" value={f.officeName} maxLength={40}
          onChange={(e) => setF({ ...f, officeName: e.target.value })} />
      </label>
      <label className="fld">
        <span>{t('ceo')}</span>
        <input className="inp" value={f.ceoName} maxLength={20}
          onChange={(e) => setF({ ...f, ceoName: e.target.value })} />
      </label>

      {extra.fields}

      <button type="button" className="btn-primary" disabled={!done || busy}
        onClick={() => void submit()}>
        {busy ? (step ?? t('working')) : t('submit')}
      </button>
      {err ? <p className="form-error">{err}</p> : null}
      <p className="hint">
        {t.rich('hint', { b: (c) => <b>{c}</b> })}
      </p>
    </div>
  );
}

'use client';
/** v10.31 (w2) — 피해 사례 작성 칸(POST /safety/cases). 유형 · 지역 · 제목 · 내용. 서버가 연락처 · 이메일 · 계좌번호를 가려 저장합니다. */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

/* v10.98 — 이름은 사전 detail.safety.type.* */
const TYPES = ['CONTRACT', 'PAYMENT', 'GOODS', 'PRIVACY', 'ETC'] as const;

export function SafetyCaseForm({ regions }: { regions: { code: string; name: string }[] }) {
  const router = useRouter();
  const t = useTranslations('detail.safety');
  const [type, setType] = useState('CONTRACT');
  const [region, setRegion] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  async function go() {
    if (title.trim().length < 5) { setMsg(t('titleShort')); return; }
    if (body.trim().length < 20) { setMsg(t('bodyShort')); return; }
    setBusy(true); setMsg('');
    const r = await fetch('/api/v1/safety/cases', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, title: title.trim(), body: body.trim(), ...(region ? { regionCode: region } : {}) }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) { router.push(`/safety/cases/${j.no}`); return; }
    setMsg(j.message ?? t('postFail'));
  }
  return (
    <div className="gw-cslf" data-safety-form="">
      <label className="gw-fld"><span>{t('typeLabel')}</span>
        <div className="gw-opts">{TYPES.map((k) => <button key={k} type="button" className={`gw-opt${type === k ? ' gw-on' : ''}`} aria-pressed={type === k} onClick={() => setType(k)}>{t(`type.${k}`)}</button>)}</div></label>
      <label className="gw-fld"><span>{t('regionLabel')}</span>
        <select className="gw-inp" value={region} onChange={(e) => setRegion(e.target.value)}><option value="">{t('regionNone')}</option>{regions.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}</select></label>
      <label className="gw-fld"><span>{t('titleLabel')}</span>
        <input className="gw-inp" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('titlePh')} /></label>
      <label className="gw-fld"><span>{t('bodyLabel')}</span>
        <textarea className="gw-inp" rows={8} maxLength={3000} value={body} onChange={(e) => setBody(e.target.value)}
          placeholder={t('bodyPh')} /></label>
      <div className="gw-axwarn">{t('warn')}</div>
      <div className="gw-abar" style={{ borderTop: 0, padding: '6px 0 0' }}><span className="gw-sp" />
        {msg && <span className="gw-axmsg" role="status">{msg}</span>}
        <button type="button" className="gw-go" disabled={busy} onClick={() => void go()}><span>{t('submit')}</span><small>{t('submitNote')}</small></button></div>
    </div>
  );
}

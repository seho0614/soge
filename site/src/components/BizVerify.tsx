'use client';
/**
 * v10.32 (추가) — 인증 화면(SB-HOM-AUT-030 · 시안 scVerify) 「2. 사업자 인증」 칸.
 *   시안: 사업자등록번호 칸 → 노란 안내(이런 경우 인증되지 않습니다) → [국세청 조회로 인증].
 *   새 인증 방식을 만들지 않습니다 — 이미 있는 API 두 개를 그대로 씁니다.
 *     ① 「국세청 조회로 인증」 = POST /signup/biz-check(가입 2단계와 같은 조회 — 국세청 상태 · 이미 가입된 번호)
 *     ② 통과하면 그 번호로 사업자 신청서(BusinessForm → POST /businesses — 나의공간 사업자 전환과 같은 신청 · 운영 승인)
 *   휴업 · 폐업 · 이미 가입된 번호면 신청서를 열지 않고 까닭을 보입니다.
 */
import { useState } from 'react';
import { BusinessForm } from './BusinessForm';
import { useTranslations } from 'next-intl';

interface BizCheck { bizRegNo: string; status: string; stub: boolean; detail: string | null; taken: boolean; ok: boolean }
const fmtBrn = (d: string) => (d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : d);

export function BizVerify({ disabled = false }: { disabled?: boolean }) {
  const t = useTranslations('join.bizVerify');
  const [brn, setBrn] = useState('');
  const [busy, setBusy] = useState(false);
  const [chk, setChk] = useState<BizCheck | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function check() {
    const d = brn.replace(/\D/g, '');
    if (d.length !== 10) { setErr(t('need10')); return; }
    setErr(null); setBusy(true); setChk(null);
    try {
      const r = await fetch('/api/v1/signup/biz-check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bizRegNo: d }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setErr(j.message ?? t('lookupFail'));
      else { setChk(j as BizCheck); setBrn(fmtBrn(d)); }
    } catch { setErr(t('lookupFail')); }
    setBusy(false);
  }

  if (chk?.ok) {
    return (
      <div data-biz-check-ok="">
        <div className="my-nt ok">
          <b>{t('okHead', { status: chk.status === 'VALID' ? t('stValid') : t('stChecking') })}</b>{t('okBrn', { brn: fmtBrn(chk.bizRegNo) })}{chk.detail ? ` (${chk.detail})` : ''}
          {chk.stub ? t('okStub') : ''}{t('okTail')}
        </div>
        <BusinessForm regNo={chk.bizRegNo} />
        <button type="button" className="my-bo sm" style={{ marginTop: 8 }} onClick={() => { setChk(null); setBrn(''); }}>{t('again')}</button>
      </div>
    );
  }

  return (
    <div data-biz-check="">
      <label className="my-fld"><span>{t('brn')}</span>
        <input className="my-inp w1-vinp" name="brn" value={brn} onChange={(e) => { setBrn(e.target.value); setChk(null); }}
          inputMode="numeric" placeholder="123-45-67890" maxLength={12} aria-label={t('brn')} disabled={disabled} /></label>
      <div className="my-nt warn">{t.rich('warn', { b: (c) => <b>{c}</b> })}</div>
      {chk && !chk.ok && (
        <p className="form-error" role="alert" data-biz-check-no="">
          {chk.taken ? t('taken')
            : <>{t.rich('noResult', { b: (c) => <b>{c}</b>, status: chk.status === 'CLOSED' ? t('stClosed') : chk.status === 'SUSPENDED' ? t('stSuspended') : t('stUnknown') })}{chk.detail ? ` (${chk.detail})` : ''}.</>}
        </p>
      )}
      {err && <p className="form-error" role="alert">{err}</p>}
      <div className="my-hbtn" style={{ marginBottom: 0 }}>
        <button type="button" className="my-bp" onClick={check} disabled={busy || disabled}
          title={disabled ? t('needId') : undefined}>{busy ? t('working') : t('submit')}</button>
      </div>
    </div>
  );
}

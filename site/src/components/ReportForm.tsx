'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

type Reason = { code: string; label: string; severity: string };

/**
 * 신고 폼.
 *
 * ── 기타를 고르면 설명을 받습니다 ───────────────────────────────────
 * 사유 없는 신고는 **처리하는 쪽이 판단할 근거가 없어** 기각밖에
 * 할 수 없습니다. 서버도 막지만, 보내기 전에 알려 주는 편이
 * 낫습니다.
 */
export function ReportForm({ targetType, targetId, reasons }:
  { targetType: string; targetId: string; reasons: Reason[] }) {
  const router = useRouter();
  const t = useTranslations('deal.report');
  const [code, setCode] = useState('');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const needDetail = code === 'OTHER';
  const ready = code && (!needDetail || detail.trim().length >= 2);

  async function submit() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/v1/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType, targetId, reasonCode: code, detail: detail.trim() || undefined }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d?.code ?? String(r.status));
      }
      const d = await r.json();
      router.push('/my/reports' + (d?.already ? '?already=1' : ''));
    } catch (e) {
      const m = e instanceof Error ? e.message : '';
      setErr(
        /자기 등록|SELF/.test(m) ? t('errSelf')
        : /DETAIL/.test(m) ? t('errDetail')
        : t('errFail'));
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ padding: '18px 20px' }}>
      <div className="fld">
        <span>{t('what')}</span>
        <div className="opts">
          {reasons.map((r) => (
            <button key={r.code} type="button"
              className={`opt ${code === r.code ? 'on' : ''}`}
              onClick={() => setCode(r.code)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <label className="fld">
        <span>
          {t('detail')}{needDetail ? <b style={{ color: 'var(--danger)' }}>{t('required')}</b> : t('optional')}
        </span>
        <textarea className="inp" rows={4} value={detail} maxLength={500}
          placeholder={needDetail
            ? t('phRequired')
            : t('phOptional')}
          onChange={(e) => setDetail(e.target.value)} />
      </label>

      <button type="button" className="btn-primary" disabled={!ready || busy}
        onClick={() => void submit()}>
        {busy ? t('busy') : t('submit')}
      </button>
      {err ? <p className="form-error">{err}</p> : null}
      <p className="hint">
        {t.rich('hint', { b: (x) => <b>{x}</b> })}
      </p>
    </div>
  );
}

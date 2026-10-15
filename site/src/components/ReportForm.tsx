'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

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
        /자기 등록|SELF/.test(m) ? '자기 글은 신고하실 수 없습니다.'
        : /DETAIL/.test(m) ? '무엇이 문제인지 적어 주십시오.'
        : '접수하지 못했습니다. 잠시 후 다시 시도해 주십시오.');
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ padding: '18px 20px' }}>
      <div className="fld">
        <span>어떤 점이 문제입니까</span>
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
          자세히{needDetail ? <b style={{ color: 'var(--danger)' }}> · 필수</b> : ' (선택)'}
        </span>
        <textarea className="inp" rows={4} value={detail} maxLength={500}
          placeholder={needDetail
            ? '무엇이 문제인지 적어 주십시오. 적지 않으시면 처리할 수 없습니다.'
            : '구체적으로 적어 주시면 처리가 빨라집니다.'}
          onChange={(e) => setDetail(e.target.value)} />
      </label>

      <button type="button" className="btn-primary" disabled={!ready || busy}
        onClick={() => void submit()}>
        {busy ? '접수하는 중…' : '신고하기'}
      </button>
      {err ? <p className="form-error">{err}</p> : null}
      <p className="hint">
        허위 신고가 반복되면 <b>신고 권한이 제한될 수 있습니다.</b>
      </p>
    </div>
  );
}

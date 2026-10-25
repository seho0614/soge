'use client';
import { dtKst } from '@/lib/format';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export interface Contract { id: string; issuedAt: string; signedByBuyerAt: string | null; signedBySellerAt: string | null }

/**
 * 계약서 발급 · 서명.
 *
 * 두 번째 서명이 성사 확정 · 귀속 스냅샷 · 정산 신청을 한 번에 일으킵니다.
 * 그래서 서명 버튼에 그 사실을 적어 둡니다 — 되돌릴 수 없는 동작입니다.
 */
/* v10.31 — 이미 발급된 계약서가 있으면 그 상태로 엽니다(전: 늘 「계약서 발급」 단추부터 — 거래 정보 GET /deals/{id}/summary 의 contract) */
export function ContractPanel({ dealId, initial }: { dealId: string; initial?: Contract | null }) {
  const router = useRouter();
  const t = useTranslations('deal.cp');
  const [pending, start] = useTransition();
  const [c, setC] = useState<Contract | null>(initial ?? null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  function call(path: string, onOk: (d: unknown) => void) {
    setErr(null);
    start(async () => {
      const r = await fetch(`/api/v1/deals/${dealId}${path}`, { method: 'POST' });
      const d = await r.json().catch(() => null);
      if (!r.ok) { setErr(d?.message ?? t('fail')); return; }
      onOk(d);
      router.refresh();
    });
  }

  const both = !!c?.signedByBuyerAt && !!c?.signedBySellerAt;

  return (
    <div className="result">
      {!c ? (
        <button className="cta-primary" disabled={pending}
                onClick={() => call('/contract', (d) => setC(d as Contract))}>
          {pending ? t('issuing') : t('issue')}
        </button>
      ) : (
        <>
          <p className="ok-note">
            {t('issued', { at: dtKst(c.issuedAt) })}
          </p>
          <ul className="sign-state">
            <li className={c.signedByBuyerAt ? 'done' : ''}>{t('buyer', { state: c.signedByBuyerAt ? t('signed') : t('wait') })}</li>
            <li className={c.signedBySellerAt ? 'done' : ''}>{t('seller', { state: c.signedBySellerAt ? t('signed') : t('wait') })}</li>
          </ul>

          {both ? (
            <p className="ok-note">{t('both')}</p>
          ) : (
            <>
              <p className="notice">
                {t.rich('notice', { strong: (x) => <strong>{x}</strong> })}
              </p>
              <label className="chk">
                <input type="checkbox" checked={confirmed}
                       onChange={(e) => setConfirmed(e.target.checked)} />
                {t('check')}
              </label>
              <button className="cta-primary" disabled={pending || !confirmed}
                      onClick={() => call('/contract/sign', (d) => setC(d as Contract))}>
                {pending ? t('signing') : t('sign')}
              </button>
            </>
          )}
        </>
      )}
      {err && <p className="form-error" role="alert">{err}</p>}
    </div>
  );
}

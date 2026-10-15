'use client';
import { dtKst } from '@/lib/format';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

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
  const [pending, start] = useTransition();
  const [c, setC] = useState<Contract | null>(initial ?? null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  function call(path: string, onOk: (d: unknown) => void) {
    setErr(null);
    start(async () => {
      const r = await fetch(`/api/v1/deals/${dealId}${path}`, { method: 'POST' });
      const d = await r.json().catch(() => null);
      if (!r.ok) { setErr(d?.message ?? '처리하지 못했습니다.'); return; }
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
          {pending ? '발급 중…' : '계약서 발급'}
        </button>
      ) : (
        <>
          <p className="ok-note">
            발급 {dtKst(c.issuedAt)} · 금액이 고정되었습니다.
          </p>
          <ul className="sign-state">
            <li className={c.signedByBuyerAt ? 'done' : ''}>매수인 {c.signedByBuyerAt ? '서명 완료' : '대기'}</li>
            <li className={c.signedBySellerAt ? 'done' : ''}>매도인 {c.signedBySellerAt ? '서명 완료' : '대기'}</li>
          </ul>

          {both ? (
            <p className="ok-note">양측 서명 완료 — 성사가 확정되고 정산이 신청되었습니다.</p>
          ) : (
            <>
              <p className="notice">
                <strong>두 번째 서명이 성사를 확정합니다.</strong> 확정되면 정산이 자동으로 신청되고
                되돌릴 수 없습니다.
              </p>
              <label className="chk">
                <input type="checkbox" checked={confirmed}
                       onChange={(e) => setConfirmed(e.target.checked)} />
                내용을 확인했습니다
              </label>
              <button className="cta-primary" disabled={pending || !confirmed}
                      onClick={() => call('/contract/sign', (d) => setC(d as Contract))}>
                {pending ? '서명 중…' : '서명하기'}
              </button>
            </>
          )}
        </>
      )}
      {err && <p className="form-error" role="alert">{err}</p>}
    </div>
  );
}

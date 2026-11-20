'use client';
/**
 * v10.554 (D287 · docs/692) 주문서 도서산간 추가 배송비 미리보기 — GET /api/v1/me/health/remote-fee?addressId=
 *   직판 장바구니(판매자 하나 · DIRECT)일 때만 부름 · 배송지를 바꾸면 다시 부름 · 못 받으면 0(주문 때 서버가 다시 셈 — 결제 금액은 서버 값)
 *   스위치(smx.remote_ship)가 꺼져 있거나 구역 밖이면 서버가 0 을 줌 → 주문서에 줄이 안 보임(앞 판과 같음)
 */
import { useEffect, useState } from 'react';

export function useRemoteFee(addressId: string, direct: boolean): number {
  const [fee, setFee] = useState(0);
  useEffect(() => {
    let live = true;
    if (!addressId || !direct) { setFee(0); return () => { live = false; }; }
    fetch(`/api/v1/me/health/remote-fee?addressId=${encodeURIComponent(addressId)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { fee?: number } | null) => { if (live) setFee(Number(d?.fee ?? 0) || 0); })
      .catch(() => { if (live) setFee(0); });
    return () => { live = false; };
  }, [addressId, direct]);
  return fee;
}

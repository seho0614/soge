'use client';
/* v10.29 — 단추 · 안내를 시안 모양(.bp/.bo sm · .nt)으로. 동작은 그대로 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Contact { name: string | null; phone: string | null; address: string | null; email?: string | null }

/** 연락처를 그 자리에서 보여 줍니다. 목록을 새로 그리면 사라지므로 다시 보려면 다시 누릅니다(기록됨). */
function ContactView({ c, note }: { c: Contact | null; note?: string | null }) {
  if (!c) return <p className="hint">{note ?? '연락처가 없습니다.'}</p>;
  const tel = (c.phone ?? '').replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3');
  return (
    <div className="pt-nt ok notice" data-contact>
      <b>{c.name}</b> · <a href={`tel:${c.phone ?? ''}`}>{tel}</a>
      {c.address ? <> · {c.address}</> : null}
      {c.email ? <> · <a href={`mailto:${c.email}`} data-contact-email>{c.email}</a></> : null}
      {note ? <p className="hint">{note}</p> : null}
    </div>
  );
}

async function fetchContact(deliveryId: string) {
  const res = await fetch(`/api/v1/partner/leads/${deliveryId}/contact`);
  const b = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(b.message ?? '연락처를 불러오지 못했습니다.');
  return b as { contact: Contact | null; note?: string };
}

/**
 * 열람 = 과금입니다. 그래서 한 번 더 묻습니다.
 *
 * 실수로 눌러 이용료가 붙으면 그건 그대로 분쟁이 됩니다.
 * D008 — 열람이 끝나면 연락처를 바로 보여 줍니다(GET …/contact, 열람 기록이 남음).
 */
export function ViewLeadButton({ deliveryId, fee }: { deliveryId: string; fee?: number | string | null }) {
  const [err, setErr] = useState<string | null>(null);
  const [shown, setShown] = useState<{ contact: Contact | null; note?: string } | null>(null);
  const [cash, setCash] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  async function open() {
    /* v10.31 (W5 · 선불) — 시안 문구 그대로 */
    if (!confirm(`열면 리드 이용료에서 확인비용${fee ? ` ${Number(fee).toLocaleString('ko-KR')}원` : ''}이 빠집니다 — 보너스 잔액부터 차감됩니다. 이름 · 휴대폰 · 이메일이 보이고 열람 기록이 남습니다.`)) return;
    setErr(null);
    const res = await fetch(`/api/v1/partner/leads/${deliveryId}/view`, { method: 'POST' });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setErr(b.message ?? '열람하지 못했습니다.');
      setCash(b.code === 'LEADCASH');
      start(() => router.refresh());
      return;
    }
    try { setShown(await fetchContact(deliveryId)); } catch (e) { setErr((e as Error).message); }
  }

  if (shown) {
    return (
      <div className="card-meta">
        <span className="pt-bg ok badge verified">열람함</span>
        <ContactView c={shown.contact} note={shown.note} />
        <button className="pt-bo sm" onClick={() => start(() => router.refresh())}>목록 새로고침</button>
      </div>
    );
  }
  return (
    <div className="card-meta">
      <button className="pt-bp sm" onClick={open} disabled={pending}>
        {pending ? '여는 중…' : '연락처 열기'}
      </button>
      {err && <p className="pt-nt warn notice">{err}{cash ? <> <a href="/partner/cash">충전하러 가기</a></> : null}</p>}
    </div>
  );
}

/** 이미 열람한 리드 — 이용료 없이 연락처를 다시 봅니다(볼 때마다 열람 기록이 남습니다). */
export function ContactButton({ deliveryId }: { deliveryId: string }) {
  const [shown, setShown] = useState<{ contact: Contact | null; note?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function show() {
    setBusy(true); setErr(null);
    try { setShown(await fetchContact(deliveryId)); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }
  if (shown) return <ContactView c={shown.contact} note={shown.note} />;
  return (
    <>
      <button className="pt-bo sm" onClick={show} disabled={busy}>{busy ? '불러오는 중…' : '연락처 보기'}</button>
      {err && <p className="pt-nt warn notice">{err}</p>}
    </>
  );
}

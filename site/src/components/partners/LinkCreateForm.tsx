'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { AffResult } from './types';
import { CopyButton } from './CopyButton';

interface P { id: string; name: string; commission: number | string }

/**
 * 링크 발급 — POST /partner/affiliate/links
 *
 * ★ 어디에 뿌릴지 이름(label)을 받습니다. 블로그·카톡을 나눠야
 *   어느 쪽이 되는지 보입니다(서버 설명 그대로).
 * ★ 파트너가 아니면 201 + ok:false 로 옵니다 — note 를 그대로 보여 드립니다.
 */
export function LinkCreateForm({ products, fixed, compact }: {
  products: P[]; fixed?: string; compact?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [made, setMade] = useState<{ code: string; note: string } | null>(null);
  const [open, setOpen] = useState(!compact);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const productId = fixed ?? String(fd.get('productId') ?? '');
    const label = String(fd.get('label') ?? '').trim();
    setErr(null); setMade(null);
    if (!productId) { setErr('상품을 고르십시오.'); return; }
    start(async () => {
      const r = await fetch('/api/v1/partner/affiliate/links', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, label: label || undefined }),
      });
      const d = (await r.json().catch(() => null)) as (AffResult & { message?: string }) | null;
      if (!r.ok) { setErr(d?.message ?? '링크를 만들지 못했습니다. 잠시 후 다시 시도해 주십시오.'); return; }
      if (!d?.ok) { setErr(d?.note ?? '링크를 만들지 못했습니다.'); return; }
      setMade({ code: d.code ?? '', note: d.note ?? '링크를 만들었습니다.' });
      router.refresh();
    });
  }

  if (compact && !open) {
    return <button type="button" className="btn-sm" onClick={() => setOpen(true)}>링크 만들기</button>;
  }

  return (
    <form className="p2form" onSubmit={submit}>
      {!fixed && (
        <label className="fld">
          <span>상품</span>
          <select name="productId" defaultValue="" required>
            <option value="" disabled>판매 중인 상품을 고르십시오</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name} · 건당 {Number(p.commission).toLocaleString('ko-KR')}원</option>
            ))}
          </select>
        </label>
      )}
      <label className="fld">
        <span>어디에 쓰실 링크입니까</span>
        <input name="label" maxLength={40} placeholder="예: 블로그 · 단톡방 · 문자" />
      </label>
      {err && <p className="form-error" role="alert">{err}</p>}
      {made && (
        <p className="ok-note" role="status">
          {made.note} 코드 <code className="mono">{made.code}</code> <CopyButton text={made.code} label="코드 복사" />
          {' '}<Link href="/partners/links">내 소개링크 보기</Link>
        </p>
      )}
      <div className="p2act">
        <button className="btn-sm p2primary" disabled={pending}>{pending ? '만드는 중…' : '링크 만들기'}</button>
        {compact && <button type="button" className="link-btn" onClick={() => setOpen(false)}>닫기</button>}
      </div>
    </form>
  );
}

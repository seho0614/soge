'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Category { id: string; gwanCode: string; name: string; feeBearer: string | null }
interface Result { listingId: string; status: string; autoApproved: boolean }

/**
 * 매물 등록.
 *
 * 제한업종·금칙어·슬롯 한도는 서버(DB)가 판정합니다.
 * 여기서 다시 검사하지 않고, 422 message 를 그대로 보여 줍니다.
 */
export function RegisterForm({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState<Result | null>(null);
  const [err, setErr] = useState<{ code: string; message: string } | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const categoryId = String(fd.get('categoryId') ?? '');
    const cat = categories.find((c) => c.id === categoryId);
    setErr(null);
    start(async () => {
      const r = await fetch('/api/v1/listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gwanCode: cat?.gwanCode ?? 'MNY',
          categoryId,
          title: String(fd.get('title') ?? ''),
          body: String(fd.get('body') ?? ''),
          desiredFee: fd.get('desiredFee') ? Number(fd.get('desiredFee')) : undefined,
          feeBearer: String(fd.get('feeBearer') ?? '') || undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) { setErr({ code: d.code ?? 'UNKNOWN', message: d.message ?? '등록하지 못했습니다.' }); return; }
      setDone(d as Result);
      router.refresh();
    });
  }

  if (done) {
    return (
      <div className="result">
        {done.autoApproved ? (
          <>
            <p className="ok-note">등록 완료 — 바로 노출됩니다.</p>
            <a className="cta-primary as-link" href={`/money/${done.listingId}`}>매물 보기</a>
          </>
        ) : (
          <>
            <p className="ok-note">검수 요청되었습니다.</p>
            <p className="hint">24시간 안에 결과를 알려 드립니다.</p>
            <a className="cta-primary as-link" href="/my/listings">내 리스팅</a>
          </>
        )}
      </div>
    );
  }

  return (
    <form className="auth" onSubmit={submit}>
      <label className="fld">
        <span>업종</span>
        <select name="categoryId" required>
          <option value="">선택하십시오</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <em>등급은 업종이 결정합니다. 직접 고르지 않습니다</em>
      </label>

      <label className="fld">
        <span>제목</span>
        <input name="title" required minLength={5} maxLength={100} />
      </label>

      <label className="fld">
        <span>내용</span>
        <textarea name="body" rows={6} />
        <em>30자 미만이면 사람이 검수합니다. 충분히 적으면 자동 승인됩니다</em>
      </label>

      <label className="fld">
        <span>희망 소개비</span>
        <input name="desiredFee" type="number" min={0} step={10000} placeholder="3000000" />
        <em>최종 금액은 당사자 합의로 정해집니다. 플랫폼이 계산하지 않습니다</em>
      </label>

      <label className="fld">
        <span>부담 주체</span>
        <select name="feeBearer">
          <option value="">협의</option>
          <option value="BUYER">매수인 부담</option>
          <option value="SELLER">매도인 부담</option>
        </select>
      </label>

      {err && <p className="form-error" role="alert">{err.message}{err.code === 'POSTING_SUSPENDED' && <> <a href="/support/new?type=ACCOUNT">고객센터 문의</a></>}</p>}

      <button className="cta-primary" disabled={pending}>
        {pending ? '등록 중…' : '등록하기'}
      </button>
    </form>
  );
}

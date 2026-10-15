'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Gwan } from '@/lib/types';
import type { Role } from './RegisterTabs';
import type { FormCopy } from '@/lib/content';


/* 공유 파일 — v10.31 (w2): sections = 시안 scRegBiz 의 「1. 기본 정보 · 2. 거래 조건」 두 판 + 「한줄 소개 · 희망 금액」 칸(서버 listings.summary · deal_amount).
 *   기본값(false)은 전과 같은 한 장 폼입니다 — 다른 등록 화면은 그대로입니다. */
export function ListingForm({ gwan, role, categories, copy, messages, sections = false, note, cancel }: {
  gwan: Gwan; role: Role;
  categories: { id: string; name: string }[];
  copy: FormCopy[];
  messages: Record<string, string>;
  sections?: boolean;
  /** v10.32 (추가 · 시안 scRegBiz) — 검수 안내 띠 · 「등록 취소」. 주면 「안내 띠 → [등록 신청] [등록 취소]」 순서로 폼 끝에 그립니다(없으면 전과 같음) */
  note?: React.ReactNode;
  cancel?: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<{ code: string; message: string } | null>(null);
  // 관마다 무엇을 등록하는지가 다릅니다. 문구는 서버가 관리합니다
  const L = copy.find((c) => c.role === role);
  const isOffer = role === 'OFFER';

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErr(null);
    start(async () => {
      const path = isOffer ? '/api/v1/listings' : '/api/v1/requests';
      const r = await fetch(path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gwanCode: gwan.code,
          categoryId: String(fd.get('categoryId')),
          title: String(fd.get('title')),
          body: String(fd.get('body') ?? ''),
          ...(isOffer
            ? { desiredFee: Number(fd.get('desiredFee')) || undefined,
                feeBearer: String(fd.get('feeBearer') || 'NEGOTIABLE'),
                ...(sections ? { summary: String(fd.get('summary') ?? '').trim() || undefined,
                                 dealAmount: Number(fd.get('dealAmount')) || undefined } : {}) }
            : { offeredFee: Number(fd.get('offeredFee')) || undefined }),
        }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        // 422 message 는 사용자에게 그대로 보여도 되는 문장입니다
        setErr({ code: d?.code ?? '', message: d?.message ?? '등록하지 못했습니다.' });
        return;
      }
      // 자동검수를 통과하면 status 가 PUBLISHED 로 옵니다
      router.push(d?.autoApproved ? '/my/listings?published=1' : '/my/listings?review=1');
    });
  }

  if (categories.length === 0) {
    return <p className="empty">등록 가능한 업종이 없습니다. 고객센터로 문의해 주세요.</p>;
  }

  if (sections && isOffer) {
    /* 시안 scRegBiz — 1. 기본 정보(구분 · 제목 · 한줄 소개) · 2. 거래 조건(희망 금액 · 소개비). 상세 내용 · 소개비 부담은 개발에 있던 칸(남김) */
    return (
      <form className="auth gw-regf" onSubmit={submit}>
        <fieldset className="gw-fset"><legend>1. 기본 정보</legend>
          <div className="gw-g2">
            <label className="fld"><span>구분 <i>*</i></span>
              <select name="categoryId" required>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label className="fld"><span>제목 <i>*</i></span>
              <input name="title" required placeholder={L?.titleHint ?? '최대 50자'} minLength={5} maxLength={50} /></label>
          </div>
          <label className="fld"><span>한줄 소개 <i>*</i></span>
            <input name="summary" required minLength={2} maxLength={60} placeholder="최대 60자 — 목록 카드 · 상세 맨 위에 나옵니다" /></label>
          <label className="fld"><span>상세 내용</span>
            <textarea name="body" rows={6} placeholder={L?.bodyHint} /><em>{messages.THIN_CONTENT_HINT}</em></label>
        </fieldset>
        <fieldset className="gw-fset"><legend>2. 거래 조건</legend>
          <div className="gw-g2">
            <label className="fld"><span>희망 금액 (원)</span>
              <input name="dealAmount" type="number" inputMode="numeric" min={0} placeholder="협의 가능 — 비우면 「금액 협의」" /></label>
            <label className="fld"><span>소개비 (원)</span>
              <input name="desiredFee" type="number" inputMode="numeric" min={0} placeholder="협의 — 요율표를 쓰지 않습니다 (A-12)" />
              <em>{messages.FEE_NOT_CALCULATED}</em></label>
          </div>
          <label className="fld"><span>소개비 부담</span>
            <select name="feeBearer"><option value="NEGOTIABLE">협의</option><option value="BUYER">매수인 부담</option><option value="SELLER">매도인 부담</option></select></label>
        </fieldset>
        {err && (
          <p className="form-error" role="alert">{err.message}
            {err.code === 'LISTING_SLOT_LIMIT' && <> <a href="/my/subscription/upgrade">구독 안내 보기</a></>}
            {err.code === 'POSTING_SUSPENDED' && <> <a href="/support/new?type=ACCOUNT">고객센터 문의</a></>}</p>
        )}
        {note}
        {cancel ? (
          <div className="gw-dact gw-regact">{/* v10.32 (추가) — 시안: 검수 안내 띠 아래 [등록 신청] [등록 취소] 나란히 */}
            <button className="cta-primary" disabled={pending}>{pending ? '등록 중…' : '등록 신청'}</button>
            {cancel}
          </div>
        ) : <button className="cta-primary" disabled={pending}>{pending ? '등록 중…' : '등록 신청'}</button>}
      </form>
    );
  }

  return (
    <form className="auth" onSubmit={submit}>
      <label className="fld">
        <span>업종</span>
        <select name="categoryId" required>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>

      <label className="fld">
        <span>{isOffer ? `${L?.subject ?? ''} 제목` : '구하는 것'}</span>
        <input name="title" required placeholder={L?.titleHint} minLength={5} />
      </label>

      <label className="fld">
        <span>상세 내용</span>
        <textarea name="body" rows={7} placeholder={L?.bodyHint} />
        <em>{messages.THIN_CONTENT_HINT}</em>
      </label>

      {isOffer ? (
        <>
          <label className="fld">
            <span>희망 소개비 (원)</span>
            <input name="desiredFee" type="number" inputMode="numeric" placeholder="3000000" />
            <em>{messages.FEE_NOT_CALCULATED}</em>
          </label>
          <label className="fld">
            <span>소개비 부담</span>
            <select name="feeBearer">
              <option value="BUYER">매수인 부담</option>
              <option value="SELLER">매도인 부담</option>
              <option value="NEGOTIABLE">협의</option>
            </select>
          </label>
        </>
      ) : (
        <label className="fld">
          <span>제시 소개비 (원)</span>
          <input name="offeredFee" type="number" inputMode="numeric" />
          <em>소개해 주신 분께 드릴 금액입니다</em>
        </label>
      )}

      {err && (
        <p className="form-error" role="alert">
          {err.message}
          {err.code === 'LISTING_SLOT_LIMIT' && (
            <> <a href="/my/subscription/upgrade">구독 안내 보기</a></>
          )}
        </p>
      )}

      {note}
      {cancel ? (
        <div className="gw-dact gw-regact">{/* v10.32 (추가) — 안내 띠 아래 등록 · 취소 나란히(소개받기 탭도 같은 자리) */}
          <button className="cta-primary" disabled={pending}>
            {pending ? '등록 중…' : isOffer ? `${L?.subject ?? ''} 등록` : '소개 요청 등록'}
          </button>
          {cancel}
        </div>
      ) : (
        <button className="cta-primary" disabled={pending}>
          {pending ? '등록 중…' : isOffer ? `${L?.subject ?? ''} 등록` : '소개 요청 등록'}
        </button>
      )}
    </form>
  );
}

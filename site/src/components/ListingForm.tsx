'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('forms');
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
        setErr({ code: d?.code ?? '', message: d?.message ?? t('common.regFail') });
        return;
      }
      // 자동검수를 통과하면 status 가 PUBLISHED 로 옵니다
      router.push(d?.autoApproved ? '/my/listings?published=1' : '/my/listings?review=1');
    });
  }

  if (categories.length === 0) {
    return <p className="empty">{t('lf.noCat')}</p>;
  }

  if (sections && isOffer) {
    /* 시안 scRegBiz — 1. 기본 정보(구분 · 제목 · 한줄 소개) · 2. 거래 조건(희망 금액 · 소개비). 상세 내용 · 소개비 부담은 개발에 있던 칸(남김) */
    return (
      <form className="auth gw-regf" onSubmit={submit}>
        <fieldset className="gw-fset"><legend>{t('common.sec1')}</legend>
          <div className="gw-g2">
            <label className="fld"><span>{t('lf.kind')} <i>*</i></span>
              <select name="categoryId" required>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label className="fld"><span>{t('lf.title')} <i>*</i></span>
              <input name="title" required placeholder={L?.titleHint ?? t('lf.titlePh')} minLength={5} maxLength={50} /></label>
          </div>
          <label className="fld"><span>{t('reg.intro')} <i>*</i></span>
            <input name="summary" required minLength={2} maxLength={60} placeholder={t('lf.summaryPh')} /></label>
          <label className="fld"><span>{t('req.desc')}</span>
            <textarea name="body" rows={6} placeholder={L?.bodyHint} /><em>{messages.THIN_CONTENT_HINT}</em></label>
        </fieldset>
        <fieldset className="gw-fset"><legend>{t('lf.sec2')}</legend>
          <div className="gw-g2">
            <label className="fld"><span>{t('lf.dealAmount')}</span>
              <input name="dealAmount" type="number" inputMode="numeric" min={0} placeholder={t('lf.dealAmountPh')} /></label>
            <label className="fld"><span>{t('edit.fee')}</span>
              <input name="desiredFee" type="number" inputMode="numeric" min={0} placeholder={t('lf.feePh')} />
              <em>{messages.FEE_NOT_CALCULATED}</em></label>
          </div>
          <label className="fld"><span>{t('lf.bearer')}</span>
            <select name="feeBearer"><option value="NEGOTIABLE">{t('lf.bearerNego')}</option><option value="BUYER">{t('lf.bearerBuyer')}</option><option value="SELLER">{t('lf.bearerSeller')}</option></select></label>
        </fieldset>
        {err && (
          <p className="form-error" role="alert">{err.message}
            {err.code === 'LISTING_SLOT_LIMIT' && <> <a href="/my/subscription/upgrade">{t('lf.upgrade')}</a></>}
            {err.code === 'POSTING_SUSPENDED' && <> <a href="/support/new?type=ACCOUNT">{t('lf.support')}</a></>}</p>
        )}
        {note}
        {cancel ? (
          <div className="gw-dact gw-regact">{/* v10.32 (추가) — 시안: 검수 안내 띠 아래 [등록 신청] [등록 취소] 나란히 */}
            <button className="cta-primary" disabled={pending}>{pending ? t('common.submitting') : t('lf.apply')}</button>
            {cancel}
          </div>
        ) : <button className="cta-primary" disabled={pending}>{pending ? t('common.submitting') : t('lf.apply')}</button>}
      </form>
    );
  }

  return (
    <form className="auth" onSubmit={submit}>
      <label className="fld">
        <span>{t('common.cat')}</span>
        <select name="categoryId" required>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>

      <label className="fld">
        <span>{isOffer ? t('lf.subjectTitle', { subject: L?.subject ?? '' }) : t('lf.wanted')}</span>
        <input name="title" required placeholder={L?.titleHint} minLength={5} />
      </label>

      <label className="fld">
        <span>{t('req.desc')}</span>
        <textarea name="body" rows={7} placeholder={L?.bodyHint} />
        <em>{messages.THIN_CONTENT_HINT}</em>
      </label>

      {isOffer ? (
        <>
          <label className="fld">
            <span>{t('lf.desiredFee')}</span>
            <input name="desiredFee" type="number" inputMode="numeric" placeholder="3000000" />
            <em>{messages.FEE_NOT_CALCULATED}</em>
          </label>
          <label className="fld">
            <span>{t('lf.bearer')}</span>
            <select name="feeBearer">
              <option value="BUYER">{t('lf.bearerBuyer')}</option>
              <option value="SELLER">{t('lf.bearerSeller')}</option>
              <option value="NEGOTIABLE">{t('lf.bearerNego')}</option>
            </select>
          </label>
        </>
      ) : (
        <label className="fld">
          <span>{t('lf.offeredFee')}</span>
          <input name="offeredFee" type="number" inputMode="numeric" />
          <em>{t('lf.offeredFeeHint')}</em>
        </label>
      )}

      {err && (
        <p className="form-error" role="alert">
          {err.message}
          {err.code === 'LISTING_SLOT_LIMIT' && (
            <> <a href="/my/subscription/upgrade">{t('lf.upgrade')}</a></>
          )}
        </p>
      )}

      {note}
      {cancel ? (
        <div className="gw-dact gw-regact">{/* v10.32 (추가) — 안내 띠 아래 등록 · 취소 나란히(소개받기 탭도 같은 자리) */}
          <button className="cta-primary" disabled={pending}>
            {pending ? t('common.submitting') : isOffer ? t('lf.subjectReg', { subject: L?.subject ?? '' }) : t('lf.requestReg')}
          </button>
          {cancel}
        </div>
      ) : (
        <button className="cta-primary" disabled={pending}>
          {pending ? t('common.submitting') : isOffer ? t('lf.subjectReg', { subject: L?.subject ?? '' }) : t('lf.requestReg')}
        </button>
      )}
    </form>
  );
}

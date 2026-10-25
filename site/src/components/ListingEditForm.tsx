'use client';
/**
 * SB-HOM-REG-020 소개하기 수정 · 재검수 — v10.31 시안 scRegEdit 그대로.
 *   반려 사유 상자(사유 · 메모) · 걸린 표현 · 「고친 내용만 다시 봅니다」 · 제목 · 소개비 · 내용 · 재검수 요청 · 초안 저장 · 이력 줄.
 *   전: 업종(categoryId)을 보내지 못해 무엇을 눌러도 400 「categoryId must be a UUID」(결함 상) → 상세 응답의 categoryId 를 그대로 보냄.
 *   서버 영어 검증 문구는 화면에 그대로 내지 않습니다(한국어 안내로).
 * 자료: PATCH /listings/{id} · GET /me/listings/{id}/review · GET · PUT · DELETE /me/listings/{id}/draft (v10.31).
 */
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ListingDetailData } from '@/lib/types';
import { dtKst } from '@/lib/format';

export interface ReviewState {
  listingStatus: string; listingStatusLabel: string;
  review: { status: string; reasonCode: string | null; reasonLabel: string | null; memo: string | null; slaDueAt: string | null } | null;
  flagged: string[];
  history: Array<{ at: string; label: string }>;
}
export interface Draft { title: string | null; body: string | null; desiredFee: number | null; savedAt: string }

/* v10.101 (2-5b) — 안내 문장(fix)은 부르는 쪽이 사전(forms.edit.fixInput)에서 넘깁니다 */
function korean(code: string, msg: string, fix: string) {
  if (code === 'VERSION_CONFLICT') return msg;
  if (/must be|should not|is not|must contain/i.test(msg)) return fix;
  return msg;
}

export function ListingEditForm({ item, review, draft }: { item: ListingDetailData; review: ReviewState | null; draft: Draft | null }) {
  const router = useRouter();
  const t = useTranslations('forms.edit');
  const [pending, start] = useTransition();
  const [err, setErr] = useState<{ code: string; message: string } | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [title, setTitle] = useState(draft?.title ?? item.title);
  const [body, setBody] = useState(draft?.body ?? item.body ?? '');
  const [fee, setFee] = useState(String(draft?.desiredFee ?? item.desiredFee ?? ''));
  const [savedAt, setSavedAt] = useState(draft?.savedAt ?? null);

  const rejected = review?.review?.status === 'REJECTED' || item.status === 'REJECTED';
  const feeNum = fee.replace(/\D/g, '') ? Number(fee.replace(/\D/g, '')) : undefined;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setOk(null);
    if (title.trim().length < 5) { setErr({ code: 'FORM', message: t('errTitle') }); return; }
    if (!item.categoryId) { setErr({ code: 'FORM', message: t('errCat') }); return; }
    start(async () => {
      const r = await fetch(`/api/v1/listings/${item.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: item.version, gwanCode: item.gwanCode, categoryId: item.categoryId,
          title: title.trim(), body, desiredFee: feeNum,
        }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) { setErr({ code: d?.code ?? '', message: korean(d?.code ?? '', d?.message ?? t('errFail'), t('fixInput')) }); return; }
      router.push('/my/listings');
    });
  }

  async function saveDraft() {
    setErr(null); setOk(null);
    const r = await fetch(`/api/v1/me/listings/${item.id}/draft`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.slice(0, 100), body: body.slice(0, 5000), desiredFee: feeNum }),
    }).catch(() => null);
    const d = r ? await r.json().catch(() => null) : null;
    if (!r || !r.ok) { setErr({ code: '', message: d?.message ?? t('errDraft') }); return; }
    setSavedAt(d.savedAt); setOk(t('okDraft'));
  }

  async function dropDraft() {
    await fetch(`/api/v1/me/listings/${item.id}/draft`, { method: 'DELETE' }).catch(() => null);
    setSavedAt(null); setTitle(item.title); setBody(item.body ?? ''); setFee(String(item.desiredFee ?? ''));
    setOk(t('okDrop'));
  }

  return (
    <form onSubmit={submit} noValidate>
      {rejected && review?.review?.reasonCode ? (
        <div className="w1-nt warn"><b>{t('rejected', { code: review.review.reasonCode })}</b><br />{review.review.reasonLabel}{review.review.memo ? ` · ${review.review.memo}` : ''}</div>
      ) : (
        <div className="w1-nt">{t.rich('editing', { b: (c) => <b>{c}</b>, status: review?.listingStatusLabel ?? item.statusLabel })}</div>
      )}
      {review?.flagged?.length ? (
        <div className="w1-panel" style={{ padding: '10px 14px', marginTop: 8 }}>
          <span className="w1-ls">{t('flagged')}</span>{review.flagged.map((x, i) => <span key={x}>{i > 0 && ' · '}<b style={{ color: 'var(--rd)' }}>{x}</b></span>)}
        </div>
      ) : null}
      <div className="w1-nt" style={{ marginTop: 8 }}>{t.rich('diffOnly', { b: (c) => <b>{c}</b> })}</div>

      <h2 className="w1-h2" style={{ marginTop: 18 }}>{t('h')}</h2>
      {savedAt && <p className="w1-ls">{t('draftLoaded', { at: dtKst(savedAt) })} <button type="button" className="w1-bo sm" onClick={dropDraft}>{t('dropDraft')}</button></p>}
      <div className="w1-fld"><label htmlFor="ed-t">{t('title')}</label>
        <input id="ed-t" name="title" className="w1-in" value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} /></div>
      <div className="w1-fld"><label htmlFor="ed-f">{t('fee')}</label>
        <input id="ed-f" name="desiredFee" className="w1-in" inputMode="numeric" value={fee ? Number(fee.replace(/\D/g, '') || 0).toLocaleString('ko-KR') : ''}
          onChange={(e) => setFee(e.target.value.replace(/\D/g, ''))} placeholder={t('feePh')} />
        <div className="w1-fh">{t('feeHint')}</div></div>
      <div className="w1-fld"><label htmlFor="ed-b">{t('body')}</label>
        <textarea id="ed-b" name="body" className="w1-in" rows={8} value={body} maxLength={5000} onChange={(e) => setBody(e.target.value)} />
        <div className="w1-cnt">{body.length} / 5000</div></div>

      {err && (
        <p className="w1-err" role="alert">
          {err.message}
          {err.code === 'VERSION_CONFLICT' && <> <a href={`/listings/${item.id}/edit`}>{t('reload')}</a></>}
        </p>
      )}
      {ok && <p className="w1-ok" role="status">{ok}</p>}
      <div className="w1-prfact" style={{ marginTop: 10 }}>
        <button className="w1-bp" disabled={pending}>{pending ? t('saving') : t('submit')}</button>
        <button type="button" className="w1-bo" disabled={pending} onClick={saveDraft}>{t('saveDraft')}</button>
        <Link className="w1-bo" href="/my/listings">{t('cancel')}</Link>
      </div>
      {review?.history?.length ? (
        <div className="w1-nt" style={{ marginTop: 14 }}>{t('history', { n: String(review.history.length), list: review.history.map((h) => `${dtKst(h.at)} ${h.label}`).join(' / ') })}</div>
      ) : null}
    </form>
  );
}

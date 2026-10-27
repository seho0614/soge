'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { dtKst } from '@/lib/format';   // v10.31 검정(G-222) — toLocaleString 대신
import { useTranslations } from 'next-intl';
import { withCodes } from '@/lib/ruleCodes';   // v10.132 규칙 코드 작게

export interface Terms { amount: number; dueDate: string; special?: string; kind?: 'GOODS' | 'SERVICE'; place?: string; court?: string }
interface Party { company: string; ceo: string; bizRegNo: string | null; phone: string | null; business: boolean; identityVerified: boolean }
/** GET /deals/{id}/contract/state (v10.31 — 당사자 · 소개비 · 소개코드 · 서명 시각 · 임시 저장) */
export interface ContractState {
  id: string; state: string;
  buyerAgreed: boolean; sellerAgreed: boolean;
  buyerSigned: boolean; sellerSigned: boolean;
  buyerSignedAt?: string | null; sellerSignedAt?: string | null;
  buyerFulfilled?: boolean; sellerFulfilled?: boolean;
  terms: Terms | null; stalled: boolean; templateCode?: string;
  mySide?: 'BUYER' | 'SELLER'; title?: string | null;
  parties?: { buyer: Party | null; seller: Party | null };
  fee?: number | null; code?: { code: string; issuedAt: string | null; expiresAt: string | null } | null;
  draft?: { terms: Partial<Terms>; savedAt: string } | null;
}

/**
 * 계약서 폼 · 체결 (시안 scMyCtrD 제2조 · 제8조 입력칸 + 「서명 요청 보내기 · 양식 전문 보기 · 임시 저장」).
 *
 * ── 이 화면이 지키는 것 ─────────────────────────────────────────────
 * ① 한쪽이 혼자 진도를 뺄 수 없습니다. 합의·서명·이행 모두 양측이
 *    각각 눌러야 넘어갑니다(서버 트리거가 강제).
 * ② 조건을 바꾸면 상대의 합의가 무효가 됩니다 — 안 그러면 한쪽이
 *    금액을 고쳐도 상대 동의가 남아 있게 됩니다.
 * ③ 완료된 계약은 고칠 수 없습니다.
 * v10.31 — 「서명 요청 보내기」 = 조건을 상대에게 보내 합의를 받는 단추(POST …/contract/agree). 양측이 합의하면 서명 단계(「서명하기」).
 *   「임시 저장」 = 보내지 않고 내 쪽에만 남김(POST …/contract/draft). 저장해 둔 것이 있으면 그 값으로 엽니다.
 */
export default function ContractForm(
  { dealId, state, readOnly, fee }: { dealId: string; state: ContractState; readOnly: boolean; fee?: ReactNode }) {

  const r = useRouter();
  const t = useTranslations('myDeal');
  const b_ = (c: ReactNode) => <b>{c}</b>;
  const base: Partial<Terms> = { ...(state.terms ?? {}), ...(state.draft?.terms ?? {}) };
  const [kind, setKind] = useState<'GOODS' | 'SERVICE'>(base.kind === 'SERVICE' ? 'SERVICE' : 'GOODS');
  const [amount, setAmount] = useState<number>(Number(base.amount ?? 0));
  const [dueDate, setDue] = useState(base.dueDate ?? '');
  const [place, setPlace] = useState(base.place ?? '');
  const [court, setCourt] = useState(base.court ?? '');
  const [special, setSpecial] = useState(base.special ?? '');
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);

  const t0 = state.terms;
  const changed = !t0 ||
    amount !== Number(t0.amount ?? 0) || dueDate !== (t0.dueDate ?? '') || special !== (t0.special ?? '') ||
    kind !== (t0.kind ?? 'GOODS') || place !== (t0.place ?? '') || court !== (t0.court ?? '');

  const terms = (): Terms => ({
    amount, dueDate, kind,
    ...(special.trim() ? { special: special.trim() } : {}),
    ...(place.trim() ? { place: place.trim() } : {}),
    ...(court.trim() ? { court: court.trim() } : {}),
  });

  async function call(path: string, body?: unknown) {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/v1/deals/${dealId}/contract/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, t: j.message ?? t('form.failed') }); return; }
      setMsg({ ok: true, t: j.note ?? (j.waitingOther
        ? t('form.sentWait')
        : t('form.processed')) });
      r.refresh();
    } catch {
      setMsg({ ok: false, t: t('netErr') });
    } finally { setBusy(false); }
  }

  const canSend = !readOnly && ['DRAFT', 'SENT', 'COUNTER', 'AGREED'].includes(state.state);
  const canSign = state.state === 'AGREED';
  const canFulfil = state.state === 'SIGNED';
  const lock = readOnly || !canSend;

  return (
    <section data-ctrform="">
      {/* ── 제2조 거래목적물 — 여기가 입력칸입니다 ── */}
      <h2 className="my-st2">{t('form.a2')}</h2>
      <div className="my-ctrf">
        <div className="my-fr"><label>{t('form.deal')}</label><div className="my-fv"><b>{state.title ?? t('form.dealDefault')}</b></div></div>
        <div className="my-fr">
          <label>{t('form.kind')}</label>
          <div className="my-fv my-opts" role="radiogroup" aria-label={t('form.kind')}>
            {(['GOODS', 'SERVICE'] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} disabled={lock}
                className={`my-opt${kind === k ? ' on' : ''}`} onClick={() => setKind(k)} data-ctr-kind={k}>{t(`form.kinds.${k}`)}</button>
            ))}
          </div>
        </div>
        <div className="my-fr">
          <label htmlFor="amt">{t('form.amount')}</label>
          <div className="my-fv">
            <input id="amt" type="number" min={0} inputMode="numeric" placeholder={t('form.amountPh')}
                   value={amount || ''} disabled={lock}
                   onChange={e => setAmount(Number(e.target.value))} />
            <span className="my-ls">{t('form.amountUnit')}</span>
          </div>
        </div>
        <div className="my-fr">
          <label htmlFor="due">{t('form.due')}</label>
          <div className="my-fv">
            <input id="due" type="date" value={dueDate} disabled={lock}
                   onChange={e => setDue(e.target.value)} />
          </div>
        </div>
        <div className="my-fr">
          <label htmlFor="place">{t('form.place')}</label>
          <div className="my-fv">
            <input id="place" type="text" maxLength={200} value={place} disabled={lock} placeholder={t('form.placePh')}
                   onChange={e => setPlace(e.target.value)} />
          </div>
        </div>
      </div>
      <p className="my-nt warn">{withCodes(t.rich('form.svcWarn', { b: b_ }))}</p>

      {fee}

      {/* ── 제8조 분쟁 ── */}
      <h2 className="my-st2">{t('form.a8')}</h2>
      <div className="my-ctrf">
        <div className="my-fr">
          <label htmlFor="court">{t('form.court')} <span className="my-ls">{t('form.courtHint')}</span></label>
          <div className="my-fv">
            <input id="court" type="text" maxLength={100} value={court} disabled={lock} placeholder={t('form.courtPh')}
                   onChange={e => setCourt(e.target.value)} />
          </div>
        </div>
        <div className="my-fr">
          <label htmlFor="sp">{t('form.special')} <span className="my-ls">{t('form.optional')}</span></label>
          <div className="my-fv">
            <textarea id="sp" rows={3} maxLength={2000} value={special} disabled={lock}
                      placeholder={t('form.specialPh')}
                      onChange={e => setSpecial(e.target.value)} />
          </div>
        </div>
      </div>
      <p className="my-nt info">{t.rich('form.disputeNote', { b: b_ })}</p>

      {/* 양측 상태. 한쪽만 보이면 "왜 안 되지"가 됩니다. */}
      <div className="my-ctrp">
        <div className="my-cp"><span className="my-ls">{t('form.agreeLabel')}</span>
          <b>{t('form.sides', { b: state.buyerAgreed ? t('form.done') : t('form.wait'), s: state.sellerAgreed ? t('form.done') : t('form.wait') })}</b></div>
        <div className="my-cp"><span className="my-ls">{t('ctrD.sign')}</span>
          <b>{t('form.sides', { b: state.buyerSigned ? t('form.done') : t('form.wait'), s: state.sellerSigned ? t('form.done') : t('form.wait') })}</b></div>
      </div>

      {!readOnly && t0 && changed && (
        <p className="my-nt warn">
          {t.rich('form.changedWarn', { b: b_ })}
        </p>
      )}
      {state.draft && !readOnly && <p className="my-ls" data-ctr-draft="">{t('form.draftOpened', { at: dtKst(state.draft.savedAt) })}</p>}

      {msg && <p className={`my-nt ${msg.ok ? 'info' : 'warn'}`} role="status">{msg.t}</p>}

      {readOnly ? (
        <p className="my-nt ok">
          {t.rich(state.state === 'CANCELLED' ? 'form.roCancelled' : 'form.roDone', { b: b_ })}
          {state.state === 'FULFILLED' && t('form.roFee')}
        </p>
      ) : (
        <>
          <div className="my-hbtn my-ctra">
            <button className="my-bp" disabled={busy || !canSend || !dueDate || amount <= 0 || (state.state === 'AGREED' && !changed)}
                    title={!dueDate || amount <= 0 ? t('form.sendTitleNeed') : state.state === 'AGREED' && !changed ? t('form.sendTitleAgreed') : ''}
                    onClick={() => call('agree', { terms: terms() })} data-ctr-send="">
              {t('form.send')}
            </button>
            <Link className="my-bo" href={`/contracts/templates/${encodeURIComponent(state.templateCode ?? 'INTRO_STD')}?deal=${encodeURIComponent(dealId)}`}>{t('ctrD.viewTpl')}</Link>
            <button className="my-bo" disabled={busy || !canSend}
                    onClick={() => call('draft', { terms: { ...terms(), amount: amount || undefined, dueDate: dueDate || undefined } })} data-ctr-draft-save="">
              {t('form.draftSave')}
            </button>
          </div>
          {/* 개발에만 있던 단계 단추 — 서명 · 이행 확인 · 수정 요청(규칙 ③ 남김) */}
          <div className="my-ctra">
            <button className="my-bo" disabled={busy || !canSign}
                    title={canSign ? '' : t('form.signTitle')}
                    onClick={() => call('sign')}>
              {t('form.signBtn')}
            </button>
            <button className="my-bo" disabled={busy || !canFulfil}
                    title={canFulfil ? '' : t('form.fulfilTitle')}
                    onClick={() => call('fulfil')}>
              {t('form.fulfilBtn')}
            </button>
            <button className="my-bo" disabled={busy || memo.trim().length < 5}
                    title={memo.trim().length < 5 ? t('form.counterTitle') : ''}
                    onClick={() => call('counter', { memo })}>
              {t('form.counterBtn')}
            </button>
          </div>
          <div className="my-fr">
            <label htmlFor="memo">{t('form.memo')}</label>
            <div className="my-fv">
              <input id="memo" value={memo} maxLength={1000} placeholder={t('form.memoPh')}
                     onChange={e => setMemo(e.target.value)} />
            </div>
          </div>
        </>
      )}
    </section>
  );
}

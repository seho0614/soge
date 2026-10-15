'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { dtKst } from '@/lib/format';   // v10.31 검정(G-222) — toLocaleString 대신

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
      if (!res.ok) { setMsg({ ok: false, t: j.message ?? '처리하지 못했습니다.' }); return; }
      setMsg({ ok: true, t: j.note ?? (j.waitingOther
        ? '보냈습니다. 상대가 확인하면 다음 단계로 넘어갑니다.'
        : '처리했습니다.') });
      r.refresh();
    } catch {
      setMsg({ ok: false, t: '연결하지 못했습니다. 잠시 뒤 다시 시도해 주십시오.' });
    } finally { setBusy(false); }
  }

  const canSend = !readOnly && ['DRAFT', 'SENT', 'COUNTER', 'AGREED'].includes(state.state);
  const canSign = state.state === 'AGREED';
  const canFulfil = state.state === 'SIGNED';
  const lock = readOnly || !canSend;

  return (
    <section data-ctrform="">
      {/* ── 제2조 거래목적물 — 여기가 입력칸입니다 ── */}
      <h2 className="my-st2">제2조 (거래목적물)</h2>
      <div className="my-ctrf">
        <div className="my-fr"><label>계약 건</label><div className="my-fv"><b>{state.title ?? '소개 건'}</b></div></div>
        <div className="my-fr">
          <label>거래 유형</label>
          <div className="my-fv my-opts" role="radiogroup" aria-label="거래 유형">
            {([['GOODS', '물품'], ['SERVICE', '용역']] as const).map(([k, t]) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} disabled={lock}
                className={`my-opt${kind === k ? ' on' : ''}`} onClick={() => setKind(k)} data-ctr-kind={k}>{t}</button>
            ))}
          </div>
        </div>
        <div className="my-fr">
          <label htmlFor="amt">계약 금액</label>
          <div className="my-fv">
            <input id="amt" type="number" min={0} inputMode="numeric" placeholder="예: 85000000"
                   value={amount || ''} disabled={lock}
                   onChange={e => setAmount(Number(e.target.value))} />
            <span className="my-ls">원 · 부가세 별도</span>
          </div>
        </div>
        <div className="my-fr">
          <label htmlFor="due">인도 · 이행일</label>
          <div className="my-fv">
            <input id="due" type="date" value={dueDate} disabled={lock}
                   onChange={e => setDue(e.target.value)} />
          </div>
        </div>
        <div className="my-fr">
          <label htmlFor="place">인도 장소</label>
          <div className="my-fv">
            <input id="place" type="text" maxLength={200} value={place} disabled={lock} placeholder="예: 경기 김포시 운양동 ***"
                   onChange={e => setPlace(e.target.value)} />
          </div>
        </div>
      </div>
      <p className="my-nt warn"><b>용역이면서 상대가 비사업자 개인이면 등록이 막힙니다.</b> 유료직업소개사업 등록 의무에 걸릴 수 있기 때문입니다(A-09). 용역을 하는 쪽이 사업자 인증을 마쳐야 보낼 수 있습니다.</p>

      {fee}

      {/* ── 제8조 분쟁 ── */}
      <h2 className="my-st2">제8조 (분쟁)</h2>
      <div className="my-ctrf">
        <div className="my-fr">
          <label htmlFor="court">관할법원 <span className="my-ls">(비우면 민사소송법)</span></label>
          <div className="my-fv">
            <input id="court" type="text" maxLength={100} value={court} disabled={lock} placeholder="예: 인천지방법원 부천지원"
                   onChange={e => setCourt(e.target.value)} />
          </div>
        </div>
        <div className="my-fr">
          <label htmlFor="sp">특약 <span className="my-ls">(선택)</span></label>
          <div className="my-fv">
            <textarea id="sp" rows={3} maxLength={2000} value={special} disabled={lock}
                      placeholder="인도 조건 · 하자 책임 · 분쟁 해결 방법 등"
                      onChange={e => setSpecial(e.target.value)} />
          </div>
        </div>
      </div>
      <p className="my-nt info"><b>소개뱅크는 분쟁 처리에 관여하지 않습니다.</b> 당사자끼리 해결하시는 것이 원칙입니다.</p>

      {/* 양측 상태. 한쪽만 보이면 "왜 안 되지"가 됩니다. */}
      <div className="my-ctrp">
        <div className="my-cp"><span className="my-ls">조건 합의</span>
          <b>구매 {state.buyerAgreed ? '완료' : '대기'} · 판매 {state.sellerAgreed ? '완료' : '대기'}</b></div>
        <div className="my-cp"><span className="my-ls">서명</span>
          <b>구매 {state.buyerSigned ? '완료' : '대기'} · 판매 {state.sellerSigned ? '완료' : '대기'}</b></div>
      </div>

      {!readOnly && t0 && changed && (
        <p className="my-nt warn">
          <b>조건을 바꾸면 상대의 합의는 무효가 됩니다.</b> 그러지 않으면 한쪽이 금액을
          고쳐도 상대 동의가 남아 있게 됩니다 — 다시 받으셔야 합니다.
        </p>
      )}
      {state.draft && !readOnly && <p className="my-ls" data-ctr-draft="">임시 저장한 조건으로 열었습니다 · {dtKst(state.draft.savedAt)}</p>}

      {msg && <p className={`my-nt ${msg.ok ? 'info' : 'warn'}`} role="status">{msg.t}</p>}

      {readOnly ? (
        <p className="my-nt ok">
          <b>이 계약은 {state.state === 'CANCELLED' ? '파기되었습니다' : '완료되었습니다'}.</b> 내용은 바꿀 수 없으며 기록으로 남습니다.
          {state.state === 'FULFILLED' && ' 소개비는 정산 대기로 넘어갔습니다.'}
        </p>
      ) : (
        <>
          <div className="my-hbtn my-ctra">
            <button className="my-bp" disabled={busy || !canSend || !dueDate || amount <= 0 || (state.state === 'AGREED' && !changed)}
                    title={!dueDate || amount <= 0 ? '계약 금액과 인도 · 이행일을 적어 주십시오' : state.state === 'AGREED' && !changed ? '양측이 이미 합의했습니다 — 서명해 주십시오' : ''}
                    onClick={() => call('agree', { terms: terms() })} data-ctr-send="">
              서명 요청 보내기
            </button>
            <Link className="my-bo" href={`/contracts/templates/${encodeURIComponent(state.templateCode ?? 'INTRO_STD')}?deal=${encodeURIComponent(dealId)}`}>양식 전문 보기</Link>
            <button className="my-bo" disabled={busy || !canSend}
                    onClick={() => call('draft', { terms: { ...terms(), amount: amount || undefined, dueDate: dueDate || undefined } })} data-ctr-draft-save="">
              임시 저장
            </button>
          </div>
          {/* 개발에만 있던 단계 단추 — 서명 · 이행 확인 · 수정 요청(규칙 ③ 남김) */}
          <div className="my-ctra">
            <button className="my-bo" disabled={busy || !canSign}
                    title={canSign ? '' : '양측이 조건에 합의해야 서명할 수 있습니다'}
                    onClick={() => call('sign')}>
              서명하기
            </button>
            <button className="my-bo" disabled={busy || !canFulfil}
                    title={canFulfil ? '' : '서명이 끝나야 이행을 확인할 수 있습니다'}
                    onClick={() => call('fulfil')}>
              이행 확인
            </button>
            <button className="my-bo" disabled={busy || memo.trim().length < 5}
                    title={memo.trim().length < 5 ? '무엇을 고쳐야 하는지 5자 이상 적어 주십시오' : ''}
                    onClick={() => call('counter', { memo })}>
              수정 요청
            </button>
          </div>
          <div className="my-fr">
            <label htmlFor="memo">수정 요청 내용</label>
            <div className="my-fv">
              <input id="memo" value={memo} maxLength={1000} placeholder="무엇을 고쳐야 하는지 적어 주십시오"
                     onChange={e => setMemo(e.target.value)} />
            </div>
          </div>
        </>
      )}
    </section>
  );
}

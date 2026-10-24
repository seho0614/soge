'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { consultOpen, type ConsultCat } from '@/components/mal/types';

export type ConsultCategory = ConsultCat;

type Step = 'form' | 'verify' | 'done';
interface Created { id: string; state: string; expiresInMinutes: number; note: string; devCode?: string }
interface Result { state: 'DELIVERED' | 'NO_PARTNER'; leadId?: string | null; note: string }

/** 시 · 도 — 업체의 활동 지역과 같은 짧은 이름을 씁니다(서버도 같은 이름으로 맞춥니다) */
const SIDO = ['서울', '경기', '인천', '부산', '대구', '광주', '대전', '울산', '세종',
  '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'];

/** 응답을 읽습니다 — 서버가 준 사유(message)를 그대로 보여 줍니다 */
async function read<T>(res: Response, fallback: string): Promise<T> {
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error(j?.message ?? fallback);
  return j as T;
}
const JSON_POST = { method: 'POST', headers: { 'Content-Type': 'application/json' } } as const;

/**
 * SB-MAL-CSL-010 · 030 상담 신청 → 휴대폰 확인 → 업체 1곳 전달 (D018 · 시안 `malcsl` · #/mal/consult/{code}/apply)
 *
 * **로그인 없이 신청합니다** — 소비자는 회원이 아니라 정보주체입니다.
 * 확인 전에는 업체에 아무것도 가지 않습니다(INV-12). 확인을 마치면 인증업체 1곳에 요약이 가고,
 * 이름 · 휴대폰 · 이메일(v10.28)은 그 업체가 연락처를 열 때 전달됩니다.
 * 알림톡 연동 전 개발 환경에서는 서버가 인증번호(devCode)를 응답에 실어 줍니다 — 운영에서는 오지 않습니다.
 *
 * v10.31 (w2 · 시안 CSL-030) — 한 장의 신청서: 휴대폰 칸 옆 「인증번호 받기」 → 같은 자리에 인증번호 칸 → 맨 아래 「상담 신청」(확인하고 전달).
 *   서버가 인증번호를 보낼 때 신청서를 함께 받으므로 「인증번호 받기」 전에 나머지 필수 칸(이메일 · 지역 · 동의)을 먼저 확인합니다.
 *
 * fixed 를 주면 그 업종으로 고정합니다(/mal/consult/{code}/apply — v10.24 에 주소가 옮겨졌습니다). 없으면 업종을 고를 수 있습니다(/consult).
 */
export function ConsultForm({ categories, initialId, fixed }: {
  categories: ConsultCategory[]; initialId?: string; fixed?: boolean;
}) {
  const t = useTranslations('consult');
  const open = categories.filter(consultOpen);
  const blank = {
    categoryId: initialId ?? open[0]?.id ?? '', name: '', phone: '', email: '', sido: '', sigungu: '', memo: '', agree: false,
  };
  const [step, setStep] = useState<Step>('form');
  const [f, setF] = useState(blank);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [req, setReq] = useState<Created | null>(null);
  const [code, setCode] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value });
  const cat = categories.find((c) => c.id === f.categoryId);

  /** 「인증번호 받기」 — 서버가 신청서를 받아 두고 인증번호를 보냅니다(확인 전에는 업체에 아무것도 가지 않습니다) */
  async function submit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    if (!f.categoryId) return setErr(t('form.errCat'));
    if (!f.name.trim()) return setErr(t('form.errName'));
    if (!/^01[016789]-?\d{3,4}-?\d{4}$/.test(f.phone.trim())) return setErr(t('form.errPhone'));
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) return setErr(t('form.errEmail'));
    if (!f.sido) return setErr(t('form.errSido'));
    if (!f.agree) return setErr(t('form.errAgree'));
    setBusy(true);
    try {
      const r = await read<Created>(await fetch('/api/v1/consult/requests', { method: 'POST', headers: JSON_POST.headers,
        body: JSON.stringify({
          categoryId: f.categoryId, name: f.name.trim(), phone: f.phone.trim(), email: f.email.trim(), sido: f.sido,
          sigungu: f.sigungu.trim() || undefined, memo: f.memo.trim() || undefined, agree: true,
        }) }), t('form.failGeneric'));
      setReq(r); setCode(''); setStep('verify');
    } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !req) return;
    setErr(null);
    if (!/^\d{6}$/.test(code.trim())) return setErr(t('form.errCode'));
    setBusy(true);
    try {
      const r = await read<Result>(await fetch(`/api/v1/consult/requests/${req.id}/verify`, { method: 'POST', headers: JSON_POST.headers,
        body: JSON.stringify({ code: code.trim() }) }), t('form.failGeneric'));
      setResult(r); setStep('done');
      start(() => router.refresh());
    } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
  }

  if (step === 'done' && result) {
    const ok = result.state === 'DELIVERED';
    return (
      <div className="mal-done" role="status" data-consult-done={result.leadId ?? req?.id ?? ''} data-consult-state={result.state}>
        <b>{ok ? t('form.doneOk', { name: cat?.name ?? '' }) : t('form.doneNone')}</b>
        {ok && result.leadId && <span className="mal-ls">{t('form.receipt', { id: result.leadId.slice(0, 8).toUpperCase() })}</span>}
        <p className="notice">{result.note}</p>
        {ok && <p>{t('form.doneNote')}</p>}
        <div className="mal-act">
          <button className="mal-btn ghost" type="button"
                  onClick={() => { setStep('form'); setResult(null); setReq(null); setErr(null); setF({ ...blank, categoryId: f.categoryId }); }}>
            {t('form.again')}
          </button>
          <a className="mal-btn" href="/mall?axis=consult">{t('form.toSafe')}</a>
        </div>
      </div>
    );
  }

  const sent = step === 'verify' && !!req;
  return (
    <form onSubmit={sent ? verify : (e) => { e.preventDefault(); setErr(t('form.errVerifyFirst')); }}
          className="mal-form cslf" noValidate data-consult-verify={sent ? req!.id : undefined}>
      {fixed ? (
        <input type="hidden" name="categoryId" value={f.categoryId} />
      ) : (
        <label className="fld"><span>{t('form.cat')}</span>
          <select name="categoryId" value={f.categoryId} onChange={set('categoryId')} required disabled={sent}>
            {open.length === 0 && <option value="">{t('form.noOpen')}</option>}
            {categories.filter((c) => c.consultMode === 'LEAD').map((c) => (
              <option key={c.id} value={c.id} disabled={!consultOpen(c)}>
                {c.name}{c.publishMode === 'GATED' ? t('form.gatedOnly') : ''}{consultOpen(c) ? '' : t('form.closedNow')}
              </option>
            ))}
          </select>
        </label>
      )}
      <fieldset className="mal-fs" disabled={sent}>
        <label className="fld"><span>{t('form.name')}</span>
          <input name="name" value={f.name} onChange={set('name')} maxLength={40} autoComplete="name" /></label>
        {/* 시안 CSL-030 — 휴대폰 칸 옆 「인증번호 받기」. 서버는 이때 신청서를 함께 받아 두고(업체에는 아직 아무것도 가지 않음 · INV-12) 인증번호를 보냅니다 */}
        <label className="fld"><span>{t('form.phone')}</span>
          <span className="inl">
            <input name="phone" value={f.phone} onChange={set('phone')} placeholder="010-0000-0000" inputMode="tel" autoComplete="tel" />
            <button className="mal-btn ghost sm" type="button" onClick={submit} disabled={busy || sent || open.length === 0} data-csl-otp="">
              {sent ? t('form.sent') : busy ? t('form.sending') : t('form.getCode')}</button>
          </span></label>
        {/* v10.43 (10/15 대표 결정 A) — 휴대폰(알림톡) · 이메일 둘 다로 같은 번호를 보내고, 둘 중 하나로 확인 */}
        <p className="mal-ls" data-csl-otp-hint="">{t('form.otpHint')}</p>
        {/* v10.28 (작업 지시서 4절) — 이메일(필수). 휴대폰 확인을 마친 뒤 업체가 연락처를 열 때 함께 전달 · 암호화 보관 */}
        <label className="fld"><span>{t('form.email')}</span>
          <input name="email" type="email" value={f.email} onChange={set('email')} placeholder="name@example.com" autoComplete="email" maxLength={120} /></label>
        <div className="mal-2col">
          <label className="fld"><span>{t('form.sido')}</span>
            <select name="sido" value={f.sido} onChange={set('sido')}>
              <option value="">{t('form.choose')}</option>
              {SIDO.map((s) => <option key={s} value={s}>{s}</option>)}
            </select></label>
          <label className="fld"><span>{t('form.sigungu')}</span>
            <input name="sigungu" value={f.sigungu} onChange={set('sigungu')} placeholder={t('form.sigunguPh')} maxLength={20} /></label>
        </div>
        <label className="fld"><span>{t('form.memo')}</span>
          <textarea name="memo" value={f.memo} onChange={set('memo')} rows={3} maxLength={1000}
                    placeholder={t('form.memoPh')} />
          <small className="hint">{t('form.memoHint')}</small>
        </label>
        <label className="chk"><input type="checkbox" name="agree" checked={f.agree} onChange={set('agree')} />
          <span><b>{t('form.agreeB')}</b> {t('form.agree')}</span></label>
      </fieldset>
      {sent && (
        <div className="mal-otp" data-consult-otp="">
          <p className="mal-ls">{t('form.otpNote', { note: req!.note, min: String(req!.expiresInMinutes) })}</p>
          {req!.devCode && (
            <p className="notice" data-dev-code={req!.devCode}>
              {t.rich('form.devCode', { code: req!.devCode, b: (x) => <b>{x}</b> })}
            </p>
          )}
          <label className="fld"><span>{t('form.otp')}</span>
            <input name="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                   value={code} onChange={(e) => setCode(e.target.value)} /></label>
        </div>
      )}
      {err && <p className="notice warn" role="alert">{err}</p>}
      <div className="mal-act">
        {sent && <button className="mal-btn ghost" type="button" disabled={busy}
                         onClick={() => { setStep('form'); setReq(null); setErr(null); setCode(''); }}>{t('form.rewrite')}</button>}
        <a className="mal-btn ghost" href="/consult">{t('form.repick')}</a>
        <button className="mal-btn" type="submit" disabled={busy || pending || open.length === 0} data-csl-submit="">
          {busy && sent ? t('form.verifying') : t('common.apply')}</button>
      </div>
    </form>
  );
}

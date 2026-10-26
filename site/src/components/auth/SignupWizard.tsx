'use client';
/**
 * SB-HOM-AUT-020 회원가입 — v10.31 시안 scJoin 그대로 5단계:
 *   1 가입 유형(개인 회원 · 개인 사업자 · 법인 사업자) → 2 기업 인증(사업자등록번호 「인증하기」 · 법인등록번호) →
 *   3 담당자 정보(담당자명 · 휴대폰 본인확인 · 이메일 · 부서 · 직위 · 비밀번호 · 확인) → 4 약관 동의(전체 · 필수 · 선택 · 보기 ›) →
 *   5 관심 성향(선택 · 건너뛰어도 가입) → 「가입 신청하기」 → /signup/done.
 *
 * 서버와 맞춘 것
 *   · 「인증하기」 = POST /signup/biz-check — 국세청 상태 · 이미 가입된 번호. 휴업 · 폐업 · 중복이면 다음으로 못 갑니다.
 *     국세청 상태조회는 상호 · 대표자 · 개업일을 주지 않습니다 — 시안처럼 자동으로 채우지 않고 가입자가 적습니다(결정 기록).
 *   · 개인 회원은 2단계가 없습니다(「해당 없음」으로 건너뜀) — 시안은 개인도 2단계를 지나게 그렸지만 뜻은 「사업자만 인증」.
 *   · 비밀번호 = 영문 · 숫자 · 특수문자 조합 10자 이상(시안 문구 · 서버 WEAK_PASSWORD 와 같은 규칙).
 *   · 개인 사업자는 대표자 = 가입자 본인(시안 1단계 문구 · 서버 SOLE_CEO_MISMATCH).
 *   · 휴대폰 본인확인(PASS)은 가입 직후 본인인증 화면(/verify)에서 합니다 — 여기서 번호만 받아 두면 확인되지 않은 번호가 쌓입니다.
 *   · 관심 성향은 답할 때마다 진단(POST /signup/profile-analyze · 저장 안 함)하고, 동의를 켠 경우에만 가입 뒤 저장합니다(POST /me/profile).
 * 제출 순서: 계정(POST /auth/signup · 약관 동의 기록) → 사업자 신청(POST /businesses · 사업자 유형만) → 성향 저장(동의 시).
 *
 * v10.86 (리팩토링) — 단계별 화면은 signup/Step*.tsx, 형식 · 규칙(PW_OK 등)은 signup/rules.ts 로 나눴습니다. 상태 · 이동 · 제출은 여기 그대로.
 */
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { Q } from '@/components/ProfileSurvey';
import { STEPS, PW_OK, fmtBrn, type AuthResult, type BizCheck, type SegRes, type SignupType, type JoinTerm } from './signup/rules';
import { StepType } from './signup/StepType';
import { StepBiz } from './signup/StepBiz';
import { StepPerson } from './signup/StepPerson';
import { StepTerms } from './signup/StepTerms';
import { StepProfile } from './signup/StepProfile';
import { clearDraft, loadDraft } from '@/lib/profileDraft';

export type { SignupType, JoinTerm } from './signup/rules';

export function SignupWizard({ types, terms, notices, questions, action }: {
  types: SignupType[]; terms: JoinTerm[]; notices: Array<{ code: string; title: string }>; questions: Q[];
  action: (email: string, password: string, name: string, agreed: string[], jobTitle: string) => Promise<AuthResult>;
}) {
  const router = useRouter();
  const t = useTranslations('signup');
  const [pending, start] = useTransition();
  const [step, setStep] = useState(1);
  const [type, setType] = useState(types[0]?.code ?? 'PERSONAL');
  const cur = types.find((t) => t.code === type) ?? types[0];
  const needsBiz = !!cur?.needsBiz, needsCorp = !!cur?.needsCorp;

  /* 2 기업 인증 */
  const [brn, setBrn] = useState('');
  const [chk, setChk] = useState<BizCheck | null>(null);
  const [chkBusy, setChkBusy] = useState(false);
  const [corp, setCorp] = useState('');
  const [company, setCompany] = useState('');
  const [ceo, setCeo] = useState('');
  const [bizType, setBizType] = useState('');
  const [bizItem, setBizItem] = useState('');
  /* 3 담당자 */
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [job, setJob] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  /* 4 약관 — 시안: 필수는 켜진 채로 시작하지 않습니다(직접 고름) */
  const [agreed, setAgreed] = useState<Set<string>>(new Set());
  /* 5 성향 */
  const [ans, setAns] = useState<Record<string, string[]>>({});
  const [seg, setSeg] = useState<SegRes | null>(null);
  const [segOk, setSegOk] = useState(false);
  const [filled, setFilled] = useState(false);
  const seq = useRef(0);

  /* v10.120 — 로그인 전 성향 화면에서 고른 답이 이 탭에 있으면 5단계에 채움(동의 칸은 비어 있음 · 켜야 가입 뒤 저장) */
  useEffect(() => {
    const d = loadDraft(questions);
    if (d) { setAns(d); setFilled(true); }
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const [err, setErr] = useState<string | null>(null);

  const required = terms.filter((t) => t.isRequired);
  const allOn = terms.length > 0 && terms.every((t) => agreed.has(t.code));
  const reqOn = required.every((t) => agreed.has(t.code));

  /* 유형을 바꾸면 인증 결과는 버립니다(법인 ↔ 개인 사업자 칸이 다름) */
  useEffect(() => { setChk(null); }, [type]);

  /* 성향 — 답이 바뀔 때마다 진단(저장 안 함) */
  useEffect(() => {
    const id = ++seq.current;
    if (!Object.keys(ans).length) { setSeg(null); return; }
    const t = setTimeout(async () => {
      try {
        const r = await fetch('/api/v1/signup/profile-analyze', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers: ans }),
        });
        if (!r.ok) throw new Error();
        const d = await r.json();
        if (id === seq.current) setSeg({ code: d.code, name: d.name ?? d.code, description: d.description ?? '' });
      } catch { if (id === seq.current) setSeg(null); }
    }, 200);
    return () => clearTimeout(t);
  }, [ans]);

  async function verify() {
    const d = brn.replace(/\D/g, '');
    if (d.length !== 10) { setErr(t('err.brn10')); return; }
    setErr(null); setChkBusy(true);
    try {
      const r = await fetch('/api/v1/signup/biz-check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bizRegNo: d }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setChk(null); setErr(j.message ?? t('err.lookupFail')); }
      else { setChk(j as BizCheck); setBrn(fmtBrn(d)); }
    } catch { setErr(t('err.lookupFail')); }
    setChkBusy(false);
  }

  /** 지금 단계에서 다음으로 갈 수 있는지 — 안 되면 이유 */
  function blocker(s: number): string | null {
    if (s === 2 && needsBiz) {
      if (!chk) return t('err.verifyFirst');
      if (chk.taken) return t('err.taken');
      if (!chk.ok) return t('err.closed');
      if (needsCorp && corp.replace(/\D/g, '').length !== 13) return t('err.corp13');
      if (company.trim().length < 2) return t('err.company');
      if (ceo.trim().length < 2) return t('err.ceo');
    }
    if (s === 3) {
      if (name.trim().length < 2) return t('err.name');
      if (type === 'SOLE' && name.replace(/\s/g, '') !== ceo.replace(/\s/g, '')) return t('err.soleSelf');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return t('err.email');
      if (!PW_OK(pw)) return t('err.weakPw');
      if (pw !== pw2) return t('err.pwMismatch');
    }
    if (s === 4 && !reqOn) return t('err.requiredTerms');
    return null;
  }

  function go(n: number) {
    if (n > step) {
      for (let s = step; s < n; s++) { const b = blocker(s); if (b) { setErr(b); return; } }
    }
    setErr(null);
    /* 개인 회원은 기업 인증이 없습니다 */
    if (n === 2 && !needsBiz) n = step < 2 ? 3 : 1;
    setStep(n);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function toggle(code: string) {
    setErr(null);
    setAgreed((a) => { const n = new Set(a); if (n.has(code)) n.delete(code); else n.add(code); return n; });
  }
  function pick(q: Q, oc: string) {
    setFilled(false);
    setAns((a) => {
      const c = a[q.code] ?? [];
      const next = q.isMulti ? (c.includes(oc) ? c.filter((x) => x !== oc) : [...c, oc]) : (c[0] === oc ? [] : [oc]);
      const out = { ...a, [q.code]: next };
      if (!next.length) delete out[q.code];
      return out;
    });
  }

  function submit() {
    for (let s = 1; s < 5; s++) { const b = blocker(s); if (b) { setErr(b); setStep(s === 2 && !needsBiz ? 3 : s); return; } }
    setErr(null);
    start(async () => {
      const r = await action(email.trim(), pw, name.trim(), [...agreed], job.trim());
      if (!r.ok) {
        setErr(r.message);
        if (r.code === 'DUPLICATE' || r.code === 'WEAK_PASSWORD') setStep(3);
        if (r.code === 'REQUIRED_TERM') setStep(4);
        return;
      }
      const q = new URLSearchParams({ t: type });
      if (needsBiz) {
        try {
          const b = await fetch('/api/v1/businesses', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type, bizRegNo: brn.replace(/\D/g, ''), companyName: company.trim(), ceoName: ceo.trim(),
              ...(needsCorp ? { corpRegNo: corp.replace(/\D/g, '') } : {}),
              ...(bizType.trim() ? { bizType: bizType.trim() } : {}), ...(bizItem.trim() ? { bizItem: bizItem.trim() } : {}),
            }),
          });
          if (!b.ok) { const j = await b.json().catch(() => ({})); q.set('biz', 'fail'); q.set('msg', String(j.message ?? '').slice(0, 120)); }
        } catch { q.set('biz', 'fail'); }
      }
      /* v10.115 (D123) — 성향 저장 = 맞춤형 광고 약관 동의. 4단계에서 ADPERSONAL 에 동의한 경우에만(5단계 체크로 4단계 「동의 안 함」을 뒤집지 않음) */
      if (seg && segOk && agreed.has('ADPERSONAL') && Object.keys(ans).length) {
        try {
          const pr = await fetch('/api/v1/me/profile', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers: ans, consent: true }),
          });
          if (pr.ok) clearDraft();   // v10.120 — 저장했으면 탭에 둔 답을 지움(안 했으면 성향 화면에서 다시 채워 줌)
        } catch { /* 성향은 선택 — 나의공간에서 다시 할 수 있습니다 */ }
      }
      router.push(`/signup/done?${q}`);
    });
  }

  const shown = useMemo(() => STEPS.map((k, i) => ({ n: i + 1, t: t(`steps.${k}.t`), s: i === 1 && !needsBiz ? t('steps.bizNone') : t(`steps.${k}.s`) })), [needsBiz, t]);

  return (
    <>
      <div className="w1-jst" role="list" aria-label={t('stepsLabel')}>
        {shown.map((x) => {
          const c = x.n === step ? 'on' : x.n < step ? 'dn' : '';
          return (
            <div key={x.n} role="listitem" className={`w1-js ${c}`} aria-current={x.n === step ? 'step' : undefined}>
              <span className="n">{x.n < step ? '✓' : x.n}</span>
              <span className="t"><b>{x.t}</b><em>{x.s}</em></span>
            </div>
          );
        })}
      </div>

      <div className="w1-jp">
        {step === 1 && <StepType types={types} type={type} setType={setType} />}

        {step === 2 && needsBiz && (
          <StepBiz type={type} needsCorp={needsCorp} brn={brn} setBrn={setBrn} chk={chk} setChk={setChk} chkBusy={chkBusy} verify={verify}
            corp={corp} setCorp={setCorp} company={company} setCompany={setCompany} ceo={ceo} setCeo={setCeo}
            bizType={bizType} setBizType={setBizType} bizItem={bizItem} setBizItem={setBizItem} />
        )}

        {step === 3 && <StepPerson name={name} setName={setName} email={email} setEmail={setEmail} job={job} setJob={setJob} pw={pw} setPw={setPw} pw2={pw2} setPw2={setPw2} />}

        {step === 4 && <StepTerms terms={terms} notices={notices} needsBiz={needsBiz} agreed={agreed} allOn={allOn} setAgreed={setAgreed} setErr={setErr} toggle={toggle} />}

        {step === 5 && <StepProfile questions={questions} ans={ans} pick={pick} seg={seg} segOk={segOk} setSegOk={setSegOk} filled={filled} />}

        {err && <p className="w1-err" role="alert" style={{ marginTop: 12 }}>{err}</p>}

        <div className="w1-jnav">
          {step > 1 ? <button type="button" className="w1-jb o" onClick={() => go(step === 3 && !needsBiz ? 1 : step - 1)}>{t('prev')}</button> : <span />}
          {step < 5
            ? <button type="button" className="w1-jb p" data-js={step + 1} onClick={() => go(step + 1)}
                disabled={step === 2 && needsBiz && !chk?.ok}>{t('next')}</button>
            : <button type="button" className="w1-jb a" disabled={pending} onClick={submit}>{pending ? t('submitting') : t('submit')}</button>}
        </div>
      </div>
      <p className="w1-nt3" style={{ textAlign: 'center', marginTop: 14 }}>{t('haveAccount')} <Link href="/login">{t('login')}</Link></p>
    </>
  );
}

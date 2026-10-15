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
 */
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Q } from '@/components/ProfileSurvey';

type AuthResult = { ok: true; reconsent?: boolean } | { ok: false; code: string; message: string };
export interface SignupType { code: string; label: string; sub: string; needsBiz: boolean; needsCorp: boolean }
export interface JoinTerm { code: string; title: string; isRequired: boolean }

/* 시안 1단계 설명(개인 회원 문구는 v10.28 개인 정산 — 본인인증 시 소개비 수령) */
const TYPE_TEXT: Record<string, React.ReactNode> = {
  PERSONAL: <>사업자등록 없이 바로 시작합니다. <b>요청 등록과 소개 참여</b>가 가능하며, 본인인증을 하시면 소개비도 받으십니다. <b>모든 업무</b>를 하실 수 있습니다. 등록에 인증이 필요한 업종(공인중개사 · 보험 · 의료 등)만 그 인증을 받은 뒤 등록합니다.</>,
  SOLE: <>사업자등록번호 10자리를 인증합니다. 대표자는 <b>가입자 본인</b>이어야 합니다. 휴업 · 폐업 확인을 거칩니다.</>,
  CORP: <>사업자등록번호와 <b>법인등록번호 13자리</b>를 모두 인증합니다. 대표자는 가입자와 달라도 됩니다.</>,
};
const STEPS: Array<[string, string]> = [
  ['사업자 유형', '법인 · 개인사업자'], ['기업 인증', '사업자등록번호 조회'], ['담당자 정보', '실무 담당자 · 본인확인'],
  ['약관 동의', '제출 · 심사 대기'], ['관심 성향', '광고 · 추천 맞춤 (선택)'],
];
const PW_OK = (p: string) => p.length >= 10 && /[A-Za-z]/.test(p) && /[0-9]/.test(p) && /[^A-Za-z0-9]/.test(p);
const fmtBrn = (d: string) => (d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : d);

interface BizCheck { bizRegNo: string; status: string; stub: boolean; detail: string | null; taken: boolean; ok: boolean }
interface SegRes { code: string; name: string; description: string }

export function SignupWizard({ types, terms, notices, questions, action }: {
  types: SignupType[]; terms: JoinTerm[]; notices: Array<{ code: string; title: string }>; questions: Q[];
  action: (email: string, password: string, name: string, agreed: string[], jobTitle: string) => Promise<AuthResult>;
}) {
  const router = useRouter();
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
  const seq = useRef(0);

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
    if (d.length !== 10) { setErr('사업자등록번호 10자리를 입력해 주십시오.'); return; }
    setErr(null); setChkBusy(true);
    try {
      const r = await fetch('/api/v1/signup/biz-check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bizRegNo: d }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setChk(null); setErr(j.message ?? '조회하지 못했습니다. 잠시 후 다시 시도해 주십시오.'); }
      else { setChk(j as BizCheck); setBrn(fmtBrn(d)); }
    } catch { setErr('조회하지 못했습니다. 잠시 후 다시 시도해 주십시오.'); }
    setChkBusy(false);
  }

  /** 지금 단계에서 다음으로 갈 수 있는지 — 안 되면 이유 */
  function blocker(s: number): string | null {
    if (s === 2 && needsBiz) {
      if (!chk) return '사업자등록번호를 인증해야 다음 단계로 넘어갑니다.';
      if (chk.taken) return '이미 가입된 사업자등록번호입니다 — 사업자당 계정 1개입니다.';
      if (!chk.ok) return '휴업 · 폐업 사업자는 가입할 수 없습니다.';
      if (needsCorp && corp.replace(/\D/g, '').length !== 13) return '법인등록번호 13자리를 입력해 주십시오.';
      if (company.trim().length < 2) return '상호를 입력해 주십시오.';
      if (ceo.trim().length < 2) return '대표자명을 입력해 주십시오.';
    }
    if (s === 3) {
      if (name.trim().length < 2) return '담당자명(실명)을 입력해 주십시오.';
      if (type === 'SOLE' && name.replace(/\s/g, '') !== ceo.replace(/\s/g, '')) return '개인 사업자는 대표자가 가입자 본인이어야 합니다 — 담당자명과 대표자명이 같아야 합니다.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return '이메일 주소를 확인해 주십시오.';
      if (!PW_OK(pw)) return '비밀번호는 영문 · 숫자 · 특수문자를 섞어 10자 이상이어야 합니다.';
      if (pw !== pw2) return '비밀번호 확인이 다릅니다.';
    }
    if (s === 4 && !reqOn) return '필수 항목에 모두 동의해야 다음으로 넘어갑니다.';
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
      if (seg && segOk && Object.keys(ans).length) {
        try {
          await fetch('/api/v1/me/profile', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers: ans, consent: true }),
          });
        } catch { /* 성향은 선택 — 나의공간에서 다시 할 수 있습니다 */ }
      }
      router.push(`/signup/done?${q}`);
    });
  }

  const shown = useMemo(() => STEPS.map((x, i) => ({ n: i + 1, t: x[0], s: i === 1 && !needsBiz ? '개인 회원 — 해당 없음' : x[1] })), [needsBiz]);

  return (
    <>
      <div className="w1-jst" role="list" aria-label="가입 단계">
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
        {step === 1 && (
          <div className="w1-jsec">
            <div className="w1-jc i"><span className="lb">개인 · 사업자 모두 같은 업무를 합니다</span>
              <b>개인 회원</b>도 요청 등록과 소개 참여를 하실 수 있고, <b>본인인증을 하시면 소개비도 받으십니다</b>.
              {/* v10.37 (D095 · P2P) — 모든 업무는 개인도 · 인증이 필요한 등록만 그 인증 */}
              등록에 인증이 필요한 업종(공인중개사 · 보험 · 의료 등)만 그 인증을 받은 뒤 등록합니다. 사업자로 소개비(세금계산서)를 받으시려면 나중에 나의공간에서 사업자 전환을 하시면 됩니다.</div>
            <div className="w1-jt">1. 가입 유형을 선택하세요</div>
            <div className="w1-jops" role="radiogroup" aria-label="가입 유형">
              {types.map((t) => (
                <button key={t.code} type="button" role="radio" aria-checked={type === t.code}
                  className={`w1-jop${type === t.code ? ' on' : ''}`} data-jt={t.code} onClick={() => setType(t.code)}>
                  <span className="rd" aria-hidden="true" />
                  <span><b>{t.label}</b><span>{TYPE_TEXT[t.code] ?? t.sub}</span></span>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 2 && needsBiz && (
          <div className="w1-jsec">
            <div className="w1-jt">2. 기업 인증</div>
            <div className="w1-jrow">
              <div className="w1-fl"><label htmlFor="j-brn">사업자등록번호 <span className="rq">*</span></label>
                <div className="w1-jin">
                  <input id="j-brn" className="w1-in" inputMode="numeric" placeholder="000-00-00000" value={brn}
                    onChange={(e) => { setBrn(e.target.value); setChk(null); }} />
                  <button type="button" className="w1-jvb" disabled={chkBusy} onClick={() => void verify()} data-jv="1">{chkBusy ? '조회 중…' : '인증하기'}</button>
                </div>
                <div className="w1-fh"><b>법인 · 개인사업자 모두</b> 국세청 사업자등록 상태조회를 거칩니다. 휴업 · 폐업 사업자는 가입할 수 없습니다.</div>
              </div>
              {needsCorp ? (
                <div className="w1-fl"><label htmlFor="j-corp">법인등록번호 <span className="rq">*</span></label>
                  <input id="j-corp" className="w1-in" inputMode="numeric" placeholder="000000-0000000 (13자리)" value={corp} onChange={(e) => setCorp(e.target.value)} />
                  <div className="w1-fh">법인 등기 정보와 대조합니다. 개인사업자는 이 항목이 없습니다.</div>
                </div>
              ) : (
                <div className="w1-fl"><label htmlFor="j-corp">법인등록번호</label>
                  <input id="j-corp" className="w1-in" value="개인사업자 — 해당 없음" readOnly />
                  <div className="w1-fh">개인사업자는 법인등록번호를 받지 않습니다.</div>
                </div>
              )}
            </div>
            {chk ? (
              chk.ok ? (
                <div className="w1-jc s"><span className="lb">조회 완료{chk.stub ? ' · 모의 조회' : ''}</span>
                  사업자등록번호 <b>{fmtBrn(chk.bizRegNo)}</b> · <b>{chk.status === 'VALID' ? '계속사업자' : '상태 확인 중'}</b>{chk.detail ? ` (${chk.detail})` : ''}
                  {chk.stub && <> — 국세청 실연동 전이라 <b>모의 결과</b>입니다.</>}<br />
                  국세청 상태조회는 상호 · 대표자를 알려 주지 않습니다 — 아래에 사업자등록증과 같게 적어 주십시오. <b>운영자가 승인 때 대조합니다.</b>
                </div>
              ) : (
                <div className="w1-jc e"><span className="lb">가입할 수 없습니다</span>
                  {chk.taken ? <>이미 가입된 사업자등록번호입니다 — 사업자당 계정 1개입니다.</>
                    : <>국세청 조회 결과 <b>{chk.status === 'CLOSED' ? '폐업' : '휴업'}</b> 사업자입니다{chk.detail ? ` (${chk.detail})` : ''}.</>}
                </div>
              )
            ) : (
              <>
                <div className="w1-jc w"><span className="lb">인증 전</span>
                  사업자등록번호를 인증해야 다음 단계로 넘어갑니다. <b>인증하기</b>를 누르면 국세청 상태와 이미 가입된 번호인지 봅니다.</div>
                <div className="w1-jfail"><b>이런 경우 가입이 거부됩니다</b>
                  <ul><li>휴업 · 폐업 사업자 — 유형과 무관하게 국세청 조회에서 즉시 걸립니다</li>
                    <li>이미 가입된 사업자등록번호 — 사업자당 계정 1개입니다</li>
                    <li>입력한 상호와 국세청 등록 상호가 다른 경우</li></ul></div>
              </>
            )}
            {chk?.ok && (
              <>
                <div className="w1-jrow">
                  <div className="w1-fl"><label htmlFor="j-co">상호 <span className="rq">*</span></label>
                    <input id="j-co" className="w1-in" value={company} onChange={(e) => setCompany(e.target.value)} placeholder={needsCorp ? '예) (주)세바코리아' : '사업자등록증의 상호'} maxLength={80} /></div>
                  <div className="w1-fl"><label htmlFor="j-ceo">대표자명 <span className="rq">*</span></label>
                    <input id="j-ceo" className="w1-in" value={ceo} onChange={(e) => setCeo(e.target.value)} maxLength={40} />
                    {type === 'SOLE' && <div className="w1-fh">개인 사업자는 대표자가 <b>가입자 본인</b>이어야 합니다(3단계 담당자명과 같게).</div>}</div>
                </div>
                <div className="w1-jrow">
                  <div className="w1-fl"><label htmlFor="j-bt">업태</label>
                    <input id="j-bt" className="w1-in" value={bizType} onChange={(e) => setBizType(e.target.value)} placeholder="예) 도소매" maxLength={60} /></div>
                  <div className="w1-fl"><label htmlFor="j-bi">종목</label>
                    <input id="j-bi" className="w1-in" value={bizItem} onChange={(e) => setBizItem(e.target.value)} placeholder="예) 전자상거래" maxLength={60} /></div>
                </div>
              </>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="w1-jsec">
            <div className="w1-jt">3. 담당자 정보</div>
            <div className="w1-jc i"><span className="lb">기업 인증과 다른 것</span>
              기업 인증은 <b>사업체</b>를 확인하고, 담당자 본인확인은 <b>사람</b>을 확인합니다. 정산 신청 시 예금주명과 대조되므로 실명이어야 합니다.</div>
            <div className="w1-jrow">
              <div className="w1-fl"><label htmlFor="j-nm">담당자명 <span className="rq">*</span></label>
                <input id="j-nm" className="w1-in" autoComplete="name" placeholder="실명을 입력해주세요" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} /></div>
              <div className="w1-fl"><label>휴대폰 본인확인 <span className="rq">*</span></label>
                <div className="w1-jc i" style={{ margin: 0 }}>가입을 마치면 바로 <b>본인확인(PASS)</b> 화면으로 이어집니다. 확인한 이름이 정산 계좌의 예금주명과 일치해야 합니다.</div></div>
            </div>
            <div className="w1-jrow">
              <div className="w1-fl"><label htmlFor="j-em">이메일 <span className="rq">*</span></label>
                <input id="j-em" className="w1-in" type="email" autoComplete="email" placeholder="업무용 이메일을 입력해주세요" value={email} onChange={(e) => setEmail(e.target.value)} />
                <div className="w1-fh">검수 결과 · 정산 알림이 이 주소로 발송됩니다. 로그인 아이디로도 씁니다.</div></div>
              <div className="w1-fl"><label htmlFor="j-job">부서 · 직위</label>
                <input id="j-job" className="w1-in" placeholder="예) 사업개발팀 팀장" value={job} onChange={(e) => setJob(e.target.value)} maxLength={60} /></div>
            </div>
            <div className="w1-jrow">
              <div className="w1-fl"><label htmlFor="j-pw">비밀번호 <span className="rq">*</span></label>
                <input id="j-pw" className="w1-in" type="password" autoComplete="new-password" placeholder="영문 · 숫자 · 특수문자 조합 10자 이상" value={pw} onChange={(e) => setPw(e.target.value)} />
                {pw && !PW_OK(pw) && <div className="w1-fh" style={{ color: '#B45309' }}>영문 · 숫자 · 특수문자를 섞어 10자 이상</div>}</div>
              <div className="w1-fl"><label htmlFor="j-pw2">비밀번호 확인 <span className="rq">*</span></label>
                <input id="j-pw2" className="w1-in" type="password" autoComplete="new-password" placeholder="한 번 더 입력해주세요" value={pw2} onChange={(e) => setPw2(e.target.value)} />
                {pw2 && pw !== pw2 && <div className="w1-fh" style={{ color: '#B45309' }}>위 비밀번호와 다릅니다</div>}</div>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="w1-jsec">
            <div className="w1-jt">4. 약관 동의</div>
            {terms.length === 0 ? (
              <div className="w1-jc w"><span className="lb">약관 준비 중</span>발행된 약관이 없습니다 — 운영자가 약관을 발행하면 동의를 받습니다.</div>
            ) : (
              <>
                {/* 진짜 체크 칸(키보드 · 화면 읽기 · 자동 시험이 그대로 씀) — 모양만 시안 .cb */}
                <label className="w1-agall">
                  <input type="checkbox" className="w1-cbx" data-consent-all="" checked={allOn}
                    onChange={() => { setErr(null); setAgreed(allOn ? new Set() : new Set(terms.map((t) => t.code))); }} />
                  <b>전체 동의</b><span>필수 항목과 선택 항목에 모두 동의합니다.</span>
                </label>
                <div className="w1-agl" data-consent="">
                  {terms.map((t) => {
                    const on = agreed.has(t.code);
                    return (
                      <div key={t.code} className="w1-ag" data-ag={t.code}>
                        <label className="w1-agb">
                          <input type="checkbox" className="w1-cbx" data-consent-term={t.code} checked={on} onChange={() => toggle(t.code)} />
                          <span className="t">{t.title}</span>
                          <span className={`rq2${t.isRequired ? ' r' : ''}`}>[{t.isRequired ? '필수' : '선택'}]</span>
                        </label>
                        <Link className="vw" href={`/terms/${t.code}`} target="_blank" rel="noopener">보기 ›</Link>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            {needsBiz ? (
              <div className="w1-jc w" style={{ marginTop: 14 }}><span className="lb">제출 후</span>
                <b>사업자 인증은 운영자 승인 후 완료됩니다.</b> 영업일 기준 1일 이내에 처리되며, 승인 전에도 본인인증으로
                <b>판매 등록 · 거래 만들기 등 모든 업무</b>를 하실 수 있습니다 — 승인 뒤부터 사업자로 소개비(세금계산서)를 받습니다.</div>
            ) : (
              <div className="w1-jc w" style={{ marginTop: 14 }}><span className="lb">제출 후</span>
                개인 회원은 <b>바로 가입됩니다</b>. 소개비를 받으시려면 가입 뒤 본인인증을 해 주십시오.</div>
            )}
            <div className="w1-jc i" style={{ marginTop: 10 }}><span className="lb">약관 전문</span>
              「보기 ›」를 누르면 약관 전문이 새 창으로 열립니다. 필수 항목에 모두 동의해야 다음으로 넘어갑니다.</div>
            {notices.length > 0 && (
              <div className="w1-jc i" style={{ marginTop: 10 }} data-notice-terms="1"><span className="lb">알림</span>
                {notices.map((n, i) => (
                  <span key={n.code}>{i > 0 && ' · '}<b>{n.title}</b> <Link className="vw" href={`/terms/${n.code}`} target="_blank" rel="noopener" data-notice-term={n.code}>보기 ›</Link></span>
                ))}
                {' '}— 동의를 받는 항목이 아니라 맡기는 곳 · 일을 알려 드리는 안내입니다(따로 고르실 것 없음).</div>
            )}
          </div>
        )}

        {step === 5 && (
          <div className="w1-jsec">
            <div className="w1-jt">5. 관심 성향 <span className="w1-ls">(선택 · 건너뛰어도 가입됩니다)</span></div>
            <div className="w1-jc i"><span className="lb">왜 묻는가</span>
              메인에 나갈 <b>광고</b>와 소개 추천 순서를 정하는 데만 씁니다. 광고주에게 넘기지 않고, 나중에 나의공간에서 지울 수 있습니다.</div>
            <div className="w1-prfq compact">
              {questions.map((q, i) => (
                <div key={q.code} className="w1-qcard" data-q={q.code}>
                  <div className="w1-aqh"><span className="w1-aqn">{i + 1}</span><b>{q.question}</b>{q.isMulti && <span className="w1-ls">복수 선택</span>}</div>
                  <div className="w1-qops" role="group" aria-label={q.question}>
                    {q.options.map((o) => {
                      const on = (ans[q.code] ?? []).includes(o.code);
                      return <button key={o.code} type="button" className={`w1-qop${on ? ' on' : ''}`} aria-pressed={on} onClick={() => pick(q, o.code)}>{o.label}</button>;
                    })}
                  </div>
                </div>
              ))}
            </div>
            {seg ? (
              <div className="w1-jc s"><span className="lb">현재 결과</span>
                <b>{seg.name}</b> ({seg.code}) — {seg.description}<br />
                <label className="w1-chk" style={{ marginTop: 6 }}>
                  <input type="checkbox" checked={segOk} onChange={(e) => setSegOk(e.target.checked)} />
                  가입하면 이 값을 저장해 메인 광고 · 추천 정렬에 쓰는 데 동의합니다(광고주에게 제공하지 않음 · 언제든 지움).
                </label>
              </div>
            ) : (
              <div className="w1-jc w"><span className="lb">아직 결과 없음</span>
                답하지 않고 넘어가도 됩니다. 그 경우 <b>전체 공개 광고</b>만 나갑니다.</div>
            )}
          </div>
        )}

        {err && <p className="w1-err" role="alert" style={{ marginTop: 12 }}>{err}</p>}

        <div className="w1-jnav">
          {step > 1 ? <button type="button" className="w1-jb o" onClick={() => go(step === 3 && !needsBiz ? 1 : step - 1)}>◀ 이전</button> : <span />}
          {step < 5
            ? <button type="button" className="w1-jb p" data-js={step + 1} onClick={() => go(step + 1)}
                disabled={step === 2 && needsBiz && !chk?.ok}>다음 ▶</button>
            : <button type="button" className="w1-jb a" disabled={pending} onClick={submit}>{pending ? '신청하는 중…' : '가입 신청하기'}</button>}
        </div>
      </div>
      <p className="w1-nt3" style={{ textAlign: 'center', marginTop: 14 }}>이미 계정이 있으신가요? <Link href="/login">로그인</Link></p>
    </>
  );
}

'use client';
import { PW_OK } from './rules';

/** 회원가입 3 담당자 정보 — v10.86 SignupWizard.tsx 에서 나눔(화면 · 동작 같음) */
export function StepPerson({ name, setName, email, setEmail, job, setJob, pw, setPw, pw2, setPw2 }: {
  name: string; setName: (v: string) => void; email: string; setEmail: (v: string) => void; job: string; setJob: (v: string) => void;
  pw: string; setPw: (v: string) => void; pw2: string; setPw2: (v: string) => void;
}) {
  return (
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
          {pw && !PW_OK(pw) && <div className="w1-fh" style={{ color: 'var(--sgb-or-text)' }}>영문 · 숫자 · 특수문자를 섞어 10자 이상</div>}</div>
        <div className="w1-fl"><label htmlFor="j-pw2">비밀번호 확인 <span className="rq">*</span></label>
          <input id="j-pw2" className="w1-in" type="password" autoComplete="new-password" placeholder="한 번 더 입력해주세요" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          {pw2 && pw !== pw2 && <div className="w1-fh" style={{ color: 'var(--sgb-or-text)' }}>위 비밀번호와 다릅니다</div>}</div>
      </div>
    </div>
  );
}

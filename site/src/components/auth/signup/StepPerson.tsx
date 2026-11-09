'use client';
import { PW_OK } from './rules';
import { useTranslations } from 'next-intl';

/** 회원가입 3 담당자 정보 — v10.86 SignupWizard.tsx 에서 나눔(화면 · 동작 같음) */
export function StepPerson({ name, setName, email, setEmail, job, setJob, pw, setPw, pw2, setPw2, rc, setRc, rcInfo }: {
  name: string; setName: (v: string) => void; email: string; setEmail: (v: string) => void; job: string; setJob: (v: string) => void;
  pw: string; setPw: (v: string) => void; pw2: string; setPw2: (v: string) => void;
  rc: string; setRc: (v: string) => void; rcInfo: { state: '' | 'ok' | 'no'; name?: string };
}) {
  const t = useTranslations('signup.person');
  return (
    <div className="w1-jsec">
      <div className="w1-jt">{t('title')}</div>
      <div className="w1-jc i"><span className="lb">{t('diffLb')}</span>
        {t.rich('diffBody', { b: (c) => <b>{c}</b> })}</div>
      <div className="w1-jrow">
        <div className="w1-fl"><label htmlFor="j-nm">{t('name')} <span className="rq">*</span></label>
          <input id="j-nm" className="w1-in" autoComplete="name" placeholder={t('namePh')} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} /></div>
        <div className="w1-fl"><label>{t('phone')} <span className="rq">*</span></label>
          <div className="w1-jc i" style={{ margin: 0 }}>{t.rich('phoneBody', { b: (c) => <b>{c}</b> })}</div></div>
      </div>
      <div className="w1-jrow">
        <div className="w1-fl"><label htmlFor="j-em">{t('email')} <span className="rq">*</span></label>
          <input id="j-em" className="w1-in" type="email" autoComplete="email" placeholder={t('emailPh')} value={email} onChange={(e) => setEmail(e.target.value)} />
          <div className="w1-fh">{t('emailHint')}</div></div>
        <div className="w1-fl"><label htmlFor="j-job">{t('job')}</label>
          <input id="j-job" className="w1-in" placeholder={t('jobPh')} value={job} onChange={(e) => setJob(e.target.value)} maxLength={60} /></div>
      </div>
      <div className="w1-jrow">
        <div className="w1-fl"><label htmlFor="j-pw">{t('pw')} <span className="rq">*</span></label>
          <input id="j-pw" className="w1-in" type="password" autoComplete="new-password" placeholder={t('pwPh')} value={pw} onChange={(e) => setPw(e.target.value)} />
          {pw && !PW_OK(pw) && <div className="w1-fh" style={{ color: 'var(--sgb-or-text)' }}>{t('pwWeak')}</div>}</div>
        <div className="w1-fl"><label htmlFor="j-pw2">{t('pw2')} <span className="rq">*</span></label>
          <input id="j-pw2" className="w1-in" type="password" autoComplete="new-password" placeholder={t('pw2Ph')} value={pw2} onChange={(e) => setPw2(e.target.value)} />
          {pw2 && pw !== pw2 && <div className="w1-fh" style={{ color: 'var(--sgb-or-text)' }}>{t('pw2Diff')}</div>}</div>
      </div>
      {/* v10.218 (D189) — 추천 코드(선택) */}
      <div className="w1-jrow" data-recommend="">
        <div className="w1-fl"><label htmlFor="j-rc">{t('rc')}</label>
          <input id="j-rc" className="w1-in" autoComplete="off" placeholder={t('rcPh')} value={rc} maxLength={8}
            onChange={(e) => setRc(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
          {rcInfo.state === 'ok' && <div className="w1-fh" data-rc-state="ok">{t('rcOk', { name: rcInfo.name ?? '' })}</div>}
          {rcInfo.state === 'no' && <div className="w1-fh" data-rc-state="no" style={{ color: 'var(--sgb-or-text)' }}>{t('rcNo')}</div>}</div>
        <div className="w1-fl"><div className="w1-fh" style={{ marginTop: 26 }}>{t('rcNotice')}</div></div>
      </div>
    </div>
  );
}

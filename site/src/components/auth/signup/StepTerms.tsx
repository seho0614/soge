'use client';
import Link from 'next/link';
import type { JoinTerm } from './rules';
import { useTranslations } from 'next-intl';

/** 회원가입 4 약관 동의 — v10.86 SignupWizard.tsx 에서 나눔(화면 · 동작 같음) */
export function StepTerms({ terms, notices, needsBiz, agreed, allOn, setAgreed, setErr, toggle }: {
  terms: JoinTerm[]; notices: Array<{ code: string; title: string }>; needsBiz: boolean;
  agreed: Set<string>; allOn: boolean; setAgreed: (v: Set<string>) => void; setErr: (v: string | null) => void; toggle: (code: string) => void;
}) {
  const tr = useTranslations('signup.terms');
  return (
    <div className="w1-jsec">
      <div className="w1-jt">{tr('title')}</div>
      {terms.length === 0 ? (
        <div className="w1-jc w"><span className="lb">{tr('noneLb')}</span>{tr('noneBody')}</div>
      ) : (
        <>
          {/* 진짜 체크 칸(키보드 · 화면 읽기 · 자동 시험이 그대로 씀) — 모양만 시안 .cb */}
          <label className="w1-agall">
            <input type="checkbox" className="w1-cbx" data-consent-all="" checked={allOn}
              onChange={() => { setErr(null); setAgreed(allOn ? new Set() : new Set(terms.map((t) => t.code))); }} />
            <b>{tr('all')}</b><span>{tr('allSub')}</span>
          </label>
          <div className="w1-agl" data-consent="">
            {terms.map((t) => {
              const on = agreed.has(t.code);
              return (
                <div key={t.code} className="w1-ag" data-ag={t.code}>
                  <label className="w1-agb">
                    <input type="checkbox" className="w1-cbx" data-consent-term={t.code} checked={on} onChange={() => toggle(t.code)} />
                    <span className="t">{t.title}</span>
                    <span className={`rq2${t.isRequired ? ' r' : ''}`}>[{t.isRequired ? tr('required') : tr('optional')}]</span>
                  </label>
                  <Link className="vw" href={`/terms/${t.code}`} target="_blank" rel="noopener">{tr('view')}</Link>
                </div>
              );
            })}
          </div>
        </>
      )}
      {needsBiz ? (
        <div className="w1-jc w" style={{ marginTop: 14 }}><span className="lb">{tr('afterLb')}</span>
          {tr.rich('afterBiz', { b: (c) => <b>{c}</b> })}</div>
      ) : (
        <div className="w1-jc w" style={{ marginTop: 14 }}><span className="lb">{tr('afterLb')}</span>
          {tr.rich('afterPersonal', { b: (c) => <b>{c}</b> })}</div>
      )}
      <div className="w1-jc i" style={{ marginTop: 10 }}><span className="lb">{tr('fullLb')}</span>
        {tr('fullBody')}</div>
      {notices.length > 0 && (
        <div className="w1-jc i" style={{ marginTop: 10 }} data-notice-terms="1"><span className="lb">{tr('noticeLb')}</span>
          {notices.map((n, i) => (
            <span key={n.code}>{i > 0 && ' · '}<b>{n.title}</b> <Link className="vw" href={`/terms/${n.code}`} target="_blank" rel="noopener" data-notice-term={n.code}>{tr('view')}</Link></span>
          ))}
          {' '}{tr('noticeTail')}</div>
      )}
    </div>
  );
}

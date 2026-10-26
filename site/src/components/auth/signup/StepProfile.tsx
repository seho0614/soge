'use client';
import type { Q } from '@/components/ProfileSurvey';
import type { SegRes } from './rules';
import { useTranslations } from 'next-intl';

/** 회원가입 5 관심 성향(선택) — v10.86 SignupWizard.tsx 에서 나눔(화면 · 동작 같음) */
export function StepProfile({ questions, ans, pick, seg, segOk, setSegOk, filled = false }: {
  questions: Q[]; ans: Record<string, string[]>; pick: (q: Q, oc: string) => void;
  seg: SegRes | null; segOk: boolean; setSegOk: (v: boolean) => void; filled?: boolean;
}) {
  const t = useTranslations('signup.profile');
  return (
    <div className="w1-jsec">
      <div className="w1-jt">{t('title')} <span className="w1-ls">{t('optional')}</span></div>
      <div className="w1-jc i"><span className="lb">{t('whyLb')}</span>
        {t.rich('whyBody', { b: (c) => <b>{c}</b> })}</div>
      {filled && <p className="w1-ls" data-prf-filled>{t('draftFilled')}</p>}   {/* v10.120 로그인 전에 고른 답 */}
      <div className="w1-prfq compact">
        {questions.map((q, i) => (
          <div key={q.code} className="w1-qcard" data-q={q.code}>
            <div className="w1-aqh"><span className="w1-aqn">{i + 1}</span><b>{q.question}</b>{q.isMulti && <span className="w1-ls">{t('multi')}</span>}</div>
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
        <div className="w1-jc s"><span className="lb">{t('nowLb')}</span>
          <b>{seg.name}</b> ({seg.code}) — {seg.description}<br />
          <label className="w1-chk" style={{ marginTop: 6 }}>
            <input type="checkbox" checked={segOk} onChange={(e) => setSegOk(e.target.checked)} />
            {t('consent')}
          </label>
        </div>
      ) : (
        <div className="w1-jc w"><span className="lb">{t('noneLb')}</span>
          {t.rich('noneBody', { b: (c) => <b>{c}</b> })}</div>
      )}
    </div>
  );
}

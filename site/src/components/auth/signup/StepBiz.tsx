'use client';
import { fmtBrn, type BizCheck } from './rules';
import { useTranslations } from 'next-intl';

/** 회원가입 2 기업 인증(사업자 유형만) — v10.86 SignupWizard.tsx 에서 나눔(화면 · 동작 같음) */
export function StepBiz({ type, needsCorp, brn, setBrn, chk, setChk, chkBusy, verify, corp, setCorp, company, setCompany, ceo, setCeo, bizType, setBizType, bizItem, setBizItem }: {
  type: string; needsCorp: boolean;
  brn: string; setBrn: (v: string) => void; chk: BizCheck | null; setChk: (v: BizCheck | null) => void; chkBusy: boolean; verify: () => Promise<void>;
  corp: string; setCorp: (v: string) => void; company: string; setCompany: (v: string) => void; ceo: string; setCeo: (v: string) => void;
  bizType: string; setBizType: (v: string) => void; bizItem: string; setBizItem: (v: string) => void;
}) {
  const t = useTranslations('signup.biz');
  return (
    <div className="w1-jsec">
      <div className="w1-jt">{t('title')}</div>
      <div className="w1-jrow">
        <div className="w1-fl"><label htmlFor="j-brn">{t('brn')} <span className="rq">*</span></label>
          <div className="w1-jin">
            <input id="j-brn" className="w1-in" inputMode="numeric" placeholder="000-00-00000" value={brn}
              onChange={(e) => { setBrn(e.target.value); setChk(null); }} />
            <button type="button" className="w1-jvb" disabled={chkBusy} onClick={() => void verify()} data-jv="1">{chkBusy ? t('checking') : t('verify')}</button>
          </div>
          <div className="w1-fh">{t.rich('brnHint', { b: (c) => <b>{c}</b> })}</div>
        </div>
        {needsCorp ? (
          <div className="w1-fl"><label htmlFor="j-corp">{t('corp')} <span className="rq">*</span></label>
            <input id="j-corp" className="w1-in" inputMode="numeric" placeholder={t('corpPh')} value={corp} onChange={(e) => setCorp(e.target.value)} />
            <div className="w1-fh">{t('corpHint')}</div>
          </div>
        ) : (
          <div className="w1-fl"><label htmlFor="j-corp">{t('corp')}</label>
            <input id="j-corp" className="w1-in" value={t('corpNone')} readOnly />
            <div className="w1-fh">{t('corpNoneHint')}</div>
          </div>
        )}
      </div>
      {chk ? (
        chk.ok ? (
          <div className="w1-jc s"><span className="lb">{t('okLb')}{chk.stub ? t('okLbStub') : ''}</span>
            {t.rich('okLine', { b: (c) => <b>{c}</b>, brn: fmtBrn(chk.bizRegNo), status: chk.status === 'VALID' ? t('statusValid') : t('statusChecking'), detail: chk.detail ? ` (${chk.detail})` : '' })}
            {chk.stub && <>{t.rich('okStub', { b: (c) => <b>{c}</b> })}</>}<br />
            {t.rich('okNote', { b: (c) => <b>{c}</b> })}
          </div>
        ) : (
          <div className="w1-jc e"><span className="lb">{t('noLb')}</span>
            {chk.taken ? <>{t('taken')}</>
              : <>{t.rich('closedLine', { b: (c) => <b>{c}</b>, state: chk.status === 'CLOSED' ? t('stateClosed') : t('stateSuspended'), detail: chk.detail ? ` (${chk.detail})` : '' })}</>}
          </div>
        )
      ) : (
        <>
          <div className="w1-jc w"><span className="lb">{t('beforeLb')}</span>
            {t.rich('beforeBody', { b: (c) => <b>{c}</b> })}</div>
          <div className="w1-jfail"><b>{t('failTitle')}</b>
            <ul><li>{t('fail1')}</li>
              <li>{t('fail2')}</li>
              <li>{t('fail3')}</li></ul></div>
        </>
      )}
      {chk?.ok && (
        <>
          <div className="w1-jrow">
            <div className="w1-fl"><label htmlFor="j-co">{t('company')} <span className="rq">*</span></label>
              <input id="j-co" className="w1-in" value={company} onChange={(e) => setCompany(e.target.value)} placeholder={needsCorp ? t('companyPhCorp') : t('companyPhSole')} maxLength={80} /></div>
            <div className="w1-fl"><label htmlFor="j-ceo">{t('ceo')} <span className="rq">*</span></label>
              <input id="j-ceo" className="w1-in" value={ceo} onChange={(e) => setCeo(e.target.value)} maxLength={40} />
              {type === 'SOLE' && <div className="w1-fh">{t.rich('soleSelf', { b: (c) => <b>{c}</b> })}</div>}</div>
          </div>
          <div className="w1-jrow">
            <div className="w1-fl"><label htmlFor="j-bt">{t('bizType')}</label>
              <input id="j-bt" className="w1-in" value={bizType} onChange={(e) => setBizType(e.target.value)} placeholder={t('bizTypePh')} maxLength={60} /></div>
            <div className="w1-fl"><label htmlFor="j-bi">{t('bizItem')}</label>
              <input id="j-bi" className="w1-in" value={bizItem} onChange={(e) => setBizItem(e.target.value)} placeholder={t('bizItemPh')} maxLength={60} /></div>
          </div>
        </>
      )}
    </div>
  );
}

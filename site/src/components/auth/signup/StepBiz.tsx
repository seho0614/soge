'use client';
import { fmtBrn, type BizCheck } from './rules';

/** 회원가입 2 기업 인증(사업자 유형만) — v10.86 SignupWizard.tsx 에서 나눔(화면 · 동작 같음) */
export function StepBiz({ type, needsCorp, brn, setBrn, chk, setChk, chkBusy, verify, corp, setCorp, company, setCompany, ceo, setCeo, bizType, setBizType, bizItem, setBizItem }: {
  type: string; needsCorp: boolean;
  brn: string; setBrn: (v: string) => void; chk: BizCheck | null; setChk: (v: BizCheck | null) => void; chkBusy: boolean; verify: () => Promise<void>;
  corp: string; setCorp: (v: string) => void; company: string; setCompany: (v: string) => void; ceo: string; setCeo: (v: string) => void;
  bizType: string; setBizType: (v: string) => void; bizItem: string; setBizItem: (v: string) => void;
}) {
  return (
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
  );
}

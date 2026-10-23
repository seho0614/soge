'use client';
import Link from 'next/link';
import type { JoinTerm } from './rules';

/** 회원가입 4 약관 동의 — v10.86 SignupWizard.tsx 에서 나눔(화면 · 동작 같음) */
export function StepTerms({ terms, notices, needsBiz, agreed, allOn, setAgreed, setErr, toggle }: {
  terms: JoinTerm[]; notices: Array<{ code: string; title: string }>; needsBiz: boolean;
  agreed: Set<string>; allOn: boolean; setAgreed: (v: Set<string>) => void; setErr: (v: string | null) => void; toggle: (code: string) => void;
}) {
  return (
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
  );
}

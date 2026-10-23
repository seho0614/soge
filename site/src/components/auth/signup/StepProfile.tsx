'use client';
import type { Q } from '@/components/ProfileSurvey';
import type { SegRes } from './rules';

/** 회원가입 5 관심 성향(선택) — v10.86 SignupWizard.tsx 에서 나눔(화면 · 동작 같음) */
export function StepProfile({ questions, ans, pick, seg, segOk, setSegOk }: {
  questions: Q[]; ans: Record<string, string[]>; pick: (q: Q, oc: string) => void;
  seg: SegRes | null; segOk: boolean; setSegOk: (v: boolean) => void;
}) {
  return (
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
  );
}

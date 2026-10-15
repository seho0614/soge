/** v10.31 — 시안 AI 화면 아래의 설명 4상자(engine() — 엔진 · 어떻게 계산하나 · 한계 · 다음 단계). 화면마다 실제 동작에 맞는 글을 넘깁니다. */
export function AiEngine({ eng, how, lim, next }: { eng: React.ReactNode; how: React.ReactNode; lim: React.ReactNode; next: React.ReactNode }) {
  return (
    <div className="w1-aieng">
      <div><span className="lb">엔진</span>{eng}</div>
      <div><span className="lb">어떻게 계산하나</span>{how}</div>
      <div className="w"><span className="lb">한계</span>{lim}</div>
      <div><span className="lb">다음 단계</span>{next}</div>
    </div>
  );
}

/** 시안 userShell 의 머리(제목 · 설명) */
export function AiHead({ title, sub }: { title: string; sub: React.ReactNode }) {
  return <div className="w1-aih"><h1>{title}</h1><p>{sub}</p></div>;
}

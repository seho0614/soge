'use client';
/**
 * SB-AIS-CLS-010 AI 자동 카테고리 분류 — v10.31 시안 scAiCls: 예문 칩 1~5 · 지우기 · 글 한 칸 · 분류하기 ·
 *   결과(제한업종이면 막힘 안내 · 못 찾으면 「분류하지 못했습니다」 · 찾으면 후보 카드 3개(관 · 등급 · 비율 막대 · 걸린 어휘)) ·
 *   뽑아낸 값 표(금액 · 지역 · 규격) · 광고 연계 안내.
 * 판정은 서버(POST /ai/classify — 어휘집 가중치 · 제한업종 먼저)가 합니다. 시안은 「브라우저 밖으로 나가지 않음」이었지만
 *   실제 웹은 서버 어휘집을 씁니다 — 그 사실을 화면에 그대로 적습니다(입력 500자까지 분류 기록에 남음 · 개선 근거).
 * 어휘별 가중치 숫자는 내려오지 않습니다(규칙에 맞춰 쓰는 것을 막는 개발 규칙 — 유지). 걸린 어휘만 보입니다.
 * 후보의 「이 업종으로 등록」은 고른 분류를 기록(POST /ai/classify/feedback)하고 등록 폼으로 갑니다.
 */
import { useState } from 'react';
import Link from 'next/link';

const SAMPLES = [
  '부산 해운대 상가 건물 매매 권리금 8,500만원 · 1층 42평 · 즉시 인계 가능합니다',
  '경기 화성 공장 지붕 1,200평에 태양광 발전소 500kW 설치할 EPC 업체를 찾습니다',
  '월 3,000박스 나가는 화장품 브랜드입니다. 수도권 3PL 풀필먼트 창고 소개 부탁드립니다',
  '강남 프랜차이즈 카페 가맹점 양수도 · 보증금 5,000만원 · 월매출 3,200만원',
  '급전 필요합니다 일수 대출 가능한 곳 소개해 주세요',
];
const GN: Record<string, string> = { MNY: '소개장터', MAL: '안심소개', BIZ: '소개창업', HLT: '소개몰' };

interface Cand { code: string; name: string; gwan: string; grade: string | null; score: number; matched: string[] | null; categoryId: string | null }
interface Res {
  blocked: boolean; classified?: boolean; reasons?: Array<{ source: string; matched: string; severity: string; reason: string | null }>;
  candidates?: Cand[]; extracted?: { money: string | null; area: string | null; power: string | null; region: string | null }; note?: string;
}

export function ClassifyView() {
  const [text, setText] = useState(SAMPLES[0]!);
  const [res, setRes] = useState<Res | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(t = text) {
    if (!t.trim()) { setErr('분류할 글을 넣어 주십시오.'); setRes(null); return; }
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/v1/ai/classify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: t.slice(0, 500) }) });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d) throw new Error(d?.message);
      setRes(d);
    } catch (e) { setErr(e instanceof Error && e.message ? e.message : '분류하지 못했습니다. 잠시 후 다시 시도해 주십시오.'); setRes(null); }
    setBusy(false);
  }
  function choose(c: Cand) {
    void fetch('/api/v1/ai/classify/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.slice(0, 500), suggested: res?.candidates?.[0]?.code ?? null, chosen: c.code }) }).catch(() => null);
  }

  const cands = res?.candidates ?? [];
  const tot = cands.reduce((s, c) => s + Number(c.score || 0), 0) || 1;
  const x = res?.extracted;
  const spec = [x?.area, x?.power].filter(Boolean) as string[];

  return (
    <>
      <div className="w1-aibox">
        <div className="w1-aisam">
          {SAMPLES.map((s, i) => (
            <button key={i} type="button" className={`w1-adchip${text === s ? ' on' : ''}`} onClick={() => { setText(s); void run(s); }}>예문 {i + 1}</button>
          ))}
          <button type="button" className="w1-adchip" onClick={() => { setText(''); setRes(null); setErr(null); }}>지우기</button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); void run(); }} noValidate>
          <textarea className="w1-in" rows={3} maxLength={500} aria-label="분류할 글" placeholder="등록할 내용을 그대로 붙여 넣으십시오"
            value={text} onChange={(e) => setText(e.target.value)} />
          <div className="w1-aiact"><button className="w1-bp" type="submit" disabled={busy}>{busy ? '분류하는 중…' : '분류하기'}</button>
            <span className="w1-ls">입력한 글(500자까지)은 서버 어휘집으로 분류하고, 분류 기록에 남겨 어휘집을 고치는 근거로 씁니다.</span></div>
        </form>
      </div>
      {err && <p className="w1-err" role="alert">{err}</p>}

      {/* v10.32 — 누르기 전에도 시안의 결과 자리(후보 카드 · 뽑아낸 값 표 · 광고 연계)를 빈 모양으로 둡니다. 분류는 누를 때만(분류 기록이 남는 요청이라 열자마자 보내지 않음) */}
      {!res && !busy && (
        <div data-cls="idle">
          <div className="w1-airow">
            <div className="w1-aicand w1-aiidle">
              <div className="acdh"><b>분류 결과</b><span className="w1-bg off">대기</span></div>
              <div className="cbar"><i style={{ width: 0 }} /></div>
              <div className="cpct">「분류하기」를 누르면 관 · 분류 · 등급 후보와 걸린 어휘가 여기에 나옵니다.</div>
            </div>
          </div>
          <table className="w1-tb" style={{ marginTop: 12 }}>
            <thead><tr><th>뽑아낸 값</th><th>내용</th><th>쓰이는 곳</th></tr></thead>
            <tbody>
              <tr><td><b>금액</b></td><td><span className="w1-ls">—</span></td><td>등록 폼 금액 칸의 참고값</td></tr>
              <tr><td><b>지역</b></td><td><span className="w1-ls">—</span></td><td>지역 필터 · 파트너 서비스 지역 매칭</td></tr>
              <tr><td><b>규격</b></td><td><span className="w1-ls">—</span></td><td>상세 스펙 칸 · 업종별 등록 폼 결정</td></tr>
            </tbody>
          </table>
          <div className="w1-nt" style={{ marginTop: 10 }}><b>광고 연계</b> — 분류는 메인 광고 소재를 고를 때의 관심 업종으로 이어질 수 있습니다.
            <b> 추천 점수에는 넣지 않습니다</b> — 광고는 「광고」로 따로 표기합니다(표시광고법).</div>
        </div>
      )}
      {res?.blocked && (
        <>
          <div className="w1-nt warn" data-cls="blocked"><b>제한업종으로 걸렀습니다</b><br />
            걸린 말: {(res.reasons ?? []).map((r, i) => <span key={i} className="w1-kwx no">{r.matched}</span>)}
            {(res.reasons ?? []).some((r) => r.reason) && <><br />{[...new Set((res.reasons ?? []).map((r) => r.reason).filter(Boolean))].join(' · ')}</>}</div>
          <div className="w1-nt" style={{ marginTop: 8 }}><b>점수를 매기기 전에 막습니다.</b> 어느 분류에 가까운지 계산하지 않습니다 — 제한업종은 분류의 문제가 아니라 등록 가능 여부의 문제이기 때문입니다(INV-6).</div>
        </>
      )}
      {res && !res.blocked && !cands.length && (
        <>
          <div className="w1-nt warn" data-cls="none"><b>분류하지 못했습니다.</b> 어휘집에 걸리는 말이 하나도 없습니다. 억지로 가장 가까운 것을 고르지 않습니다 — 틀린 분류는 검수 부담을 늘리고 소개자에게 잘못된 관을 보여 줍니다.</div>
          <div className="w1-nt" style={{ marginTop: 8 }}>이럴 때는 <Link href="/register">등록 폼</Link>에서 관 · 업종을 직접 고르십시오. 못 잡은 글은 어휘집에 더할 말로 쌓입니다.</div>
        </>
      )}
      {cands.length > 0 && (
        <>
          <div className="w1-airow" data-cls="ok">
            {cands.map((c, i) => {
              const pct = Math.round((Number(c.score || 0) / tot) * 100);
              return (
                <div key={c.code} className={`w1-aicand${i === 0 ? ' on' : ''}`}>
                  <div className="acdh"><b>{c.name}</b><span className={`w1-bg ${i === 0 ? 'ok' : 'off'}`}>{i + 1}순위</span></div>
                  <div className="cbar"><i style={{ width: `${pct}%` }} /></div>
                  <div className="cpct">{pct}% · 가중치 합 {c.score}</div>
                  <div className="ameta">관 <b>{GN[c.gwan] ?? c.gwan}</b>{c.grade ? <> · 등급 <b>{c.grade}</b></> : null}</div>
                  <div className="akw">{(c.matched ?? []).map((k) => <span key={k} className="w1-kwx">{k}</span>)}</div>
                  {['MNY', 'MAL', 'BIZ'].includes(c.gwan) && (
                    <Link className="w1-bo sm" style={{ marginTop: 8 }} href={`/register?g=${c.gwan}`} onClick={() => choose(c)}>이 관으로 등록하기 ›</Link>
                  )}
                </div>
              );
            })}
          </div>
          <table className="w1-tb" style={{ marginTop: 12 }}>
            <thead><tr><th>뽑아낸 값</th><th>내용</th><th>쓰이는 곳</th></tr></thead>
            <tbody>
              <tr><td><b>금액</b></td><td>{x?.money ? <span className="w1-kwx">{x.money}</span> : <span className="w1-ls">없음</span>}</td><td>등록 폼 금액 칸의 참고값</td></tr>
              <tr><td><b>지역</b></td><td>{x?.region ? <span className="w1-kwx">{x.region}</span> : <span className="w1-ls">없음</span>}</td><td>지역 필터 · 파트너 서비스 지역 매칭</td></tr>
              <tr><td><b>규격</b></td><td>{spec.length ? spec.map((s) => <span key={s} className="w1-kwx">{s}</span>) : <span className="w1-ls">없음</span>}</td><td>상세 스펙 칸 · 업종별 등록 폼 결정</td></tr>
            </tbody>
          </table>
          <div className="w1-nt" style={{ marginTop: 10 }}><b>광고 연계</b> — 분류는 메인 광고 소재를 고를 때의 관심 업종으로 이어질 수 있습니다.
            <b> 추천 점수에는 넣지 않습니다</b> — 광고는 「광고」로 따로 표기합니다(표시광고법).</div>
        </>
      )}
    </>
  );
}

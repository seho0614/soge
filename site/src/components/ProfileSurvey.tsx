'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

/** 서버 GET /profile/questions 의 모양(question · label · isMulti). v10.30 까지 화면이 text 를 읽어 문항 · 보기 글이 비었습니다(결함 상). */
export type Q = { code: string; question: string; isMulti?: boolean; options: Array<{ code: string; label: string }> };
interface Rank { code: string; name: string; score: number }
interface Ad { code: string; advertiser: string; title: string; slot: string }
interface Result { code: string; name: string; description: string; ranking: Rank[]; upcomingAds: Ad[] }
export interface Mine { registered: boolean; segment?: string; name?: string; consentedAt?: string }

/**
 * 성향 설문 — v10.31 시안 scAiPrf 그대로: 문항 카드 6개(복수 선택 표시) · 오른쪽 「분석 결과」(세그먼트 · 근거 점수 막대) ·
 *   「이 성향에 나갈 광고」 · 「지금 적용된 값」 · 다시 하기 · 성향 쓰지 않기 · 성향 등록하기(답한 문항 n / 6).
 *
 * ── 진단과 저장을 나눕니다 ──────────────────────────────────────────
 * 답할 때마다 진단(POST /profile/analyze — 저장 안 함)으로 오른쪽 칸을 다시 그립니다.
 * 저장은 「성향 등록하기」를 누를 때만 — 그 단추 바로 위의 동의 확인을 켜야 합니다(INV-AD · 동의 없이 저장하지 않음).
 * 「성향 쓰지 않기」는 저장된 성향을 지웁니다(DELETE /me/profile) — 전체 공개 광고로 돌아갑니다.
 */
export function ProfileSurvey({ questions, mine }: { questions: Q[]; mine: Mine | null }) {
  const router = useRouter();
  const [ans, setAns] = useState<Record<string, string[]>>({});
  const [res, setRes] = useState<Result | null>(null);
  const [now, setNow] = useState<Mine | null>(mine);
  const [skipped, setSkipped] = useState(false);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const seq = useRef(0);

  const done = questions.filter((q) => (ans[q.code] ?? []).length > 0).length;

  function pick(q: Q, oc: string) {
    setAns((a) => {
      const cur = a[q.code] ?? [];
      const next = q.isMulti ? (cur.includes(oc) ? cur.filter((x) => x !== oc) : [...cur, oc]) : (cur[0] === oc ? [] : [oc]);
      const out = { ...a, [q.code]: next };
      if (!next.length) delete out[q.code];
      return out;
    });
  }

  /* 답이 바뀌면 진단만 다시(저장 안 함) */
  useEffect(() => {
    const id = ++seq.current;
    if (!Object.keys(ans).length) { setRes(null); return; }
    const t = setTimeout(async () => {
      try {
        const r = await fetch('/api/v1/profile/analyze', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers: ans }),
        });
        if (!r.ok) throw new Error();
        const d = await r.json();
        if (id === seq.current) setRes({ code: d.code, name: d.name ?? d.code, description: d.description ?? '', ranking: d.ranking ?? [], upcomingAds: d.upcomingAds ?? [] });
      } catch { if (id === seq.current) setErr('분석하지 못했습니다. 잠시 후 다시 시도해 주십시오.'); }
    }, 150);
    return () => clearTimeout(t);
  }, [ans]);

  async function save() {
    if (!agree) { setErr('성향을 광고 · 추천 정렬에 쓰는 데 동의하셔야 등록됩니다.'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/v1/me/profile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers: ans, consent: true }),
      });
      if (!r.ok) throw new Error();
      router.push('/ai/profile/done');
    } catch { setErr('저장하지 못했습니다. 잠시 후 다시 시도해 주십시오.'); setBusy(false); }
  }

  async function skip() {
    setBusy(true); setErr(null);
    try {
      if (now?.registered) {
        const r = await fetch('/api/v1/me/profile', { method: 'DELETE' });
        if (!r.ok) throw new Error();
      }
      setNow({ registered: false }); setSkipped(true); setAns({}); setRes(null);
    } catch { setErr('지우지 못했습니다. 잠시 후 다시 시도해 주십시오.'); }
    setBusy(false);
  }

  const max = res?.ranking[0]?.score ?? 0;

  return (
    <div className="w1-prfw">
      <div className="w1-prfq">
        {questions.map((q, i) => (
          <div key={q.code} className="w1-qcard" data-q={q.code}>
            <div className="w1-aqh"><span className="w1-aqn">{i + 1}</span><b>{q.question}</b>{q.isMulti && <span className="w1-ls">복수 선택</span>}</div>
            <div className="w1-qops" role="group" aria-label={q.question}>
              {q.options.map((o) => {
                const on = (ans[q.code] ?? []).includes(o.code);
                return (
                  <button key={o.code} type="button" className={`w1-qop${on ? ' on' : ''}`} aria-pressed={on} onClick={() => pick(q, o.code)}>
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {res && (
          <label className="w1-ls" style={{ display: 'flex', gap: 7, alignItems: 'flex-start', marginTop: 4 }}>
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ marginTop: 2 }} />
            <span>이 성향을 메인 광고 · 추천 정렬에 쓰는 데 동의합니다(광고주에게 제공하지 않음 · 언제든 「성향 쓰지 않기」로 지움).</span>
          </label>
        )}
        <div className="w1-prfact">
          <button type="button" className="w1-bo" onClick={() => { setAns({}); setRes(null); setErr(null); }}>다시 하기</button>
          <button type="button" className="w1-bo" disabled={busy} onClick={() => void skip()}>성향 쓰지 않기</button>
          {res
            ? <button type="button" className="w1-bp" disabled={busy || !agree} onClick={() => void save()}>{busy ? '등록하는 중…' : '성향 등록하기'}</button>
            : <button type="button" className="w1-bp" disabled>답한 문항 {done} / {questions.length}</button>}
          {now?.registered && <Link className="w1-bo" href="/ai/profile/done">등록 결과 보기</Link>}
        </div>
        {err && <p className="w1-err" role="alert">{err}</p>}
      </div>

      <aside className="w1-prfr">
        {res ? (
          <>
            <div className="w1-segbox">
              <span className="w1-lb">분석 결과</span>
              <h3>{res.name}</h3><span className="code">{res.code}</span>
              <p>{res.description}</p>
              <div className="w1-segbars">
                {res.ranking.map((x) => (
                  <div key={x.code} className="w1-segb"><span>{x.name}</span>
                    <i style={{ width: `${max ? Math.round((x.score / max) * 100) : 0}%` }} /><em>{x.score}</em></div>
                ))}
              </div>
              <div className="w1-ls">덧셈입니다 — 문항마다 세그먼트별 점수가 붙어 있고 그것을 더했습니다. 추론이 아닙니다.</div>
            </div>
            <div className="w1-segad">
              <span className="w1-lb">이 성향에 나갈 광고</span>
              {res.upcomingAds.length
                ? res.upcomingAds.map((c) => <div key={c.code} className="w1-segcr"><b>{c.title}</b><span>{c.advertiser} · {c.code}</span></div>)
                : <div className="w1-segcr none">이 세그먼트에 지정된 소재가 없습니다 — 전체 공개 광고가 나갑니다.</div>}
              <div className="w1-ls">광고는 성향으로 <b>고르기만</b> 합니다. 성향을 광고주에게 넘기지 않고, 어떤 회원이 봤는지도 광고주에게 알리지 않습니다.</div>
            </div>
          </>
        ) : (
          <div className="w1-segbox wait">
            <span className="w1-lb">분석 결과</span>
            <p>문항에 답하면 여기에 세그먼트와 근거 점수가 나옵니다. {done} / {questions.length} 문항 답했습니다.</p>
          </div>
        )}
        <div className="w1-segnow">
          <span className="w1-lb">지금 적용된 값</span>
          {now?.registered ? <><b>{now.segment}</b> · {now.name}</>
            : skipped ? <><b>성향 쓰지 않음</b> — 전체 공개 광고만 나갑니다.</>
            : <><b>없음</b> — 아직 저장하지 않았습니다.</>}
          <div className="w1-ls">저장 위치는 소개뱅크 서버(내 계정)입니다. 「성향 쓰지 않기」를 누르면 바로 지워집니다.</div>
        </div>
      </aside>
    </div>
  );
}

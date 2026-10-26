'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

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
 *   v10.115 (D123) — 이 동의가 곧 맞춤형 광고 약관(ADPERSONAL) 동의입니다(서버가 약관 동의 기록을 남김 · 옆에 약관 전문 링크).
 * 「성향 쓰지 않기」는 저장된 성향을 지우고 맞춤형 광고 동의를 철회합니다(DELETE /me/profile) — 성향을 쓰지 않는 광고만 나갑니다.
 */
export function ProfileSurvey({ questions, mine }: { questions: Q[]; mine: Mine | null }) {
  const router = useRouter();
  const tr = useTranslations('join.profileSurvey');
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
      } catch { if (id === seq.current) setErr(tr('analyzeFail')); }
    }, 150);
    return () => clearTimeout(t);
  }, [ans]);

  async function save() {
    if (!agree) { setErr(tr('needAgree')); return; }
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/v1/me/profile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers: ans, consent: true }),
      });
      if (!r.ok) {   // v10.115 — 서버 안내 그대로(약관 준비 중 · 답 형식 등)
        const j = await r.json().catch(() => ({}));
        setErr(typeof j?.message === 'string' && j.message ? j.message : tr('saveFail')); setBusy(false); return;
      }
      router.push('/ai/profile/done');
    } catch { setErr(tr('saveFail')); setBusy(false); }
  }

  async function skip() {
    setBusy(true); setErr(null);
    try {
      if (now?.registered) {
        const r = await fetch('/api/v1/me/profile', { method: 'DELETE' });
        if (!r.ok) throw new Error();
      }
      setNow({ registered: false }); setSkipped(true); setAns({}); setRes(null);
    } catch { setErr(tr('dropFail')); }
    setBusy(false);
  }

  const max = res?.ranking[0]?.score ?? 0;

  return (
    <div className="w1-prfw">
      <div className="w1-prfq">
        {questions.map((q, i) => (
          <div key={q.code} className="w1-qcard" data-q={q.code}>
            <div className="w1-aqh"><span className="w1-aqn">{i + 1}</span><b>{q.question}</b>{q.isMulti && <span className="w1-ls">{tr('multi')}</span>}</div>
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
            <span>{tr('agree')} <Link href="/terms/ADPERSONAL" target="_blank" rel="noreferrer" data-prf-terms>{tr('agreeTerms')}</Link></span>
          </label>
        )}
        <div className="w1-prfact">
          <button type="button" className="w1-bo" onClick={() => { setAns({}); setRes(null); setErr(null); setAgree(false); setSkipped(false); }}>{tr('redo')}</button>
          <button type="button" className="w1-bo" disabled={busy} onClick={() => void skip()}>{tr('skip')}</button>
          {res
            ? <button type="button" className="w1-bp" disabled={busy || !agree} onClick={() => void save()}>{busy ? tr('saving') : tr('save')}</button>
            : <button type="button" className="w1-bp" disabled>{tr('answered', { done: String(done), total: String(questions.length) })}</button>}
          {now?.registered && <Link className="w1-bo" href="/ai/profile/done">{tr('viewResult')}</Link>}
        </div>
        {err && <p className="w1-err" role="alert">{err}</p>}
      </div>

      <aside className="w1-prfr">
        {res ? (
          <>
            <div className="w1-segbox">
              <span className="w1-lb">{tr('resultLb')}</span>
              <h3>{res.name}</h3><span className="code">{res.code}</span>
              <p>{res.description}</p>
              <div className="w1-segbars">
                {res.ranking.map((x) => (
                  <div key={x.code} className="w1-segb"><span>{x.name}</span>
                    <i style={{ width: `${max ? Math.round((x.score / max) * 100) : 0}%` }} /><em>{x.score}</em></div>
                ))}
              </div>
              <div className="w1-ls">{tr('sumNote')}</div>
            </div>
            <div className="w1-segad">
              <span className="w1-lb">{tr('adsLb')}</span>
              {res.upcomingAds.length
                ? res.upcomingAds.map((c) => <div key={c.code} className="w1-segcr"><b>{c.title}</b><span>{c.advertiser} · {c.code}</span></div>)
                : <div className="w1-segcr none">{tr('adsNone')}</div>}
              <div className="w1-ls">{tr.rich('adsNote', { b: (c) => <b>{c}</b> })}</div>
            </div>
          </>
        ) : (
          <div className="w1-segbox wait">
            <span className="w1-lb">{tr('resultLb')}</span>
            <p>{tr('waitNote', { done: String(done), total: String(questions.length) })}</p>
          </div>
        )}
        <div className="w1-segnow">
          <span className="w1-lb">{tr('nowLb')}</span>
          {now?.registered ? <><b>{now.segment}</b> · {now.name}</>
            : skipped ? <>{tr.rich('nowSkipped', { b: (c) => <b>{c}</b> })}</>
            : <>{tr.rich('nowNone', { b: (c) => <b>{c}</b> })}</>}
          <div className="w1-ls">{tr('storeNote')}</div>
        </div>
      </aside>
    </div>
  );
}

'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { GWAN_PATH } from '@/lib/format';

interface Read {
  sizeMin?: number; sizeMax?: number; sizeAround?: number; priceMin?: number; priceMax?: number;
  sido?: string; sigungu?: string; urgent?: boolean; valueForMoney?: boolean; recent?: boolean; gwan?: string;
}
interface Cand { code: string; name: string; gwan: string; score: number; matched: string[] }
interface Result { read: Read; candidates: Cand[]; blocked: string | null; note: string | null; privacy: string }


const eok = (n: number) => n >= 100_000_000 ? `${+(n / 100_000_000).toFixed(1)}억` : `${Math.round(n / 10_000).toLocaleString('ko-KR')}만`;

/** 읽은 조건 → [이름, 값] 칩. "AI 가 분석했습니다" 라고 쓰지 않습니다 — 규칙 엔진입니다. */
function chips(r: Read): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  /* v10.31 — 검색 팝업의 「이렇게 찾습니다」(sug.ts)와 같은 이름 · 순서(지역 → 규모 → 조건 → 상태)로 보입니다 */
  if (r.sido || r.sigungu) out.push(['지역', [r.sido, r.sigungu].filter(Boolean).join(' ')]);
  if (r.sizeAround != null) out.push(['규모', `${r.sizeAround}평대`]);
  if (r.sizeMax != null) out.push(['규모', `${r.sizeMax}평 이내`]);
  if (r.sizeMin != null) out.push(['규모', `${r.sizeMin}평 이상`]);
  if (r.priceMax != null) out.push(['금액', `${eok(r.priceMax)}원 이내`]);
  if (r.priceMin != null) out.push(['금액', `${eok(r.priceMin)}원 이상`]);
  if (r.urgent) out.push(['조건', '급매']);
  if (r.valueForMoney) out.push(['조건', '가격 낮은 순']);
  if (r.recent) out.push(['상태', '신규']);
  return out;
}

/**
 * SB-HOM-SCH-020 검색 결과 팝업 (/search#prompt) — POST /search/prompt
 *
 * ★ 계정 정보를 함께 보내지 않습니다(INV-SCH1) — 로그인과 무관하게 같은 결과입니다.
 * ★ 검색어는 저장되지 않는다는 문구를 **반드시** 띄웁니다(법무 회신 조건). 서버 privacy 문구를 그대로 씁니다.
 * 주소 끝이 #prompt 면 열린 채로 시작합니다 — 링크로 바로 열 수 있게.
 */
export function PromptSearch({ initial, gwans }: { initial?: string; gwans: Array<{ code: string; name: string }> }) {
  /* 관 이름은 서버(/gwans)가 정본입니다 — 박아 두면 이름을 바꿀 때 여기만 남습니다 */
  const GWAN_NAME: Record<string, string> = Object.fromEntries(gwans.map((g) => [g.code, g.name]));
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(initial ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const [asked, setAsked] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const sync = () => setOpen(window.location.hash === '#prompt');
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  function show() { window.location.hash = 'prompt'; setOpen(true); }
  function close() {
    setOpen(false);
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  /* v10.29 — 검색 팝업의 「이렇게 찾습니다」 줄을 누르면 /search?q=…#prompt 로 옵니다 → 열린 채로 그 문장을 바로 읽습니다 */
  const autoRan = useRef(false);
  useEffect(() => {
    if (open && !autoRan.current && (initial ?? '').trim()) { autoRan.current = true; void ask((initial ?? '').trim()); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    await ask(q.trim());
  }

  async function ask(text: string) {
    setErr(null);
    if (!text) { setErr('찾으시는 것을 문장으로 쓰십시오. 예: 10평 이내 상가 급매 있어?'); return; }
    setBusy(true);
    try {
      const r = await fetch('/api/v1/search/prompt', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        /* ★ 쿠키를 싣지 않습니다 — 미들웨어가 로그인 토큰을 붙이지 못하게(INV-SCH1) */
        credentials: 'omit',
        body: JSON.stringify({ q: text.slice(0, 200) }),
      });
      const d = await r.json().catch(() => null) as (Result & { message?: string }) | null;
      if (!r.ok || !d) { setErr(d?.message ?? '찾지 못했습니다. 잠시 후 다시 시도해 주십시오.'); return; }
      setRes(d); setAsked(text);
    } catch {
      setErr('연결이 끊겼습니다. 잠시 후 다시 시도해 주십시오.');
    } finally { setBusy(false); }
  }

  const read = res ? chips(res.read) : [];

  return (
    <>
      <button type="button" className="pc-bo sm sch-open" onClick={show}>문장으로 찾기</button>
      {open && (
        <div className="sch-dim" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div className="sch-pop" role="dialog" aria-modal="true" aria-labelledby="sch-title" id="prompt">
            <div className="p2sechd">
              <h2 id="sch-title">{asked ? `"${asked}"` : '문장으로 찾기'}</h2>
              <button type="button" className="link-btn" onClick={close} aria-label="닫기">닫기 ✕</button>
            </div>
            <form className="search-bar" onSubmit={run}>
              <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} maxLength={200}
                placeholder="예: 10평 이내 상가 급매 있어?" aria-label="문장 검색어" />
              <button className="cta-primary" disabled={busy}>{busy ? '찾는 중…' : '찾기'}</button>
            </form>
            {err && <p className="form-error" role="alert">{err}</p>}

            {res && (
              <>
                <div className="card p2pad">
                  <b>이렇게 읽었습니다</b>
                  {read.length ? (
                    <p className="cmu-chips">{read.map(([k, v], i) => <span key={i} className="badge badge-verified_doc">{k} · {v}</span>)}</p>
                  ) : <p className="dim">조건(규모 · 금액 · 지역 · 상태)을 읽지 못했습니다.</p>}
                  <p className="dim">맞지 않으면 아래에서 직접 고르십시오.</p>
                </div>

                {res.blocked ? (
                  <div className="notice warn"><b>{res.note ?? '이 업종은 소개뱅크에서 다루지 않습니다.'}</b></div>
                ) : (
                  <>
                    <h3>어디에서 찾을까요</h3>
                    {res.candidates.length ? (
                      <div className="sch-cands">
                        {res.candidates.map((c) => (
                          <Link key={c.code + c.gwan} className="card p2pad sch-cand"
                            href={`/search?q=${encodeURIComponent(c.matched?.[0] ?? asked)}&gwanCode=${c.gwan}`} onClick={() => setOpen(false)}>
                            <strong>{c.name}</strong>
                            <span className="dim">{GWAN_NAME[c.gwan] ?? c.gwan} · {c.score}점</span>
                            {c.matched?.length > 0 && <span className="dim">걸린 말: {c.matched.join(' · ')}</span>}
                          </Link>
                        ))}
                      </div>
                    ) : <p className="empty">{res.note ?? '뚜렷하지 않습니다. 관을 직접 골라 주십시오.'}</p>}
                    <p className="sch-gwans">
                      {Object.entries(GWAN_NAME).filter(([g]) => GWAN_PATH[g]).map(([g, n]) =>
                        <Link key={g} href={`/${GWAN_PATH[g]}`} className="btn-sm">{n}</Link>)}
                    </p>
                    <p className="hint">광고는 순위 계산에서 빠집니다. 후보는 걸린 말로만 점수가 매겨졌습니다.</p>
                  </>
                )}
              </>
            )}
            {/* 법무 회신 조건 — 결과가 없어도 늘 띄웁니다 */}
            <p className="notice sch-privacy">
              <b>{res?.privacy ?? '검색어는 분류를 위해 일시적으로 처리되며 저장되지 않습니다.'}</b>{' '}
              로그인 여부와 무관하게 같은 결과가 나옵니다 — 계정 정보를 함께 보내지 않기 때문입니다.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

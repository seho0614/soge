'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { GWAN_PATH } from '@/lib/format';
import { useLocale, useTranslations } from 'next-intl';
import { isGwanKey } from '@/i18n/keys';

type T = ReturnType<typeof useTranslations<'search'>>;

interface Read {
  sizeMin?: number; sizeMax?: number; sizeAround?: number; priceMin?: number; priceMax?: number;
  sido?: string; sigungu?: string; urgent?: boolean; valueForMoney?: boolean; recent?: boolean; gwan?: string;
}
interface Cand { code: string; name: string; gwan: string; score: number; matched: string[] }
interface Result { read: Read; candidates: Cand[]; blocked: string | null; note: string | null; privacy: string }


const eok = (n: number) => n >= 100_000_000 ? `${+(n / 100_000_000).toFixed(1)}억` : `${Math.round(n / 10_000).toLocaleString('ko-KR')}만`;

/** 읽은 조건 → [이름, 값] 칩. "AI 가 분석했습니다" 라고 쓰지 않습니다 — 규칙 엔진입니다. */
function chips(r: Read, t: T): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  /* v10.31 — 검색 팝업의 「이렇게 찾습니다」(sug.ts)와 같은 이름 · 순서(지역 → 규모 → 조건 → 상태)로 보입니다 */
  if (r.sido || r.sigungu) out.push([t('prompt.chip.region'), [r.sido, r.sigungu].filter(Boolean).join(' ')]);
  if (r.sizeAround != null) out.push([t('prompt.chip.size'), t('prompt.chip.sizeAround', { n: r.sizeAround })]);
  if (r.sizeMax != null) out.push([t('prompt.chip.size'), t('prompt.chip.sizeMax', { n: r.sizeMax })]);
  if (r.sizeMin != null) out.push([t('prompt.chip.size'), t('prompt.chip.sizeMin', { n: r.sizeMin })]);
  if (r.priceMax != null) out.push([t('prompt.chip.price'), t('prompt.chip.priceMax', { v: eok(r.priceMax) })]);
  if (r.priceMin != null) out.push([t('prompt.chip.price'), t('prompt.chip.priceMin', { v: eok(r.priceMin) })]);
  if (r.urgent) out.push([t('prompt.chip.terms'), t('prompt.chip.urgent')]);
  if (r.valueForMoney) out.push([t('prompt.chip.terms'), t('prompt.chip.cheap')]);
  if (r.recent) out.push([t('prompt.chip.status'), t('prompt.chip.new')]);
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
  const t = useTranslations('search');
  const h = useTranslations('header');
  const locale = useLocale();
  /* v10.97 — 한국어는 늘 서버 이름 · 다른 언어만 사전 */
  const GWAN_NAME: Record<string, string> = Object.fromEntries(gwans.map((g) => [g.code, locale !== 'ko' && isGwanKey(g.code) ? h(`gwan.${g.code}`) : g.name]));
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
    if (!text) { setErr(t('prompt.needText')); return; }
    setBusy(true);
    try {
      const r = await fetch('/api/v1/search/prompt', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        /* ★ 쿠키를 싣지 않습니다 — 미들웨어가 로그인 토큰을 붙이지 못하게(INV-SCH1) */
        credentials: 'omit',
        body: JSON.stringify({ q: text.slice(0, 200) }),
      });
      const d = await r.json().catch(() => null) as (Result & { message?: string }) | null;
      if (!r.ok || !d) { setErr(d?.message ?? t('prompt.failed')); return; }
      setRes(d); setAsked(text);
    } catch {
      setErr(t('prompt.offline'));
    } finally { setBusy(false); }
  }

  const read = res ? chips(res.read, t) : [];

  return (
    <>
      <button type="button" className="pc-bo sm sch-open" onClick={show}>{t('prompt.open')}</button>
      {open && (
        <div className="sch-dim" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div className="sch-pop" role="dialog" aria-modal="true" aria-labelledby="sch-title" id="prompt">
            <div className="p2sechd">
              <h2 id="sch-title">{asked ? `"${asked}"` : t('prompt.open')}</h2>
              <button type="button" className="link-btn" onClick={close} aria-label={t('prompt.close')}>{t('prompt.closeX')}</button>
            </div>
            <form className="search-bar" onSubmit={run}>
              <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} maxLength={200}
                placeholder={t('prompt.placeholder')} aria-label={t('prompt.inputLabel')} />
              <button className="cta-primary" disabled={busy}>{busy ? t('prompt.busy') : t('prompt.submit')}</button>
            </form>
            {err && <p className="form-error" role="alert">{err}</p>}

            {res && (
              <>
                <div className="card p2pad">
                  <b>{t('prompt.readHead')}</b>
                  {read.length ? (
                    <p className="cmu-chips">{read.map(([k, v], i) => <span key={i} className="badge badge-verified_doc">{k} · {v}</span>)}</p>
                  ) : <p className="dim">{t('prompt.readNone')}</p>}
                  <p className="dim">{t('prompt.pickYourself')}</p>
                </div>

                {res.blocked ? (
                  <div className="notice warn"><b>{res.note ?? t('prompt.blocked')}</b></div>
                ) : (
                  <>
                    <h3>{t('prompt.where')}</h3>
                    {res.candidates.length ? (
                      <div className="sch-cands">
                        {res.candidates.map((c) => (
                          <Link key={c.code + c.gwan} className="card p2pad sch-cand"
                            href={`/search?q=${encodeURIComponent(c.matched?.[0] ?? asked)}&gwanCode=${c.gwan}`} onClick={() => setOpen(false)}>
                            <strong>{c.name}</strong>
                            <span className="dim">{GWAN_NAME[c.gwan] ?? c.gwan} · {t('prompt.score', { n: c.score })}</span>
                            {c.matched?.length > 0 && <span className="dim">{t('prompt.matched', { words: c.matched.join(' · ') })}</span>}
                          </Link>
                        ))}
                      </div>
                    ) : <p className="empty">{res.note ?? t('prompt.unclear')}</p>}
                    <p className="sch-gwans">
                      {Object.entries(GWAN_NAME).filter(([g]) => GWAN_PATH[g]).map(([g, n]) =>
                        <Link key={g} href={`/${GWAN_PATH[g]}`} className="btn-sm">{n}</Link>)}
                    </p>
                    <p className="hint">{t('prompt.hint')}</p>
                  </>
                )}
              </>
            )}
            {/* 법무 회신 조건 — 결과가 없어도 늘 띄웁니다 */}
            <p className="notice sch-privacy">
              <b>{res?.privacy ?? t('prompt.privacy')}</b>{' '}
              {t('prompt.privacyWhy')}
            </p>
          </div>
        </div>
      )}
    </>
  );
}

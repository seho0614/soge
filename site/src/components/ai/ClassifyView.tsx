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
import { useTranslations } from 'next-intl';
import { isGwanKey } from '@/i18n/keys';
import { withCodes } from '@/lib/ruleCodes';   // v10.132 규칙 코드 작게

/* 예문은 분류 서버(한국어 어휘집)로 보내는 값이라 한국어 그대로 둡니다(v10.101 다국어) */
const SAMPLES = [
  '부산 해운대 상가 건물 매매 권리금 8,500만원 · 1층 42평 · 즉시 인계 가능합니다',
  '경기 화성 공장 지붕 1,200평에 태양광 발전소 500kW 설치할 EPC 업체를 찾습니다',
  '월 3,000박스 나가는 화장품 브랜드입니다. 수도권 3PL 풀필먼트 창고 소개 부탁드립니다',
  '강남 프랜차이즈 카페 가맹점 양수도 · 보증금 5,000만원 · 월매출 3,200만원',
  '급전 필요합니다 일수 대출 가능한 곳 소개해 주세요',
];
/* 관 이름은 머리줄 사전(header.gwan.<관>) — 전 GN 표와 같은 글 */

interface Cand { code: string; name: string; gwan: string; grade: string | null; score: number; matched: string[] | null; categoryId: string | null }
interface Res {
  blocked: boolean; classified?: boolean; reasons?: Array<{ source: string; matched: string; severity: string; reason: string | null }>;
  candidates?: Cand[]; extracted?: { money: string | null; area: string | null; power: string | null; region: string | null }; note?: string;
}

export function ClassifyView() {
  const t = useTranslations('join.ai.classifyView');
  const th = useTranslations('header.gwan');
  const [text, setText] = useState(SAMPLES[0]!);
  const [res, setRes] = useState<Res | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(q = text) {
    if (!q.trim()) { setErr(t('empty')); setRes(null); return; }
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/v1/ai/classify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: q.slice(0, 500) }) });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d) throw new Error(d?.message);
      setRes(d);
    } catch (e) { setErr(e instanceof Error && e.message ? e.message : t('failed')); setRes(null); }
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
            <button key={i} type="button" className={`w1-adchip${text === s ? ' on' : ''}`} onClick={() => { setText(s); void run(s); }}>{t('sample', { n: String(i + 1) })}</button>
          ))}
          <button type="button" className="w1-adchip" onClick={() => { setText(''); setRes(null); setErr(null); }}>{t('clear')}</button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); void run(); }} noValidate>
          <textarea className="w1-in" rows={3} maxLength={500} aria-label={t('inputAria')} placeholder={t('inputPh')}
            value={text} onChange={(e) => setText(e.target.value)} />
          <div className="w1-aiact"><button className="w1-bp" type="submit" disabled={busy}>{busy ? t('working') : t('submit')}</button>
            <span className="w1-ls">{t('privacy')}</span></div>
        </form>
      </div>
      {err && <p className="w1-err" role="alert">{err}</p>}

      {/* v10.32 — 누르기 전에도 시안의 결과 자리(후보 카드 · 뽑아낸 값 표 · 광고 연계)를 빈 모양으로 둡니다. 분류는 누를 때만(분류 기록이 남는 요청이라 열자마자 보내지 않음) */}
      {!res && !busy && (
        <div data-cls="idle">
          <div className="w1-airow">
            <div className="w1-aicand w1-aiidle">
              <div className="acdh"><b>{t('idleTitle')}</b><span className="w1-bg off">{t('idleBadge')}</span></div>
              <div className="cbar"><i style={{ width: 0 }} /></div>
              <div className="cpct">{t('idleNote')}</div>
            </div>
          </div>
          <table className="w1-tb" style={{ marginTop: 12 }}>
            <thead><tr><th>{t('th.value')}</th><th>{t('th.content')}</th><th>{t('th.use')}</th></tr></thead>
            <tbody>
              <tr><td><b>{t('money')}</b></td><td><span className="w1-ls">—</span></td><td>{t('useMoney')}</td></tr>
              <tr><td><b>{t('region')}</b></td><td><span className="w1-ls">—</span></td><td>{t('useRegion')}</td></tr>
              <tr><td><b>{t('spec')}</b></td><td><span className="w1-ls">—</span></td><td>{t('useSpec')}</td></tr>
            </tbody>
          </table>
          <div className="w1-nt" style={{ marginTop: 10 }}>{t.rich('adLink', { b: (c) => <b>{c}</b> })}</div>
        </div>
      )}
      {res?.blocked && (
        <>
          <div className="w1-nt warn" data-cls="blocked"><b>{t('blockedB')}</b><br />
            {t('blockedWords')}{(res.reasons ?? []).map((r, i) => <span key={i} className="w1-kwx no">{r.matched}</span>)}
            {(res.reasons ?? []).some((r) => r.reason) && <><br />{[...new Set((res.reasons ?? []).map((r) => r.reason).filter(Boolean))].join(' · ')}</>}</div>
          <div className="w1-nt" style={{ marginTop: 8 }}>{withCodes(t.rich('blockedNote', { b: (c) => <b>{c}</b> }))}</div>
        </>
      )}
      {res && !res.blocked && !cands.length && (
        <>
          <div className="w1-nt warn" data-cls="none">{t.rich('noneB', { b: (c) => <b>{c}</b> })}</div>
          <div className="w1-nt" style={{ marginTop: 8 }}>{t.rich('noneNote', { a: (c) => <Link href="/register">{c}</Link> })}</div>
        </>
      )}
      {cands.length > 0 && (
        <>
          <div className="w1-airow" data-cls="ok">
            {cands.map((c, i) => {
              const pct = Math.round((Number(c.score || 0) / tot) * 100);
              return (
                <div key={c.code} className={`w1-aicand${i === 0 ? ' on' : ''}`}>
                  <div className="acdh"><b>{c.name}</b><span className={`w1-bg ${i === 0 ? 'ok' : 'off'}`}>{t('rank', { n: String(i + 1) })}</span></div>
                  <div className="cbar"><i style={{ width: `${pct}%` }} /></div>
                  <div className="cpct">{t('pct', { pct: String(pct), score: String(c.score) })}</div>
                  <div className="ameta">{t.rich('gwan', { gwan: isGwanKey(c.gwan) ? th(c.gwan) : c.gwan, b: (x) => <b>{x}</b> })}{c.grade ? <>{t.rich('grade', { grade: c.grade, b: (x) => <b>{x}</b> })}</> : null}</div>
                  <div className="akw">{(c.matched ?? []).map((k) => <span key={k} className="w1-kwx">{k}</span>)}</div>
                  {['MNY', 'MAL', 'BIZ'].includes(c.gwan) && (
                    <Link className="w1-bo sm" style={{ marginTop: 8 }} href={`/register?g=${c.gwan}`} onClick={() => choose(c)}>{t('register')}</Link>
                  )}
                </div>
              );
            })}
          </div>
          <table className="w1-tb" style={{ marginTop: 12 }}>
            <thead><tr><th>{t('th.value')}</th><th>{t('th.content')}</th><th>{t('th.use')}</th></tr></thead>
            <tbody>
              <tr><td><b>{t('money')}</b></td><td>{x?.money ? <span className="w1-kwx">{x.money}</span> : <span className="w1-ls">{t('noValue')}</span>}</td><td>{t('useMoney')}</td></tr>
              <tr><td><b>{t('region')}</b></td><td>{x?.region ? <span className="w1-kwx">{x.region}</span> : <span className="w1-ls">{t('noValue')}</span>}</td><td>{t('useRegion')}</td></tr>
              <tr><td><b>{t('spec')}</b></td><td>{spec.length ? spec.map((s) => <span key={s} className="w1-kwx">{s}</span>) : <span className="w1-ls">{t('noValue')}</span>}</td><td>{t('useSpec')}</td></tr>
            </tbody>
          </table>
          <div className="w1-nt" style={{ marginTop: 10 }}>{t.rich('adLink', { b: (c) => <b>{c}</b> })}</div>
        </>
      )}
    </>
  );
}

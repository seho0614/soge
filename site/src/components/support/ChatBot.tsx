'use client';
/**
 * SB-HOM-CSB-010 1:1 문의 — v10.31 시안 scAsk1 그대로: 대화창(챗봇 인사) · 입력칸 · 빠른 질문 칩 · 오른쪽(챗봇이 답하는 것 · 상담원이 답하는 것 ·
 *   안내 · 상담원 연결 · 내 문의 내역). 전: 고객센터에 챗봇이 없었습니다(결함 중).
 *
 * 답은 서버 FAQ(GET /faq?channel=BOT — 운영이 바꿈)에서 고릅니다(시안 botMatch 규칙 그대로: 같은 질문 100점 · 아니면 걸린 낱말 길이 합).
 *   모델을 부르지 않습니다 — 「AI」라고 쓰지 않습니다. 「상담원 · 사람 · 연결 · 담당자」가 들어가거나 사람이 판단할 글이면 상담원 연결을 권합니다.
 * 상담원 연결: 지금까지의 대화를 본문에 붙여 문의로 접수합니다(POST /inquiries · channel=BOT). 로그인 전이면 회신 이메일을 받습니다.
 * 대화는 이 화면(브라우저 메모리)에만 있고 상담원 연결을 누르기 전에는 서버에 남지 않습니다.
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { CS_HOURS, HAND_WHY } from './hours';

export interface BotQa { question: string; answer: string; keywords: string[]; linkHref: string | null; linkLabel: string | null; handoff: boolean }
type Msg = { me?: string; a?: string; go?: [string, string] | null; hand?: boolean };

/* v10.101 — 인사 · 빠른 질문 이름은 사전 키(deal.bot.*). 빠른 질문 값(서버 FAQ 질문 · 낱말과 견주는 글)은 한국어 그대로 */
const QUICK = [
  ['소개비는 얼마인가요', 'fee'], ['계약은 어떻게 진행하나요', 'contract'], ['정산은 언제 받나요', 'settle'],
  ['소개코드가 언제 귀속되나요', 'attr'], ['소개 신뢰도가 무엇인가요', 'trust'], ['상담원 연결', 'agent'],
] as const;

function match(qa: BotQa[], q: string): { hand?: boolean; miss?: boolean; hit?: BotQa } | null {
  const t = q.trim();
  if (!t) return null;
  if (/상담원|사람|연결|담당자/.test(t)) return { hand: true };
  let best: BotQa | null = null, score = 0;
  for (const x of qa) {
    let sc = 0;
    const qn = x.question.replace(/[?？]$/, '');
    if (qn === t.replace(/[?？]$/, '')) sc = 100;
    else x.keywords.forEach((k) => { if (k && t.includes(k)) sc += k.length; });
    if (sc > score) { score = sc; best = x; }
  }
  return score > 0 && best ? { hit: best } : { miss: true };
}

export function ChatBot({ qa, loggedIn }: { qa: BotQa[]; loggedIn: boolean }) {
  const [log, setLog] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const [handed, setHanded] = useState<{ no: string } | null>(null);
  const [email, setEmail] = useState('');
  const [askMail, setAskMail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const t = useTranslations('deal');
  const HELLO = t('bot.hello');

  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }); }, [log, handed]);

  function ask(text: string) {
    const s = text.trim();
    if (!s) return;
    const m = match(qa, s);
    const reply: Msg = m?.hand ? { a: t('bot.handReply'), hand: true }
      : m?.hit ? { a: m.hit.answer, go: m.hit.linkHref && m.hit.linkLabel ? [m.hit.linkHref, m.hit.linkLabel] : null, hand: m.hit.handoff }
      : { a: t('bot.missReply'), hand: true };
    setLog((l) => [...l, { me: s }, reply]);
    setQ('');
  }

  async function handoff() {
    setErr(null);
    if (!loggedIn && !/.+@.+\..+/.test(email)) { setAskMail(true); setErr(email ? t('bot.emailFormat') : t('bot.emailNeed')); return; }
    setBusy(true);
    const first = log.find((x) => x.me)?.me ?? '챗봇 상담';
    const transcript = [`[챗봇] ${HELLO}`, ...log.map((x) => (x.me ? `[나] ${x.me}` : `[챗봇] ${(x.a ?? '').replace(/<[^>]+>/g, '')}`))].join('\n').slice(0, 3800);
    try {
      const r = await fetch('/api/v1/inquiries', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'ETC', title: `챗봇 상담원 연결 — ${first}`.slice(0, 80), body: transcript || first, channel: 'BOT', email: loggedIn ? undefined : email }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) { setErr(d?.message ?? t('bot.handFail')); return; }
      setHanded({ no: d.no });
    } catch { setErr(t('bot.cut')); }
    finally { setBusy(false); }
  }

  return (
    <div className="w1-chatlay">
      <div style={{ minWidth: 0 }}>
        <div className="w1-chat" ref={box} aria-live="polite">
          {[{ a: HELLO } as Msg, ...log].map((r, i) => r.me ? (
            <div key={i} className="w1-cm me"><div className="bub">{r.me}</div></div>
          ) : (
            <div key={i} className="w1-cm bot"><span className="av2" aria-hidden="true">{t('bot.avatar')}</span>
              <div className="bub">{r.a}
                {(r.go || (r.hand && !handed)) && (
                  <div className="w1-cgo">
                    {r.go && <Link className="w1-bo sm" href={r.go[0]}>{r.go[1]}</Link>}
                    {r.hand && !handed && <button type="button" className="w1-bp" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => void handoff()} disabled={busy}>{t('bot.agent')}</button>}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        {handed && (
          <div className="w1-nt ok" style={{ marginTop: 10 }} role="status">{t.rich('bot.handed', { no: String(handed.no), sla: t(CS_HOURS.sla), open: t(CS_HOURS.open), lunch: t(CS_HOURS.lunch), b: (x) => <b>{x}</b>, br: () => <br /> })}</div>
        )}
        {askMail && !loggedIn && !handed && (
          <div className="w1-fld" style={{ marginTop: 10 }}><label htmlFor="bot-mail">{t('bot.emailLabel')} <i>*</i></label>
            <input id="bot-mail" className="w1-in" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
            <div className="w1-fh">{t('bot.emailHint')}</div></div>
        )}
        {err && <p className="w1-err" role="alert">{err}</p>}
        <form className="w1-cform" onSubmit={(e) => { e.preventDefault(); ask(q); }} noValidate>
          <input className="ci" name="q" autoComplete="off" aria-label={t('bot.askAria')} placeholder={t('bot.askPh')} value={q} maxLength={200} onChange={(e) => setQ(e.target.value)} />
          <button className="w1-bp" type="submit">{t('bot.send')}</button>
        </form>
        <div className="w1-quick">
          {QUICK.map(([x, k]) => <button key={x} type="button" className="qb" onClick={() => (k === 'agent' ? (log.length ? void handoff() : ask(x)) : ask(x))}>{t(`bot.quick.${k}`)}</button>)}
        </div>
      </div>
      <aside className="w1-chatside">
        <h3>{t('bot.botAnswers')}</h3>
        <ul className="w1-ul ok">{qa.slice(0, 5).map((x) => <li key={x.question}>{x.question}</li>)}</ul>
        <h3>{t('bot.agentAnswers')}</h3>
        <ul className="w1-ul no">{HAND_WHY.map((x) => <li key={x}>{t(x)}</li>)}</ul>
        <div className="w1-nt"><b>{t('bot.rule')}</b></div>
        <button type="button" className="w1-bo" style={{ width: '100%', justifyContent: 'center', marginTop: 10 }} disabled={busy || !!handed} onClick={() => void handoff()}>{t('bot.agent')}</button>
        <Link className="w1-bo" style={{ width: '100%', justifyContent: 'center', marginTop: 6 }} href="/support/history">{t('bot.history')}</Link>
      </aside>
    </div>
  );
}

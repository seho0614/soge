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
import { CS_HOURS } from './hours';

export interface BotQa { question: string; answer: string; keywords: string[]; linkHref: string | null; linkLabel: string | null; handoff: boolean }
type Msg = { me?: string; a?: string; go?: [string, string] | null; hand?: boolean };

const HELLO = '안녕하세요. 소개뱅크입니다. 무엇을 도와드릴까요?';
const QUICK = ['소개비는 얼마인가요', '계약은 어떻게 진행하나요', '정산은 언제 받나요', '소개코드가 언제 귀속되나요', '소개 신뢰도가 무엇인가요', '상담원 연결'];

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

  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }); }, [log, handed]);

  function ask(text: string) {
    const t = text.trim();
    if (!t) return;
    const m = match(qa, t);
    const reply: Msg = m?.hand ? { a: '상담원에게 넘겨 드릴까요? 아래 「상담원 연결」을 누르시면 지금까지의 대화가 그대로 첨부됩니다.', hand: true }
      : m?.hit ? { a: m.hit.answer, go: m.hit.linkHref && m.hit.linkLabel ? [m.hit.linkHref, m.hit.linkLabel] : null, hand: m.hit.handoff }
      : { a: '정확히 답할 수 있는 글이 없습니다. 다른 말로 물어보시거나 상담원에게 넘겨 주십시오.', hand: true };
    setLog((l) => [...l, { me: t }, reply]);
    setQ('');
  }

  async function handoff() {
    setErr(null);
    if (!loggedIn && !/.+@.+\..+/.test(email)) { setAskMail(true); setErr(email ? '이메일 형식을 확인해 주십시오.' : '답변받을 이메일을 적어 주십시오.'); return; }
    setBusy(true);
    const first = log.find((x) => x.me)?.me ?? '챗봇 상담';
    const transcript = [`[챗봇] ${HELLO}`, ...log.map((x) => (x.me ? `[나] ${x.me}` : `[챗봇] ${(x.a ?? '').replace(/<[^>]+>/g, '')}`))].join('\n').slice(0, 3800);
    try {
      const r = await fetch('/api/v1/inquiries', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'ETC', title: `챗봇 상담원 연결 — ${first}`.slice(0, 80), body: transcript || first, channel: 'BOT', email: loggedIn ? undefined : email }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) { setErr(d?.message ?? '상담원에게 넘기지 못했습니다. 잠시 후 다시 시도해 주십시오.'); return; }
      setHanded({ no: d.no });
    } catch { setErr('연결이 끊겼습니다.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="w1-chatlay">
      <div style={{ minWidth: 0 }}>
        <div className="w1-chat" ref={box} aria-live="polite">
          {[{ a: HELLO } as Msg, ...log].map((r, i) => r.me ? (
            <div key={i} className="w1-cm me"><div className="bub">{r.me}</div></div>
          ) : (
            <div key={i} className="w1-cm bot"><span className="av2" aria-hidden="true">소</span>
              <div className="bub">{r.a}
                {(r.go || (r.hand && !handed)) && (
                  <div className="w1-cgo">
                    {r.go && <Link className="w1-bo sm" href={r.go[0]}>{r.go[1]}</Link>}
                    {r.hand && !handed && <button type="button" className="w1-bp" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => void handoff()} disabled={busy}>상담원 연결</button>}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        {handed && (
          <div className="w1-nt ok" style={{ marginTop: 10 }} role="status"><b>상담원에게 넘겼습니다.</b> 접수번호 {handed.no}. {CS_HOURS.sla} 지금까지의 대화가 그대로 첨부되어 처음부터 다시 설명하지 않으셔도 됩니다.<br />상담 가능 시간 — {CS_HOURS.open} (점심 {CS_HOURS.lunch} 제외)</div>
        )}
        {askMail && !loggedIn && !handed && (
          <div className="w1-fld" style={{ marginTop: 10 }}><label htmlFor="bot-mail">답변받을 이메일 <i>*</i></label>
            <input id="bot-mail" className="w1-in" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
            <div className="w1-fh">로그인하지 않으셨습니다 — 상담원 답변을 이 이메일로 보내 드립니다.</div></div>
        )}
        {err && <p className="w1-err" role="alert">{err}</p>}
        <form className="w1-cform" onSubmit={(e) => { e.preventDefault(); ask(q); }} noValidate>
          <input className="ci" name="q" autoComplete="off" aria-label="챗봇에게 물어볼 내용" placeholder="궁금한 것을 적어 주세요" value={q} maxLength={200} onChange={(e) => setQ(e.target.value)} />
          <button className="w1-bp" type="submit">보내기</button>
        </form>
        <div className="w1-quick">
          {QUICK.map((x) => <button key={x} type="button" className="qb" onClick={() => (x === '상담원 연결' ? (log.length ? void handoff() : ask(x)) : ask(x))}>{x}</button>)}
        </div>
      </div>
      <aside className="w1-chatside">
        <h3>챗봇이 답하는 것</h3>
        <ul className="w1-ul ok">{qa.slice(0, 5).map((x) => <li key={x.question}>{x.question}</li>)}</ul>
        <h3>상담원이 답하는 것</h3>
        <ul className="w1-ul no">{['금액 · 정산 분쟁', '계정 · 권한', '신고 · 제재', '이용료 조정', '그 밖에 사람이 판단할 일'].map((x) => <li key={x}>{x}</li>)}</ul>
        <div className="w1-nt"><b>챗봇은 규칙과 문서로 답할 수 있는 것만 답합니다. 금액 · 계정 · 분쟁처럼 사람이 판단해야 하는 것은 상담원에게 넘깁니다.</b></div>
        <button type="button" className="w1-bo" style={{ width: '100%', justifyContent: 'center', marginTop: 10 }} disabled={busy || !!handed} onClick={() => void handoff()}>상담원 연결</button>
        <Link className="w1-bo" style={{ width: '100%', justifyContent: 'center', marginTop: 6 }} href="/support/history">내 문의 내역</Link>
      </aside>
    </div>
  );
}

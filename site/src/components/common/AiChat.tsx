'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

/**
 * 사이트 공통 「AI 상담」 단추 · 대화 창 (v10.110 · AI 에이전트 2단계 고객응대 ① 안내 · docs/171 · 서버 docs/170).
 *
 *   서버 GET /agent/chat/status 가 꺼짐이면 **아무것도 그리지 않습니다**(스위치 agent.chat.enabled · AI 전체 · 월 상한 · 엔진).
 *   묻기 POST /agent/chat · 넘기기 POST /agent/chat/{id}/handoff — 비회원은 방문자 쿠키(sgb_visitor)로 셈(사용자 웹 중계가 덮어씀).
 *   첫 줄 AI 고지는 닫을 수 없습니다(법무 회신 2026-10-25 — AI 고지 · 대화 5년 보관).
 *   상담 번호는 브라우저 세션에만 기억합니다(새로고침해도 이어 묻기 · 지난 대화는 다시 그리지 않음).
 *   파트너센터(/partner — 전용 상단바)에는 그리지 않습니다.
 *   v10.139 (4단계 · docs/209) — 답에 신청서 초안이 있으면 카드 · 「신청서 열기」는 지금 쓰는 신청 화면으로(접수는 회원이 그 화면에서 직접).
 */
type Draft = { id: string; kind: 'INQUIRY' | 'HLT_RETURN'; title: string; href: string };
type Msg = { role: 'user' | 'ai'; text: string; sources?: { question: string; linkHref: string | null }[]; handoff?: boolean; drafts?: Draft[] };
const MAX = 500;
const CONV_KEY = 'sgb_ai_chat_conv';
const OFF_KEY = 'sgb_ai_chat_off';   // 꺼짐을 1분 기억(화면마다 상태를 다시 묻지 않게)
const HIDE = ['/partner'];

const visitor = () => /(?:^|;\s*)sgb_visitor=([A-Za-z0-9-]{8,64})/.exec(document.cookie)?.[1];
const store = {
  get: (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch { /* 저장 못 해도 동작 */ } },
};
async function call<T>(path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: T & { message?: string; code?: string } }> {
  const v = visitor();
  const r = await fetch(`/api/v1${path}`, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(v ? { 'X-Visitor-Key': v } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
}
/** 끝났거나(409) 내 것이 아닌(404 — 로그인 · 쿠키가 바뀜) 상담 번호 — 지우고 새 상담으로 */
const staleConv = (status: number, code?: string) => status === 404 || code === 'CHAT_CLOSED' || code === 'CHAT_HANDED_OFF';
/** 근거 링크는 사이트 안 주소만 */
const internal = (h: string | null | undefined) => !!h && h.startsWith('/') && !h.startsWith('//');

export function AiChat() {
  const t = useTranslations('aiChat');
  const path = usePathname();
  const hidden = !!path && HIDE.some((b) => path === b || path.startsWith(b + '/'));
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [conv, setConv] = useState<string | null>(null);
  const [form, setForm] = useState(false);
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (hidden) return;
    const off = Number(store.get(OFF_KEY) ?? 0);
    if (off && Date.now() - off < 60_000) return;
    setConv(store.get(CONV_KEY));
    call<{ enabled: boolean; remaining: number | null }>('/agent/chat/status')
      .then(({ ok, data }) => {
        if (ok && data.enabled) { setEnabled(true); setRemaining(data.remaining ?? null); store.set(OFF_KEY, null); }
        else store.set(OFF_KEY, String(Date.now()));
      })
      .catch(() => undefined);
  }, [hidden]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else if (wasOpen.current) fabRef.current?.focus();   // 닫으면 단추로 돌아감(키보드 · 화면 읽기)
    wasOpen.current = open;
  }, [open]);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [msgs, busy, form, done]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // 창 안에 있을 때만 닫음(다른 팝업과 함께 닫히지 않게)
      if (e.key === 'Escape' && (document.activeElement as HTMLElement | null)?.closest('[data-ai-panel]')) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const send = useCallback(async () => {
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true); setErr(null); setDone(null);
    setMsgs((m) => [...m, { role: 'user', text: q }]); setText('');
    try {
      const { ok, status, data } = await call<{ conversationId: string; answer: string; handoff: boolean; sources: Msg['sources']; remaining: number | null; drafts?: Draft[] }>(
        '/agent/chat', { message: q, ...(conv ? { conversationId: conv } : {}) });
      if (!ok || !data.conversationId) {
        if (conv && staleConv(status, data.code)) { setConv(null); store.set(CONV_KEY, null); }   // 다음에 보내면 새 상담
        setText(q);   // 쓴 글을 되살림
        setErr(data.message ?? t('fail')); return;
      }
      setConv(data.conversationId); store.set(CONV_KEY, data.conversationId);
      setRemaining(data.remaining ?? null);
      setMsgs((m) => [...m, { role: 'ai', text: data.answer, sources: data.sources, handoff: data.handoff, drafts: (data.drafts ?? []).filter((d) => internal(d.href)) }]);
    } catch {
      setErr(t('fail'));
    } finally {
      setBusy(false);
    }
  }, [text, busy, conv, t]);

  const handoff = async () => {
    if (!conv || busy) return;
    setBusy(true); setErr(null);
    try {
      const { ok, status, data } = await call<{ inquiryId: string }>(`/agent/chat/${conv}/handoff`, { ...(email.trim() ? { email: email.trim() } : {}), ...(note.trim() ? { note: note.trim() } : {}) });
      if (!ok || typeof data.inquiryId !== 'string') {
        if (staleConv(status, data.code)) { setConv(null); store.set(CONV_KEY, null); setForm(false); }
        setErr(data.message ?? t('fail')); return;
      }
      setDone(data.inquiryId.slice(0, 8).toUpperCase()); setForm(false);
      setConv(null); store.set(CONV_KEY, null);   // 넘긴 상담은 끝 — 다음 질문은 새 상담
    } catch {
      setErr(t('fail'));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => { setConv(null); store.set(CONV_KEY, null); setMsgs([]); setErr(null); setDone(null); setForm(false); inputRef.current?.focus(); };

  if (hidden || !enabled) return null;
  const lastAi = [...msgs].reverse().find((m) => m.role === 'ai');
  return (
    <>
      {!open && (
        <button type="button" ref={fabRef} className="ai-fab" aria-label={t('fabAria')} onClick={() => setOpen(true)} data-ai-fab>
          <span aria-hidden>💬</span> {t('fab')}
        </button>
      )}
      {open && (
        <section className="ai-panel" role="dialog" aria-modal="false" aria-label={t('title')} data-ai-panel>
          <header className="ai-head">
            <b>{t('title')}</b>
            <span className="ai-sp" />
            {(msgs.length > 0 || conv) && <button type="button" className="ai-link" onClick={reset}>{t('newChat')}</button>}
            <button type="button" className="ai-x" aria-label={t('close')} onClick={() => setOpen(false)}>×</button>
          </header>
          <p className="ai-notice" data-ai-notice>{t('notice')}<br /><small>{t('noticePrivacy')}</small></p>
          <div className="ai-list" ref={listRef} aria-live="polite">
            {msgs.length === 0 && <p className="ai-msg ai">{t('hello')}</p>}
            {msgs.map((m, i) => (
              <div key={i} className={`ai-msg ${m.role}`}>
                <span className="ai-who">{m.role === 'user' ? t('you') : t('ai')}</span>
                <p>{m.text}</p>
                {m.sources?.length ? (
                  <ul className="ai-src" aria-label={t('sources')}>
                    {m.sources.map((s, j) => <li key={j}>{internal(s.linkHref) ? <Link href={s.linkHref as string}>{s.question}</Link> : s.question}</li>)}
                  </ul>
                ) : null}
                {m.drafts?.map((d) => (
                  <div key={d.id} className="ai-draft" data-ai-draft={d.kind}>
                    <b>{t(d.kind === 'INQUIRY' ? 'draftInquiry' : 'draftReturn')}</b>
                    <span>{d.title}</span>
                    <small>{t('draftNote')}</small>
                    <Link className="ai-send" href={d.href} data-ai-draft-open>{t('draftOpen')}</Link>
                  </div>
                ))}
              </div>
            ))}
            {busy && !form && <p className="ai-msg ai ai-wait">{t('sending')}</p>}
            {done && <p className="ai-done" role="status" data-ai-done>{t('handoffDone')} {t('handoffNo')} {done}</p>}
          </div>
          {err && <p className="ai-err" role="alert">{err} <Link href="/support">{t('goSupport')}</Link></p>}
          {conv && !form && (
            <div className={`ai-hand${lastAi?.handoff ? ' on' : ''}`}>
              {lastAi?.handoff && <p>{t('handoffHint')}</p>}
              <button type="button" className="ai-link" onClick={() => setForm(true)} data-ai-handoff>{t('handoff')}</button>
            </div>
          )}
          {form ? (
            <form className="ai-form" onSubmit={(e) => { e.preventDefault(); void handoff(); }}>
              <b>{t('handoffTitle')}</b>
              <label>{t('handoffEmail')} <small>{t('handoffEmailHint')}</small>
                <input type="email" value={email} maxLength={200} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
              <label>{t('handoffNote')}
                <textarea value={note} maxLength={1000} rows={2} onChange={(e) => setNote(e.target.value)} /></label>
              <div className="ai-row">
                <button type="button" className="ai-link" onClick={() => setForm(false)}>{t('handoffCancel')}</button>
                <button type="submit" className="ai-send" disabled={busy}>{t('handoffSubmit')}</button>
              </div>
            </form>
          ) : (
            <form className="ai-ask" onSubmit={(e) => { e.preventDefault(); void send(); }}>
              <textarea ref={inputRef} value={text} maxLength={MAX} rows={2} placeholder={t('placeholder')} aria-label={t('placeholder')}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) { e.preventDefault(); void send(); } }} />
              <div className="ai-row">
                <small>{t('count', { n: text.length, max: MAX })}{remaining != null ? ` · ${t('remaining', { n: remaining })}` : ''}</small>
                <button type="submit" className="ai-send" disabled={busy || !text.trim()}>{t('send')}</button>
              </div>
            </form>
          )}
        </section>
      )}
    </>
  );
}

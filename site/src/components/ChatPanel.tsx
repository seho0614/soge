'use client';
import { dtKst } from '@/lib/format';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

interface Message { id: number; senderId: string; body: string; createdAt: string; masked: boolean; mine?: boolean }

/**
 * 1:1 문의.
 *
 * 대화를 플랫폼 안에 묶는 것이 중개 이탈 대응 ③ 입니다.
 * 연락처가 본문에 노출되면 서버가 masked 로 내려줍니다.
 */
export function ChatPanel({ listingId, conversationId }: { listingId?: string; conversationId?: string }) {
  const [convId, setConvId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const t = useTranslations('deal.chat');
  const [dealBusy, setDealBusy] = useState(false);

  /* v10.27 (G-193) — 시안(scAsk)의 「계약서 요청하기 ›」. 문의한 대화로 거래를 열고(POST /conversations/{id}/deal · 이미 있으면 그 거래)
   * 계약서 작성으로 갑니다. 전에는 화면에서 거래를 만들 길이 없어 API 로만 됐습니다. */
  async function requestContract() {
    if (!convId) return;
    setDealBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/v1/conversations/${convId}/deal`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.dealId) {
        setErr(r.status === 403
          ? (d?.message ?? t('idRequired'))
          : (d?.message ?? t('dealFailRetry')));
        return;
      }
      router.push(`/deal/${d.dealId}/contract`);
    } finally { setDealBusy(false); }
  }

  /* ★ 20260930 — 서버는 첫 메시지(message)가 있어야 대화를 만들고, 응답 키는
   *   conversationId 입니다. 전에는 빈 본문으로 열고 d.id 를 찾아 **대화가 시작되지 않았습니다**
   *   (400 · 그리고 로그인 토큰이 붙지 않아 403 — middleware ② 에서 고침).
   *   이제 첫 전송 때 대화를 만들고, 이미 있으면 서버가 그 대화를 돌려줍니다. */
  /* v10.27 (G-193) — 전에는 화면을 다시 열면 대화가 비어 보였습니다(이미 보낸 문의를 불러오지 않음).
   *   conversationId 가 오면(받은 문의함) 그 대화를, listingId 만 오면 내가 이 매물에 보낸 대화를 찾아 불러옵니다. */
  useEffect(() => {
    let stop = false;
    setConvId(null); setMsgs([]);
    (async () => {
      let id = conversationId ?? null;
      if (!id && listingId) {
        const r = await fetch(`/api/v1/me/conversations?role=SENT&listingId=${encodeURIComponent(listingId)}`).catch(() => null);
        const list = r && r.ok ? await r.json().catch(() => []) : [];
        id = Array.isArray(list) && list[0]?.id ? list[0].id : null;
      }
      if (stop || !id) return;
      setConvId(id);
      await load(id);
    })();
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId, conversationId]);

  async function open(first: string): Promise<string | null> {
    if (!listingId) { setErr(t('notFound')); return null; }
    const r = await fetch('/api/v1/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetType: 'LISTING', targetId: listingId, message: first }),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok) { setErr(d?.message ?? t('openFail')); return null; }
    const id = d?.conversationId ?? d?.id ?? null;
    setConvId(id);
    return id;
  }

  async function load(id: string) {
    const r = await fetch(`/api/v1/conversations/${id}/messages`);
    if (r.ok) setMsgs(await r.json());
  }

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    const body = text;
    setText('');
    setErr(null);
    start(async () => {
      if (!convId) {
        // 첫 메시지 = 대화 생성. 서버가 메시지까지 함께 저장합니다
        const id = await open(body);
        if (!id) { setText(body); return; }
        await load(id);
        return;
      }
      const r = await fetch(`/api/v1/conversations/${convId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => null);
        setErr(d?.message ?? t('sendFail'));
        setText(body);
        return;
      }
      await load(convId);
    });
  }

  return (
    <section className="chat">
      <div className="chat-log">
        {msgs.length === 0 ? (
          <p className="empty">{t('empty')}</p>
        ) : (
          msgs.map((m) => (
            <div key={m.id} className={m.mine ? 'msg mine' : 'msg'} data-msg={m.mine ? 'mine' : 'other'}>
              <p>{m.body}</p>
              {m.masked && <em className="masked">{t('masked')}</em>}
              <time>{dtKst(m.createdAt)}</time>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      {err && <p className="form-error" role="alert">{err}</p>}

      <form className="chat-input" onSubmit={send}>
        <textarea
          value={text} onChange={(e) => setText(e.target.value)}
          placeholder={t('ph')} rows={3}
        />
        <button className="cta-primary" disabled={pending || !text.trim()}>
          {pending ? t('sending') : t('send')}
        </button>
      </form>
      {convId && (
        <div className="chat-next" data-deal-next>
          <button type="button" className="cta-primary" disabled={dealBusy} onClick={requestContract} data-request-contract>
            {dealBusy ? t('opening') : t('reqContract')}
          </button>
          <p className="hint">{t.rich('hint', { b: (x) => <b>{x}</b> })}</p>
        </div>
      )}
    </section>
  );
}

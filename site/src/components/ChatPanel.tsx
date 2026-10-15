'use client';
import { dtKst } from '@/lib/format';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

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
          ? (d?.message ?? '본인인증을 마친 회원이 거래를 열 수 있습니다.')
          : (d?.message ?? '거래를 열지 못했습니다. 잠시 후 다시 시도해 주십시오.'));
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
    if (!listingId) { setErr('대화를 찾을 수 없습니다.'); return null; }
    const r = await fetch('/api/v1/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetType: 'LISTING', targetId: listingId, message: first }),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok) { setErr(d?.message ?? '대화를 열지 못했습니다.'); return null; }
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
        setErr(d?.message ?? '보내지 못했습니다.');
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
          <p className="empty">첫 문의를 남겨 보십시오.</p>
        ) : (
          msgs.map((m) => (
            <div key={m.id} className={m.mine ? 'msg mine' : 'msg'} data-msg={m.mine ? 'mine' : 'other'}>
              <p>{m.body}</p>
              {m.masked && <em className="masked">연락처가 가려졌습니다</em>}
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
          placeholder="문의 내용을 적어 주십시오" rows={3}
        />
        <button className="cta-primary" disabled={pending || !text.trim()}>
          {pending ? '전송 중…' : '보내기'}
        </button>
      </form>
      {convId && (
        <div className="chat-next" data-deal-next>
          <button type="button" className="cta-primary" disabled={dealBusy} onClick={requestContract} data-request-contract>
            {dealBusy ? '여는 중…' : '계약서 요청하기 ›'}
          </button>
          <p className="hint">플랫폼은 계약서 <b>양식만</b> 제공하며 계약 당사자가 아닙니다. 거래를 열면 소개 이력이 기록됩니다.</p>
        </div>
      )}
    </section>
  );
}

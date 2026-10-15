'use client';
import { useEffect, useState, useTransition } from 'react';
import { ago } from '@/lib/format';

interface Question {
  id: string; question: string; answer: string | null;
  answeredAt: string | null; askerName: string; createdAt: string; canAnswer: boolean;
}

/**
 * SB-HOM-MCH-020 공개 문의.
 *
 * 1:1 문의와 다릅니다 — 누구나 볼 수 있으므로 서버가 연락처를 마스킹해 내려줍니다.
 * 마스킹된 상태로 오므로 화면에서 다시 가공하지 않습니다.
 */
export function Questions({ listingId, canAsk, notice }: {
  listingId: string; canAsk: boolean; notice?: string;
}) {
  const [rows, setRows] = useState<Question[]>([]);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [answering, setAnswering] = useState<string | null>(null);

  const load = () =>
    fetch(`/api/v1/listings/${listingId}/questions`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setRows)
      .catch(() => setRows([]));

  useEffect(() => { void load(); }, [listingId]);

  function ask(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const q = String(new FormData(form).get('question') ?? '');
    setErr(null);
    start(async () => {
      const r = await fetch(`/api/v1/listings/${listingId}/questions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => null);
        setErr(d?.message ?? '등록하지 못했습니다.');
        return;
      }
      form.reset();
      await load();
    });
  }

  function answer(id: string, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const a = String(new FormData(e.currentTarget).get('answer') ?? '');
    start(async () => {
      const r = await fetch(`/api/v1/listings/questions/${id}/answer`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: a }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => null);
        setErr(d?.message ?? '답변하지 못했습니다.');
        return;
      }
      setAnswering(null);
      await load();
    });
  }

  return (
    <section id="qna" className="qna">
      <h2>공개 문의 <span className="cnt">{rows.length}</span></h2>

      {canAsk ? (
        <form className="qna-form" onSubmit={ask}>
          <textarea name="question" rows={2} required
                    placeholder="매물에 대해 궁금한 점을 남겨 주세요" />
          <button className="cta-secondary" disabled={pending}>
            {pending ? '등록 중…' : '문의 등록'}
          </button>
        </form>
      ) : (
        <p className="hint">본인인증 후 문의를 남길 수 있습니다.</p>
      )}

      {err && <p className="form-error" role="alert">{err}</p>}

      {notice && <p className="hint">{notice}</p>}

      {rows.length === 0 ? (
        <p className="empty">첫 문의를 남겨 보세요.</p>
      ) : (
        <ul className="rows">
          {rows.map((q) => (
            <li key={q.id} className="row">
              <div className="row-head">
                <strong>{q.askerName}</strong>
                <span className="when" suppressHydrationWarning>{ago(q.createdAt)}</span>
              </div>
              <p>{q.question}</p>

              {q.answer ? (
                <div className="answer">
                  <strong>답변</strong>
                  <p>{q.answer}</p>
                </div>
              ) : q.canAnswer ? (
                answering === q.id ? (
                  <form className="qna-form" onSubmit={(e) => answer(q.id, e)}>
                    <textarea name="answer" rows={2} required placeholder="답변을 입력하세요" />
                    <button className="cta-secondary" disabled={pending}>등록</button>
                  </form>
                ) : (
                  <button className="link-btn" onClick={() => setAnswering(q.id)}>답변하기</button>
                )
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

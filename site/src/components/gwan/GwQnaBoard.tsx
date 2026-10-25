'use client';
/**
 * SB-HOM-MCH-020 공개 문의 — v10.32 시안(scQna) 단독 화면의 목록 · 단추 부분.
 *   줄마다 「Q. 질문」 · 「시간 · 답변 완료/답변 대기」 · 오른쪽 배지(답변 · 대기)
 *   단추 줄 [질문 남기기] [1:1 문의] [매물 상세로]
 * 자료 · 보내는 값은 상세의 문의 칸(GwQna)과 같습니다 — GET/POST /listings/{id}/questions · PATCH …/questions/{qid}/answer.
 * 개발에만 있는 것(그대로 둠): 답변 글자 · 질문한 사람(사업자 상호 또는 「비공개」) · 등록자의 「답변하기」.
 */
import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ago } from '@/lib/format';
import { useFmt } from '@/lib/useFmt';

interface Question {
  id: string; question: string; answer: string | null;
  answeredAt: string | null; askerName: string; createdAt: string; canAnswer: boolean;
}

export function GwQnaBoard({ listingId, detailHref, canAsk, canInquire, loggedIn, initial }: {
  listingId: string; detailHref: string; canAsk: boolean; canInquire: boolean; loggedIn: boolean; initial: Question[];
}) {
  const [rows, setRows] = useState<Question[]>(initial);
  const t = useTranslations('detail.board');
  const f = useFmt();
  const tc = useTranslations('detail.common');
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [answering, setAnswering] = useState<string | null>(null);
  const load = () =>
    fetch(`/api/v1/listings/${listingId}/questions`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (Array.isArray(d)) setRows(d); }).catch(() => undefined);
  useEffect(() => { void load(); }, [listingId]);   // eslint-disable-line react-hooks/exhaustive-deps

  function ask(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const q = String(new FormData(form).get('question') ?? '');
    setErr(null);
    start(async () => {
      const r = await fetch(`/api/v1/listings/${listingId}/questions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q }),
      });
      if (!r.ok) { const d = await r.json().catch(() => null); setErr(d?.message ?? tc('registerFail')); return; }
      form.reset(); setAsking(false);
      setMsg(t('asked'));
      await load();
    });
  }
  function answer(id: string, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const a = String(new FormData(e.currentTarget).get('answer') ?? '');
    start(async () => {
      const r = await fetch(`/api/v1/listings/questions/${id}/answer`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answer: a }),
      });
      if (!r.ok) { const d = await r.json().catch(() => null); setErr(d?.message ?? tc('answerFail')); return; }
      setAnswering(null); await load();
    });
  }
  function onAsk() {
    setMsg(null); setErr(null);
    if (canAsk) { setAsking((x) => !x); return; }
    setMsg(loggedIn ? t('needIdentity') : t('needLogin'));
  }

  return (
    <div data-qna-board="" data-n={rows.length}>
      {rows.length === 0 ? (
        <div className="my-emp" data-qna-empty="">{t('empty')}</div>
      ) : rows.map((q) => (
        <div key={q.id} className="my-lrow" data-qna-row={q.id}>
          <div className="my-lt">
            <b>Q. {q.question}</b>
            <span className="my-ls" suppressHydrationWarning>{f.ago(q.createdAt, ago(q.createdAt))} · {q.answer ? t('answered') : t('waiting')} · {q.askerName}</span>
            {q.answer && <p className="my-ls" style={{ margin: '6px 0 0', color: 'var(--mink2)' }}><b>A.</b> {q.answer}</p>}
            {!q.answer && q.canAnswer && (answering === q.id ? (
              <form onSubmit={(e) => answer(q.id, e)} style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <textarea className="my-inp" name="answer" rows={2} required placeholder={tc('answerPh')} />
                <button className="my-bp sm" disabled={pending}>{tc('submit')}</button>
              </form>
            ) : <button type="button" className="my-bo sm" style={{ marginTop: 6 }} onClick={() => setAnswering(q.id)}>{tc('answerBtn')}</button>)}
          </div>
          <span />
          <div className="my-lact">{q.answer ? <span className="my-bg ok">{t('badgeAnswer')}</span> : <span className="my-bg wait">{t('badgeWait')}</span>}</div>
        </div>
      ))}

      {asking && (
        <form className="my-card" onSubmit={ask} data-qna-ask="">
          <label className="my-fld" style={{ marginBottom: 8 }}>
            <span>{t('question')}</span>
            <textarea className="my-inp" name="question" rows={3} required style={{ maxWidth: 'none' }}
                      placeholder={t('askPh')} />
          </label>
          <button className="my-bp" disabled={pending}>{pending ? tc('submitting') : t('submitQ')}</button>
        </form>
      )}
      {err && <p className="form-error" role="alert">{err}</p>}
      {msg && <p className="my-nt ok" role="status">{msg}</p>}

      <div className="my-hbtn">
        <button type="button" className="my-bp" onClick={onAsk} aria-expanded={asking}>{t('askBtn')}</button>
        <Link className="my-bo" href={canInquire ? `/chat/${listingId}` : `${detailHref}#ask`} prefetch={false}>{t('inquire')}</Link>
        <Link className="my-bo" href={detailHref}>{t('toDetail')}</Link>
      </div>
    </div>
  );
}

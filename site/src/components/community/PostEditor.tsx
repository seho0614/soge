'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { WRITABLE, isBoard, type ClassifyResult } from './types';

interface Deal { id: string; title: string; statusLabel: string }

/**
 * 글쓰기 · 수정 (SB-HOM-CMU-030)
 *
 *   POST  /community/classify          제목·본문으로 게시판 추천
 *   POST  /me/community/posts          새 글
 *   PATCH /me/community/posts/{id}     수정
 *   DELETE /me/community/posts/{id}    삭제 (수정 화면에서)
 *
 * ★ 읽은 말(matched)을 그대로 보여 드립니다. "AI 가 분석했습니다" 라고 쓰지 않습니다 —
 *   규칙 엔진이라 거짓말이 됩니다(시안 주석).
 * ★ 애매하면(confident=false) 억지로 고르지 않고 직접 고르시게 합니다.
 * ★ 소개 후기는 성사된 거래가 있어야 합니다(DB fn_post_guard). 거래를 고르게 합니다.
 */
export function PostEditor({ edit, deals }: {
  edit?: { id: string; title: string; body: string; board: string };
  deals: Deal[];
}) {
  const tr = useTranslations('plaza');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(edit?.title ?? '');
  const [body, setBody] = useState(edit?.body ?? '');
  const [board, setBoard] = useState<string>(edit?.board ?? '');
  const [dealId, setDealId] = useState('');
  const [guess, setGuess] = useState<ClassifyResult | null>(null);
  const [guessing, setGuessing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function classify() {
    if (title.trim().length < 1) { setErr(tr('editor.titleFirst')); return; }
    setErr(null); setGuessing(true);
    try {
      const r = await fetch('/api/v1/community/classify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim().slice(0, 100), body: body.slice(0, 10000) }),
      });
      const d = await r.json().catch(() => null) as (ClassifyResult & { message?: string }) | null;
      if (!r.ok || !d) { setErr(d?.message ?? tr('editor.classifyFail')); return; }
      setGuess(d);
      /* 뚜렷할 때만 미리 골라 둡니다 — 공지는 회원이 쓸 수 없어 고르지 않습니다 */
      if (d.confident && d.board && (WRITABLE as readonly string[]).includes(d.board) && !board) setBoard(d.board);
    } finally { setGuessing(false); }
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    const t = title.trim(); const b = body.trim();
    if (t.length < 2) { setErr(tr('editor.titleShort')); return; }
    if (b.length < 10) { setErr(tr('editor.bodyShort')); return; }
    if (!board) { setErr(tr('editor.boardNeeded')); return; }
    if (!edit && board === 'REVIEW' && !dealId) { setErr(tr('editor.dealNeeded')); return; }

    start(async () => {
      const url = edit ? `/api/v1/me/community/posts/${edit.id}` : '/api/v1/me/community/posts';
      const payload = edit
        ? (edit.board === 'FOOD' ? { title: t, body: b } : { title: t, body: b, board })   /* v10.47 — 맛집 글은 게시판을 바꾸지 않음(D100 트리거) */
        : { title: t, body: b, board, dealId: board === 'REVIEW' ? dealId : undefined,
            classifiedBy: guess?.board === board ? 'AI' : 'USER' };
      const r = await fetch(url, {
        method: edit ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await r.json().catch(() => null) as
        { id?: string; state?: string; ok?: boolean; note?: string; message?: string; code?: string } | null;
      if (r.status === 401) { router.push('/login'); return; }
      if (!r.ok) {
        setErr(d?.code === 'VALIDATION_ERROR'
          ? tr('editor.invalid')
          : d?.message ?? tr('editor.postFail'));
        return;
      }
      if (d?.ok === false) { setErr(d.note ?? tr('editor.saveFail')); return; }
      const id = edit?.id ?? d?.id;
      router.push(id ? `/community/${id}${edit ? '?saved=1' : `?posted=${d?.state ?? ''}`}` : '/community');
      router.refresh();
    });
  }

  function remove() {
    if (!edit) return;
    if (!window.confirm(tr('post.confirmDelete'))) return;
    start(async () => {
      const r = await fetch(`/api/v1/me/community/posts/${edit.id}`, { method: 'DELETE' });
      const d = await r.json().catch(() => null) as { ok?: boolean; note?: string; message?: string } | null;
      if (!r.ok || d?.ok === false) { setErr(d?.note ?? d?.message ?? tr('post.deleteFail')); return; }
      router.push('/community?deleted=1');
      router.refresh();
    });
  }

  return (
    <form className="cmu-editor" onSubmit={submit}>
      <div className="card p2pad p2form">
        <label className="fld"><span>{tr('editor.title')}</span>
          <input className="inp" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100}
            placeholder={tr('editor.titlePh')} />
        </label>
        <label className="fld"><span>{tr('editor.body')}</span>
          <textarea className="inp" rows={8} value={body} onChange={(e) => setBody(e.target.value)} maxLength={10000}
            placeholder={tr('editor.bodyPh')} onBlur={() => { if (title.trim() && body.trim().length >= 10) void classify(); }} />
        </label>
      </div>

      {/* v10.31 — 시안 plzWrite: 「✨ 게시판 · 내용을 보고 고릅니다」 + 글자 칩 3개(소개 후기 · 업종 이야기 · 질문).
           읽기는 내용 칸을 벗어날 때 저절로(POST /community/classify) — 추천 단추는 시안에 없어 뺐습니다. */}
      {/* v10.47 — 우리동네 맛집 글을 고칠 때는 게시판을 고르지 않습니다(맛집 글 그대로) */}
      {edit?.board !== 'FOOD' && (
      <div className="card p2pad" data-board-pick="">
        <div className="p2sechd"><h2><span aria-hidden="true">✨ </span>{tr('editor.board')}</h2>{guessing && <span className="dim">{tr('editor.reading')}</span>}</div>
        <div className="dim" style={{ marginTop: 6, fontSize: 13 }}>{tr('editor.boardHint')}</div>
        {guess && (
          <div className="cmu-guess">
            <p><b>{tr('editor.readAs')}</b> — {guess.board ? <>{tr('editor.boardIs')} <b>{isBoard(guess.board) ? tr(`board.${guess.board}`) : guess.board}</b></> : tr('editor.noBoard')}</p>
            {guess.matched.length > 0 && (
              <p className="cmu-chips">{guess.matched.map((m) => <span key={m} className="badge badge-verified_doc">{m}</span>)}</p>
            )}
            <p className="dim">{guess.note ?? tr('editor.pickYourself')}</p>
          </div>
        )}
        <div className="cmu-opts" role="radiogroup" aria-label={tr('editor.board')}>
          {WRITABLE.map((b) => (
            <button key={b} type="button" role="radio" aria-checked={board === b} aria-pressed={board === b}
              className={'cmu-opt' + (board === b ? ' on' : '')} data-board={b} onClick={() => setBoard(b)}>{tr(`board.${b}`)}</button>
          ))}
        </div>
        {!edit && board === 'REVIEW' && (
          <label className="fld cmu-deal"><span>{tr('editor.deal')}</span>
            <select value={dealId} onChange={(e) => setDealId(e.target.value)}>
              <option value="">{tr('editor.dealPick')}</option>
              {deals.map((d) => <option key={d.id} value={d.id}>{d.title} · {d.statusLabel}</option>)}
            </select>
            {deals.length === 0 && <em>{tr('editor.noDeal')}</em>}
          </label>
        )}
      </div>
      )}

      {!edit && (
        <div className="notice warn">
          {tr.rich('editor.firstNote', { b: (c) => <b>{c}</b>, br: () => <br /> })}
        </div>
      )}
      {!edit && <div className="notice info">{tr.rich('editor.reviewNote', { b: (c) => <b>{c}</b> })}</div>}
      {err && <p className="form-error" role="alert">{err}</p>}
      <div className="p2act">
        <button className="btn-sm p2primary" disabled={pending}>{pending ? tr('editor.saving') : edit ? tr('editor.saveEdit') : tr('editor.submit')}</button>
        <Link className="btn-sm" href={edit ? `/community/${edit.id}` : '/community'}>{tr('editor.cancel')}</Link>
        {edit && <button type="button" className="btn-sm" onClick={remove} disabled={pending}>{tr('post.delete')}</button>}
      </div>
    </form>
  );
}

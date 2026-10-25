'use client';
/**
 * SB-HOM-RVW-010 후기 작성 — v10.31 시안 scReview: 별점(기본 4 · 아쉬움 ~ 매우 좋음) · 「무엇이 좋았습니까」 칩 5개 · 내용 · 안내 2상자 · 후기 등록.
 *   전: 아무것도 바꾸지 않고 눌러도 별점 5 · 빈 내용으로 바로 등록(결함 중) → 칩 1개 이상 또는 내용 10자 이상이어야 등록(서버도 같은 검사 · REVIEW_EMPTY).
 *   시안 「후기는 수정할 수 있지만 삭제되지 않습니다」 — 이미 쓴 후기는 불러와 고칩니다.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

/* v10.101 — 별점 이름은 사전 키(deal.review.rating.*) */
const LABELS = ['r1', 'r2', 'r3', 'r4', 'r5'] as const;
/* 칩 값(서버로 보내고 · 저장된 후기와 견주는 글)은 한국어 그대로, 보이는 이름만 사전 키(deal.review.tags.*) */
const TAGS = [
  ['연락이 빨랐습니다', 'fast'], ['조건을 정확히 알려줬습니다', 'exact'], ['현장을 잘 압니다', 'local'],
  ['무리한 권유가 없었습니다', 'noPush'], ['사후 확인까지 해줬습니다', 'follow'],
] as const;

export function ReviewForm({ dealId, initial }: { dealId: string; initial?: { rating: number; body: string | null; tags?: string[] } | null }) {
  const router = useRouter();
  const tr = useTranslations('deal.review');
  const [pending, start] = useTransition();
  const [rating, setRating] = useState(initial?.rating ?? 4);
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [body, setBody] = useState(initial?.body ?? '');
  const [err, setErr] = useState<string | null>(null);
  const ready = tags.length > 0 || body.trim().length >= 10;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!ready) { setErr(tr('empty')); return; }
    start(async () => {
      const r = await fetch(`/api/v1/deals/${dealId}/reviews`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, body: body.trim(), tags }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => null);
        setErr(d?.message ?? tr('fail'));
        return;
      }
      router.push('/my/deals');
    });
  }

  return (
    /* auth · stars · cta-primary · form-error · name=body — 기존 흐름 시험(qa flow_trade s14)이 쓰는 손잡이(모양은 w1-plain 이 덮음) */
    <form className="auth w1-plain" onSubmit={submit} noValidate>
      <h2 className="w1-s2">{tr('rate')}</h2>
      <div className="w1-rate stars" role="radiogroup" aria-label={tr('stars')}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={n === rating} className={`w1-star${n <= rating ? ' on' : ''}`}
            onClick={() => setRating(n)} aria-label={tr('star', { n: String(n) })}>★</button>
        ))}
        <span className="w1-ls" style={{ marginLeft: 6 }}>{LABELS[rating - 1] ? tr(`rating.${LABELS[rating - 1]!}`) : null}</span>
      </div>
      <h2 className="w1-s2">{tr('good')}</h2>
      <div className="w1-chips">
        {TAGS.map(([t, k]) => {
          const on = tags.includes(t);
          return <button key={t} type="button" className={`w1-chip${on ? ' on' : ''}`} aria-pressed={on}
            onClick={() => setTags((x) => (on ? x.filter((y) => y !== t) : [...x, t]))}>{tr(`tags.${k}`)}</button>;
        })}
      </div>
      {/* v10.32 (추가) — 시안 내용 칸 크기(시안 textarea rows=5 기본 폭 ≈ 200 × 91px). 글자 수(개발에만 있음)는 칸 바로 아래 칸 폭 안에 남김 */}
      <div className="w1-fld w1-rvbody">
        <label htmlFor="rv-b">{tr('body')}</label>
        <div className="w1-rvbox">
          <textarea id="rv-b" name="body" className="w1-in" rows={5} maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)}
            placeholder={tr('bodyPh')} />
          <div className="w1-cnt">{body.length} / 1000</div>
        </div>
      </div>
      <div className="w1-nt warn">{tr.rich('noDelete', { b: (x) => <b>{x}</b> })}</div>
      <div className="w1-nt" style={{ marginTop: 8 }}>{tr.rich('noContact', { b: (x) => <b>{x}</b> })}</div>
      {err && <p className="w1-err form-error" role="alert">{err}</p>}
      <div className="w1-dact"><button className="w1-bp cta-primary" disabled={pending || !ready}>{pending ? tr('pending') : initial ? tr('edit') : tr('submit')}</button></div>
    </form>
  );
}

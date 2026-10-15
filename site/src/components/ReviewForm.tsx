'use client';
/**
 * SB-HOM-RVW-010 후기 작성 — v10.31 시안 scReview: 별점(기본 4 · 아쉬움 ~ 매우 좋음) · 「무엇이 좋았습니까」 칩 5개 · 내용 · 안내 2상자 · 후기 등록.
 *   전: 아무것도 바꾸지 않고 눌러도 별점 5 · 빈 내용으로 바로 등록(결함 중) → 칩 1개 이상 또는 내용 10자 이상이어야 등록(서버도 같은 검사 · REVIEW_EMPTY).
 *   시안 「후기는 수정할 수 있지만 삭제되지 않습니다」 — 이미 쓴 후기는 불러와 고칩니다.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

const LABELS = ['아쉬움', '보통', '괜찮음', '좋음', '매우 좋음'];
const TAGS = ['연락이 빨랐습니다', '조건을 정확히 알려줬습니다', '현장을 잘 압니다', '무리한 권유가 없었습니다', '사후 확인까지 해줬습니다'];

export function ReviewForm({ dealId, initial }: { dealId: string; initial?: { rating: number; body: string | null; tags?: string[] } | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rating, setRating] = useState(initial?.rating ?? 4);
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [body, setBody] = useState(initial?.body ?? '');
  const [err, setErr] = useState<string | null>(null);
  const ready = tags.length > 0 || body.trim().length >= 10;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!ready) { setErr('무엇이 좋았는지 칩을 고르시거나 내용을 10자 이상 적어 주십시오.'); return; }
    start(async () => {
      const r = await fetch(`/api/v1/deals/${dealId}/reviews`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, body: body.trim(), tags }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => null);
        setErr(d?.message ?? '등록하지 못했습니다.');
        return;
      }
      router.push('/my/deals');
    });
  }

  return (
    /* auth · stars · cta-primary · form-error · name=body — 기존 흐름 시험(qa flow_trade s14)이 쓰는 손잡이(모양은 w1-plain 이 덮음) */
    <form className="auth w1-plain" onSubmit={submit} noValidate>
      <h2 className="w1-s2">평가</h2>
      <div className="w1-rate stars" role="radiogroup" aria-label="별점">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={n === rating} className={`w1-star${n <= rating ? ' on' : ''}`}
            onClick={() => setRating(n)} aria-label={`${n}점`}>★</button>
        ))}
        <span className="w1-ls" style={{ marginLeft: 6 }}>{LABELS[rating - 1]}</span>
      </div>
      <h2 className="w1-s2">무엇이 좋았습니까</h2>
      <div className="w1-chips">
        {TAGS.map((t) => {
          const on = tags.includes(t);
          return <button key={t} type="button" className={`w1-chip${on ? ' on' : ''}`} aria-pressed={on}
            onClick={() => setTags((x) => (on ? x.filter((y) => y !== t) : [...x, t]))}>{t}</button>;
        })}
      </div>
      {/* v10.32 (추가) — 시안 내용 칸 크기(시안 textarea rows=5 기본 폭 ≈ 200 × 91px). 글자 수(개발에만 있음)는 칸 바로 아래 칸 폭 안에 남김 */}
      <div className="w1-fld w1-rvbody">
        <label htmlFor="rv-b">내용</label>
        <div className="w1-rvbox">
          <textarea id="rv-b" name="body" className="w1-in" rows={5} maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)}
            placeholder="어떤 점이 도움이 되었는지 적어 주세요." />
          <div className="w1-cnt">{body.length} / 1000</div>
        </div>
      </div>
      <div className="w1-nt warn"><b>후기는 수정할 수 있지만 삭제되지 않습니다.</b> 상대방의 등급 근거가 되기 때문입니다. 사실과 다른 내용은 신고로 처리합니다.</div>
      <div className="w1-nt" style={{ marginTop: 8 }}><b>연락처 · 계좌번호는 쓰지 마십시오.</b> 공개 화면이라 그대로 노출됩니다 — 등록 시 자동으로 걸러집니다.</div>
      {err && <p className="w1-err form-error" role="alert">{err}</p>}
      <div className="w1-dact"><button className="w1-bp cta-primary" disabled={pending || !ready}>{pending ? '등록 중…' : initial ? '후기 고치기' : '후기 등록'}</button></div>
    </form>
  );
}

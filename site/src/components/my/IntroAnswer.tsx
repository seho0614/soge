'use client';
/**
 * v10.29 — 소개자 홈 「내게 맞는 요청」의 응답 단추 4개 (시안 scIntroHome .ans).
 *   제가 알아요 · 확인해 보겠습니다 · 잘 모릅니다 · 관심 없는 분야 → POST /me/introducer/respond { requestId, answer }
 *   answer: KNOW · CHECKING · DONT_KNOW · NOT_MY_FIELD (서버가 받는 값 그대로).
 *   「제가 알아요」는 답을 남긴 뒤 그 요청으로 초대 보내기 화면을 엽니다(시안: 누르면 초대 보내기로 넘어감).
 *   답한 요청은 서버가 목록에서 뺍니다 — 새로 읽어 그대로 보여 줍니다.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function IntroAnswer({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function answer(a: 'KNOW' | 'CHECKING' | 'DONT_KNOW' | 'NOT_MY_FIELD') {
    setBusy(a); setErr(null);
    try {
      const r = await fetch('/api/v1/me/introducer/respond', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, answer: a }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) { setErr(d?.message ?? '답을 남기지 못했습니다.'); return; }
      if (a === 'KNOW') router.push(`/my/intro/invite?request=${encodeURIComponent(requestId)}`);
      else router.refresh();
    } finally { setBusy(null); }
  }

  return (
    <div className="my-ans" data-intro-answer={requestId}>
      <button type="button" className="my-bp" disabled={!!busy} onClick={() => void answer('KNOW')} data-ans="KNOW">{busy === 'KNOW' ? '여는 중…' : '제가 알아요'}</button>
      <button type="button" className="my-bo" disabled={!!busy} onClick={() => void answer('CHECKING')} data-ans="CHECKING">확인해 보겠습니다</button>
      <button type="button" className="my-bo sm" disabled={!!busy} onClick={() => void answer('DONT_KNOW')} data-ans="DONT_KNOW">잘 모릅니다</button>
      <button type="button" className="my-bo sm" disabled={!!busy} onClick={() => void answer('NOT_MY_FIELD')} data-ans="NOT_MY_FIELD">관심 없는 분야</button>
      {err && <span className="my-ls" role="alert" style={{ color: 'var(--sgb-rd-text)' }}>{err}</span>}
    </div>
  );
}

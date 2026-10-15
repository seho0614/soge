'use client';
import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const GATE: Record<string, { href: string; label: string }> = {
  IDENTITY_REQUIRED: { href: '/verify', label: '본인인증 후 문의할 수 있습니다' },
  OWN_LISTING: { href: '', label: '내가 등록한 매물입니다' },
};

/**
 * 매물 상세의 맨 아래 줄 (v10.21 · SB-{G}-DTL-010).
 *
 *   [관심 담기] [질문 N] [공유하기] [신고]            [1:1 문의 시작]
 *
 * 10/7 지시 — 「1:1 문의 · 관심 담기 · 신고하기 버튼 추가」 · 자리 답 「맨 아래 줄에 합치기」.
 *
 * ★ 문의가 주 동선입니다(귀속 안 · INV-2). 그래서 오른쪽 끝에 크게 둡니다.
 *   문의할 수 있는지는 **서버가 판정**한 값(canInquire · inquireBlockReason)을 그대로 씁니다 — 화면이 역할을 다시 계산하지 않습니다.
 * ★ 관심은 로그인해야 담깁니다. 로그인 전이면 로그인 화면으로 보내고, 끝나면 이 매물로 돌아옵니다.
 * ★ 신고는 접수 화면으로 갑니다 — 접수만 하고 바로 내리지 않습니다(자동으로 내리면 경쟁사가 짜고 내릴 수 있습니다).
 */
export function DetailBar({ id, path, loggedIn, liked, canInquire, blockReason, questionCount }: {
  id: string; path: string; loggedIn: boolean; liked: boolean; canInquire: boolean; blockReason?: string; questionCount: number;
}) {
  const router = useRouter();
  const [on, setOn] = useState(liked);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => { setOn(liked); }, [liked]);

  function like() {
    setMsg(null);
    /* 로그인 전이면 요청을 보내지 않고 로그인으로 보냅니다(끝나면 이 매물로 돌아옵니다). */
    if (!loggedIn) { router.push(`/login?next=${encodeURIComponent(path)}`); return; }
    start(async () => {
      /* 메서드를 글자 그대로 둡니다 — 매트릭스(scripts/gen-matrix.js)가 소스를 읽어 「화면 → API」를 잇기 때문입니다. */
      const r = on
        ? await fetch(`/api/v1/me/favorites/${id}`, { method: 'DELETE' })
        : await fetch(`/api/v1/me/favorites/${id}`, { method: 'POST' });
      if (r.status === 401) { router.push(`/login?next=${encodeURIComponent(path)}`); return; }
      if (!r.ok) {
        const d = await r.json().catch(() => null);
        setMsg(d?.message ?? '처리하지 못했습니다. 잠시 후 다시 시도해 주십시오.');
        return;
      }
      setOn(!on);
      router.refresh();          // 위쪽의 관심 수를 서버 값으로 다시 그립니다
    });
  }

  async function share() {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setMsg('주소를 복사했습니다. 붙여 넣어 보내십시오.');
    } catch {
      setMsg(`이 주소를 복사해 보내십시오 — ${url}`);
    }
  }

  const gate = blockReason ? GATE[blockReason] : null;

  return (
    <div className="ldp-barwrap">
      <div className="ldp-bar">
        <button type="button" className={`bar-btn${on ? ' on' : ''}`} aria-pressed={on} disabled={pending} onClick={like}>
          {on ? '♥ 관심 담김' : '♡ 관심 담기'}
        </button>
        <a className="bar-btn" href="#qna">질문 {questionCount}</a>
        <button type="button" className="bar-btn" onClick={share}>공유하기</button>
        <Link className="bar-btn bar-report" href={`/report/listing/${id}`} prefetch={false}>신고</Link>
        {canInquire ? (
          <button type="button" className="bar-go" onClick={() => router.push(`/chat/${id}`)}>
            1:1 문의 시작
          </button>
        ) : (
          <button type="button" className="bar-go bar-blocked" disabled={!gate?.href}
                  onClick={() => gate?.href && router.push(gate.href)}>
            {gate?.label ?? '문의할 수 없습니다'}
          </button>
        )}
      </div>
      {msg && <p className="ldp-bar-msg" role="status">{msg}</p>}
    </div>
  );
}

/**
 * 등록자 줄의 버튼.
 *
 *   [질문하기]  공개 문의 자리로 내려갑니다
 *   [전화하기]  보조 · 낮은 대비 — 통화는 귀속 밖이라 시각적 우위를 주지 않습니다(050 안심번호 B-19 가 붙기 전까지).
 *              알림 창(alert)을 띄우지 않고 그 자리에 안내합니다.
 */
export function ProfileActions() {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="ldp-prof-act">
      <a className="btn btn-q" href="#qna">질문하기</a>
      <button type="button" className="btn-call"
              onClick={() => setMsg('전화 연결은 준비 중입니다. 지금은 1:1 문의로 시작해 주십시오 — 대화가 시작되면 소개가 기록됩니다.')}>
        전화하기
      </button>
      {msg && <p className="ldp-prof-msg" role="status">{msg}</p>}
    </div>
  );
}

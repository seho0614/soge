/**
 * 소개광장 「이건 어때?」 투표 (D021) — 화면이 쓰는 모양과 투표 동작.
 * 메인 카드(components/home/PollCards.tsx)와 투표 목록(components/community/PollList.tsx)이 같이 씁니다.
 *
 * 참여 수 · 비율은 **서버가 준 실제 표 수**로만 계산합니다. 화면이 숫자를 꾸며 넣지 않습니다.
 */
'use client';
import { useCallback, useState } from 'react';

export interface PollOption { id: string; sort: number; label: string; sub: string | null; image: string | null; votes: number }
export interface Poll {
  id: string; kind: 'VS' | 'ASK' | 'USED' | string; title: string; description: string | null; image: string | null;
  state: string; open: boolean; endsAt: string | null; total: number; options: PollOption[]; myOptionId: string | null;
}

/* v10.101 2-5b — 글자는 사전 키(plaza.poll.kind.* · plaza.poll.*) — 투표 목록(PollList)이 그릴 때 옮깁니다 */
export const POLL_KIND: Record<string, { label: 'poll.kind.VS' | 'poll.kind.ASK' | 'poll.kind.USED'; tone: string; cta: 'poll.vote' | 'poll.opinion' }> = {
  VS: { label: 'poll.kind.VS', tone: 'blue', cta: 'poll.vote' },
  ASK: { label: 'poll.kind.ASK', tone: 'lilac', cta: 'poll.vote' },
  USED: { label: 'poll.kind.USED', tone: 'mint', cta: 'poll.opinion' },
};

export const pct = (votes: number, total: number) => (total > 0 ? Math.round((votes * 100) / total) : 0);

/** 투표 알림 글자 — 부르는 쪽이 옮긴 글자를 넘깁니다(v10.101 2-5b · 투표 목록은 plaza.poll.msg.* · v10.102 2-5c 메인 카드는 main.poll.msg.*) */
export type PollTexts = Record<'pick' | 'ok' | 'already' | 'login' | 'fail' | 'offline', string>;

/**
 * 투표 한 건의 상태 — 고르기 · 보내기 · 결과.
 *   voted    내가 이미 투표함(회원: 계정 / 비로그인: 방문자 쿠키)
 *   canVote  지금 투표할 수 있음(열려 있고 아직 안 함)
 *   result   결과(비율)를 보여 줄 때 — 투표했거나 마감됐을 때만. 투표 전에는 보여 주지 않습니다(남의 선택에 끌려가지 않게).
 */
export function usePoll(initial: Poll, texts: PollTexts) {
  const [poll, setPoll] = useState<Poll>(initial);
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: 'ok' | 'err' | 'login' } | null>(null);

  const voted = !!poll.myOptionId;
  const canVote = poll.open && !voted;
  const result = voted || !poll.open;

  const pick = useCallback((id: string) => { setSel(id); setMsg(null); }, []);

  const vote = useCallback(async () => {
    if (busy || !canVote) return;
    if (!sel) { setMsg({ text: texts.pick, kind: 'err' }); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/v1/community/polls/${encodeURIComponent(poll.id)}/vote`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ optionId: sel }),
      });
      const body = await r.json().catch(() => null) as { poll?: Poll; code?: string; message?: string } | null;
      if (r.ok && body?.poll) {
        setPoll(body.poll); setMsg({ text: texts.ok, kind: 'ok' });
      } else if (r.status === 409) {
        /* 다른 창 · 다른 때 이미 투표한 경우 — 지금 상태를 다시 받아 보여 줍니다 */
        const g = await fetch(`/api/v1/community/polls/${encodeURIComponent(poll.id)}`, { cache: 'no-store' });
        if (g.ok) setPoll(await g.json() as Poll);
        setMsg({ text: body?.message ?? texts.already, kind: 'err' });
      } else if (r.status === 401) {
        setMsg({ text: body?.message ?? texts.login, kind: 'login' });
      } else {
        setMsg({ text: body?.message ?? texts.fail, kind: 'err' });
      }
    } catch {
      setMsg({ text: texts.offline, kind: 'err' });
    } finally { setBusy(false); }
  }, [busy, canVote, sel, poll.id, texts]);

  return { poll, sel, pick, vote, busy, msg, voted, canVote, result };
}

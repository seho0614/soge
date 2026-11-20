'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * v10.507 (D274 · docs/645) 소개광장 「도움돼요」 — SB-HOM-CMU-020 글 · 댓글
 *   HelpfulScope  글 하나의 도움돼요 수를 한 번에 읽음(GET /api/v1/community/posts/{id}/helpful) · plaza.ranking 이 꺼져 있으면 단추 없음
 *   HelpfulButton 누르기 · 다시 누르면 취소(POST /api/v1/me/community/helpful) · 내 글 · 댓글에는 그리지 않음 · 로그인 전이면 안내
 */
interface Data { on: boolean; loggedIn?: boolean; post: number; comments: Record<string, number>; mine: string[] }
interface Ctx { d: Data | null; toggle: (type: 'POST' | 'COMMENT', id: string) => Promise<boolean> }
const HelpCtx = createContext<Ctx | null>(null);

export function HelpfulScope({ postId, children }: { postId: string; children: React.ReactNode }) {
  const [d, setD] = useState<Data | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/v1/community/posts/${encodeURIComponent(postId)}/helpful`).then((r) => (r.ok ? r.json() : null)).then((x) => { if (live) setD(x); }).catch(() => undefined);
    return () => { live = false; };
  }, [postId]);
  const toggle = useCallback(async (type: 'POST' | 'COMMENT', id: string) => {
    const r = await fetch('/api/v1/me/community/helpful', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetType: type, targetId: id }) });
    if (!r.ok) return false;
    const b = (await r.json()) as { on: boolean; count: number };
    setD((p) => {
      if (!p) return p;
      const key = `${type}:${id}`;
      const mine = b.on ? [...p.mine.filter((x) => x !== key), key] : p.mine.filter((x) => x !== key);
      return type === 'POST' ? { ...p, post: b.count, mine } : { ...p, comments: { ...p.comments, [id]: b.count }, mine };
    });
    return true;
  }, []);
  return <HelpCtx.Provider value={{ d, toggle }}>{children}</HelpCtx.Provider>;
}

export function HelpfulButton({ type, id, mine }: { type: 'POST' | 'COMMENT'; id: string; mine?: boolean }) {
  const c = useContext(HelpCtx);
  const t = useTranslations('plaza');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!c?.d?.on) return null;
  const count = type === 'POST' ? c.d.post : (c.d.comments[id] ?? 0);
  const pressed = c.d.mine.includes(`${type}:${id}`);
  if (mine) return count > 0 ? <span className="dim" data-helpful={id}> · {t('helpfulBtn', { n: String(count) })}</span> : null;
  return (
    <span data-helpful={id}>
      {' '}<button type="button" className="sgb-btn sgb-btn--sm sgb-btn--sec" aria-pressed={pressed} disabled={busy}
        onClick={async () => {
          if (!c.d?.loggedIn) { setErr(t('helpfulLogin')); return; }
          setBusy(true); setErr(null);
          const ok = await c.toggle(type, id).catch(() => false);
          setBusy(false);
          if (!ok) setErr(t('helpfulFail'));
        }}>{t('helpfulBtn', { n: String(count) })}</button>
      {err && <span className="dim" role="alert"> {err}</span>}
    </span>
  );
}

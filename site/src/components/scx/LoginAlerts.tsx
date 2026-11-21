'use client';
/**
 * SB-MYP-SCX-020 낯선 기기 로그인 (v10.593 · docs/735) — 「나였어요」 · 「내가 아니에요」(그 기기 로그아웃) → 서버 액션 answerLoginAlert
 *   알림 LOGIN_NEW_DEVICE 의 링크(?alert=번호)로 들어오면 그 줄에 표시 · 글자는 서버 화면이 넘김
 */
import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { answerLoginAlert } from '@/lib/scxAuth';

type Item = { id: string; createdAt: string; ipMasked: string | null; uaKind: string | null; answer: string | null; answeredAt: string | null; current: boolean; sessionAlive: boolean };
export interface AlertLabels { title: string; none: string; text: string; me: string; notMe: string; at: string; device: string; ip: string; answer: string; answeredMe: string; answeredNotMe: string; current: string; notMeConfirm: string; toPassword: string }

export function LoginAlerts({ items, labels: L }: { items: Item[]; labels: AlertLabels }) {
  const router = useRouter();
  const sp = useSearchParams();
  const focus = sp?.get('alert') ?? null;
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ note?: string; next?: string | null } | null>(null);
  const fmt = (s: string) => new Date(s).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  useEffect(() => { if (focus) document.getElementById(`scx-alert-${focus}`)?.scrollIntoView({ block: 'center' }); }, [focus]);

  function answer(x: Item, a: 'ME' | 'NOT_ME') {
    setErr(null); setDone(null);
    if (a === 'NOT_ME' && !confirm(L.notMeConfirm)) return;
    start(async () => {
      const r = await answerLoginAlert(x.id, a);
      if (!r.ok) { setErr(r.message); return; }
      setDone({ note: r.note, next: r.next });
      router.refresh();
    });
  }

  return (
    <div id="scx-alerts" data-scx-alerts={String(items.length)}>
      <h2 className="my-st2">{L.title}</h2>
      {err && <div className="my-nt warn" role="alert" data-scx-alert-err="">{err}</div>}
      {done && <div className="my-nt ok" role="status" data-scx-alert-done="">{done.note}{done.next && <> <Link className="my-bo" href={done.next}>{L.toPassword}</Link></>}</div>}
      {items.length === 0 ? <div className="my-nt plain">{L.none}</div> : (
        <div className="my-tw">
          <table className="my-tb2">
            <thead><tr><th>{L.at}</th><th>{L.device}</th><th>{L.ip}</th><th>{L.answer}</th></tr></thead>
            <tbody>{items.map((x) => (
              <tr key={x.id} id={`scx-alert-${x.id}`} data-scx-alert={x.answer ?? 'open'} aria-current={focus === x.id ? 'true' : undefined}>
                <td>{fmt(x.createdAt)}</td>
                <td>{x.uaKind ?? '—'}{x.current && <> <b>{L.current}</b></>}</td>
                <td>{x.ipMasked ?? '—'}</td>
                <td>{x.answer === 'ME' ? L.answeredMe : x.answer === 'NOT_ME' ? <b>{L.answeredNotMe}</b> : (
                  <>
                    <button className="my-bo" type="button" disabled={pending} onClick={() => answer(x, 'ME')} data-scx-me={x.id}>{L.me}</button>{' '}
                    <button className="my-bo" type="button" disabled={pending} onClick={() => answer(x, 'NOT_ME')} data-scx-notme={x.id}>{L.notMe}</button>
                  </>
                )}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <div className="my-nt plain">{L.text}</div>
    </div>
  );
}

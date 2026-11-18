'use client';
/**
 * SB-MYP-SEC-010 내 로그인 기기 (v10.380 · D241 · docs/516) — 기기별 로그아웃 → 서버 액션 revokeSession
 *   지금 이 기기를 끊으면 로그인 화면으로
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

type Sess = { id: string; uaKind: string | null; ipMasked: string | null; createdAt: string; lastSeenAt: string; current: boolean };
type Act = { ok: true; note?: string; current?: boolean } | { ok: false; code: string; message: string };

export function SessionList({ items, action }: { items: Sess[]; action: (id: string) => Promise<Act> }) {
  const t = useTranslations('my.security');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const fmt = (s: string) => new Date(s).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

  function revoke(s: Sess) {
    setErr(null); setDone(null);
    if (!confirm(s.current ? t('sessConfirmSelf') : t('sessConfirm', { device: s.uaKind ?? '—' }))) return;
    start(async () => {
      const r = await action(s.id);
      if (!r.ok) { setErr(r.message); return; }
      if (r.current) { router.push('/login'); return; }
      setDone(r.note ?? t('sessDone'));
      router.refresh();
    });
  }

  return (
    <div data-session-list={String(items.length)}>
      {err && <div className="my-nt warn" role="alert" data-session-err="">{err}</div>}
      {done && <div className="my-nt ok" role="status" data-session-done="">{done}</div>}
      <div className="my-tw">
        <table className="my-tb2">
          <thead><tr><th>{t('thBrowser')}</th><th>{t('thIp')}</th><th>{t('sessFirst')}</th><th>{t('sessLast')}</th><th /></tr></thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id} data-session-row={s.current ? 'current' : 'other'}>
                <td>{s.uaKind ?? '—'}{s.current && <> <b>{t('sessCurrent')}</b></>}</td>
                <td>{s.ipMasked ?? '—'}</td>
                <td>{fmt(s.createdAt)}</td>
                <td>{fmt(s.lastSeenAt)}</td>
                <td><button className="my-bo" type="button" disabled={pending} onClick={() => revoke(s)} data-session-revoke={s.id}>{t('sessLogout')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

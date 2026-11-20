'use client';
/**
 * SB-MYP-UPT-010 간편 로그인 연결 — 업체마다 연결 상태 · 연결하기(링크) · 끊기(서버 액션) · 비밀번호 없는 계정의 첫 비밀번호
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export type SocAct = { ok: boolean; message: string };
type Link_ = { provider: 'KAKAO' | 'NAVER'; emailMasked: string | null; linkedAt: string; lastLoginAt: string | null };
const ALL = ['KAKAO', 'NAVER'] as const;

export function SocialLinks({ links, providers, hasPassword, unlink, createPassword }: {
  links: Link_[]; providers: Array<'KAKAO' | 'NAVER'>; hasPassword: boolean;
  unlink: (provider: string) => Promise<SocAct>; createPassword: (password: string) => Promise<SocAct>;
}) {
  const t = useTranslations('upt');
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pw, setPw] = useState('');
  const fmt = (s: string) => new Date(s).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const shown = ALL.filter((p) => providers.includes(p) || links.some((l) => l.provider === p));

  const act = (fn: () => Promise<SocAct>) => start(async () => {
    const r = await fn();
    setMsg({ ok: r.ok, text: r.message || (r.ok ? t('myLinkedOk') : t('errDefault')) });
    if (r.ok) router.refresh();
  });

  return (
    <div data-social-links={String(links.length)}>
      {msg && <div className={`my-nt ${msg.ok ? 'ok' : 'warn'}`} role={msg.ok ? 'status' : 'alert'} data-social-msg="">{msg.text}</div>}
      {shown.length === 0 && <div className="my-nt info">{t('myOff')}</div>}
      <div className="my-tw"><table className="my-tb2"><tbody>
        {shown.map((p) => {
          const l = links.find((x) => x.provider === p);
          return (
            <tr key={p} data-social-row={p} data-social-state={l ? 'linked' : 'none'}>
              <th scope="row">{p === 'KAKAO' ? t('provKAKAO') : t('provNAVER')}</th>
              <td>{l ? t('myLinked', { email: l.emailMasked ?? '—', at: fmt(l.linkedAt) }) : t('myNotLinked')}</td>
              <td>{l
                ? <button type="button" className="my-bo sm" disabled={busy} onClick={() => { if (confirm(t('myUnlinkConfirm'))) act(() => unlink(p.toLowerCase())); }} data-social-unlink={p}>{t('myUnlink')}</button>
                : providers.includes(p) && <a className="my-bo sm" href={`/login/social/${p.toLowerCase()}?mode=link&next=${encodeURIComponent('/my/account/social')}`} data-social-link={p}>{t('myLink')}</a>}</td>
            </tr>
          );
        })}
      </tbody></table></div>
      {!hasPassword && (
        <form className="my-nt info" data-social-nopw="" onSubmit={(e) => { e.preventDefault(); if (pw) act(() => createPassword(pw)); }}>
          <p>{t('myNoPassword')}</p>
          <label htmlFor="soc-newpw">{t('myPwNew')}</label>{' '}
          <input id="soc-newpw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />{' '}
          <button type="submit" className="my-bo sm" disabled={busy || !pw}>{t('myPwBtn')}</button>
        </form>
      )}
    </div>
  );
}

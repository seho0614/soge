import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { logoutAllDevices, me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { MyHead, Note, Table } from '@/components/my/ui';
import { LogoutAllForm } from './LogoutAllForm';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('my.security'))('title') };
}

interface Hist { items: Array<{ at: string; ok: boolean; ipMasked: string | null; uaKind: string | null }>; keepDays: number; recentFails: number }

/**
 * SB-MYP-SEC-010 로그인 기록 · 모든 기기 로그아웃 (v10.181 · D170 · docs/283)
 *   GET  /me/login-history — 최근 30건(IP 앞 두 마디 · 브라우저 종류만) · 보관 날수 · 지난 7일 틀린 횟수
 *   POST /me/logout-all    — 비밀번호 확인 → 다른 기기의 로그인을 모두 풂(이 기기는 새 증표)
 */
export default async function SecurityPage() {
  if (!(await me())) redirect('/login?next=/my/account/security');
  const t = await getTranslations('my.security');
  const tp = await getTranslations('my.privacy');
  const h = await apiGetPersonal<Hist>('/me/login-history').catch(() => null);
  const fmt = (s: string) => new Date(s).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

  async function doLogoutAll(password: string) {
    'use server';
    return logoutAllDevices(password);
  }

  return (
    <><div data-my-security="">
      <MyHead title={t('title')} sub={t('sub')}
        right={<Link className="my-bo" href="/my/account">{t('backProfile')}</Link>} />
      <div className="my-btns" data-security-links="">
        <Link className="my-bo" href="/my/account/data">{tp('toData')}</Link>
        <Link className="my-bo" href="/my/account/privacy">{tp('title')}</Link>
      </div>
      {!h ? <Note kind="warn" role="alert">{t('loadFail')}</Note> : (
        <>
          {h.recentFails > 0 && <Note kind="warn" data-login-fails={String(h.recentFails)}><b>{t('failsB', { n: String(h.recentFails) })}</b> {t('failsText')}</Note>}
          <h2 className="my-st2">{t('hHistory')}</h2>
          {h.items.length === 0 ? <Note kind="plain">{t('empty')}</Note> : (
            <Table head={[t('thAt'), t('thResult'), t('thIp'), t('thBrowser')]}>
              {h.items.map((x, i) => (
                <tr key={i} data-login-row={x.ok ? 'ok' : 'fail'}>
                  <td>{fmt(x.at)}</td>
                  <td>{x.ok ? t('ok') : <b>{t('fail')}</b>}</td>
                  <td>{x.ipMasked ?? '—'}</td>
                  <td>{x.uaKind ?? '—'}</td>
                </tr>
              ))}
            </Table>
          )}
          <Note kind="plain">{t('keep', { days: String(h.keepDays) })}</Note>
        </>
      )}
      <h2 className="my-st2">{t('hLogoutAll')}</h2>
      <Note kind="info">{t('logoutAllText')}</Note>
      <LogoutAllForm action={doLogoutAll} />
    </div><i hidden data-root-end="" /></>
  );
}

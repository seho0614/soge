import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { logoutAllDevices, me, revokeSession } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { MyHead, Note, Table } from '@/components/my/ui';
import { LogoutAllForm } from './LogoutAllForm';
import { SessionList } from './SessionList';
import { ScxSecurity } from '@/components/scx/ScxSecurity';   // v10.592 · 593 (docs/734 · 735) 낯선 기기 로그인 · 2단계 인증

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('my.security'))('title') };
}

interface Sessions { items: Array<{ id: string; uaKind: string | null; ipMasked: string | null; createdAt: string; lastSeenAt: string; current: boolean }>; currentKnown: boolean }
interface Hist { items: Array<{ at: string; ok: boolean; ipMasked: string | null; uaKind: string | null }>; keepDays: number; recentFails: number }

/**
 * SB-MYP-SEC-010 로그인 기록 · 모든 기기 로그아웃 (v10.181 · D170 · docs/283)
 *   GET  /me/login-history — 최근 30건(IP 앞 두 마디 · 브라우저 종류만) · 보관 날수 · 지난 7일 틀린 횟수
 *   POST /me/logout-all    — 비밀번호 확인 → 다른 기기의 로그인을 모두 풂(이 기기는 새 증표)
 *   GET  /me/sessions · POST /me/sessions/{id}/revoke — v10.380 (D241 · docs/516) 내 로그인 기기 · 기기별 로그아웃
 */
export default async function SecurityPage() {
  if (!(await me())) redirect('/login?next=/my/account/security');
  const t = await getTranslations('my.security');
  const tp = await getTranslations('my.privacy');
  const tu = await getTranslations('upt');   // v10.498 (D272) 간편 로그인 단추
  const h = await apiGetPersonal<Hist>('/me/login-history').catch(() => null);
  const ss = await apiGetPersonal<Sessions>('/me/sessions').catch(() => null);
  const fmt = (s: string) => new Date(s).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

  async function doRevoke(id: string) {
    'use server';
    return revokeSession(id);
  }

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
        <Link className="my-bo" href="/my/account/social" data-to-social="">{tu('toSocial')}</Link>
      </div>
      <ScxSecurity />
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
      <h2 className="my-st2" data-sessions-head="">{t('hSessions')}</h2>
      {!ss ? <Note kind="warn" role="alert">{t('sessLoadFail')}</Note> : (
        <>
          {!ss.currentKnown && <Note kind="plain" data-sessions-old="">{t('sessOld')}</Note>}
          {ss.items.length === 0 ? <Note kind="plain">{t('sessEmpty')}</Note> : <SessionList items={ss.items} action={doRevoke} />}
          <Note kind="plain">{t('sessText')}</Note>
        </>
      )}
      <h2 className="my-st2">{t('hLogoutAll')}</h2>
      <Note kind="info">{t('logoutAllText')}</Note>
      <LogoutAllForm action={doLogoutAll} />
    </div><i hidden data-root-end="" /></>
  );
}

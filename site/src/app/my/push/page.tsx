import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { dtKst } from '@/lib/format';
import { MyHead, Empty, Note } from '@/components/my/ui';
import { PushToggle } from '@/components/mkx/PushToggle';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('mkx.push'))('title') };
}

interface Sub { id: string; ua: string | null; state: string; createdAt: string; lastOkAt: string | null; goneReason: string | null }
interface MyPush { enabled: boolean; pwa: boolean; sending: boolean; mode: string; publicKey: string | null; subs: Sub[]; note: string }

/**
 * SB-MYP-MKX-010 웹 푸시 알림 받기 — v10.538 (D283 · docs/676) · GET /me/push · POST /me/push/subscribe · /unsubscribe · /test
 *   이 브라우저에서 켜고 끔(서비스 워커 sw.js 의 push · notificationclick) · 켠 기기 목록 · 시험 알림
 *   운영이 켜기 전(push.enabled off) · 앱처럼 설치(site.pwa) 꺼짐이면 안내만
 */
export default async function MyPushPage() {
  if (!(await me())) redirect('/login');
  const d = await apiGet<MyPush>('/me/push', 0).catch(() => null);
  const t = await getTranslations('mkx.push');
  const labels = {
    on: t('on'), off: t('off'), test: t('test'), busy: t('busy'), unsupported: t('unsupported'), noWorker: t('noWorker'),
    denied: t('denied'), turnedOn: t('turnedOn'), turnedOff: t('turnedOff'), failed: t('failed'), here: t('here'),
  };
  return (
    <>
      <MyHead title={t('title')} sub={t('sub')} right={<Link className="my-bo sm" href="/my/notifications#prefs">{t('prefs')}</Link>} />
      {!d ? <Empty>{t('loadFail')}</Empty> : (
        <div data-mkx-push-page={d.enabled ? 'on' : 'off'}>
          <Note kind={d.enabled ? 'info' : 'warn'}>{d.note}</Note>
          {d.enabled && !d.pwa && <Note kind="warn">{t('pwaOff')}</Note>}
          {d.enabled && d.publicKey ? <PushToggle publicKey={d.publicKey} labels={labels} /> : null}
          <h2 className="my-s2">{t('hDevices')}</h2>
          {d.subs.length === 0 ? <Empty>{t('noDevices')}</Empty> : (
            <div className="my-tw">
              <table className="my-tb2" data-mkx-push-subs={d.subs.length}>
                <thead><tr><th>{t('thDevice')}</th><th>{t('thState')}</th><th>{t('thSince')}</th><th>{t('thLast')}</th></tr></thead>
                <tbody>{d.subs.map((s) => (
                  <tr key={s.id}><td>{s.ua ?? t('unknownDevice')}</td><td>{s.state === 'ACTIVE' ? t('stateActive') : t('stateGone')}</td>
                    <td>{dtKst(s.createdAt)}</td><td>{s.lastOkAt ? dtKst(s.lastOkAt) : '—'}</td></tr>))}
                </tbody>
              </table>
            </div>
          )}
          <p className="my-ls">{t('privacy')}</p>
        </div>
      )}
    </>
  );
}

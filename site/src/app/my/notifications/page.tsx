import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { dtKst } from '@/lib/format';
import { MyHead, Empty, Note } from '@/components/my/ui';
import { NotificationPrefs, type Pref } from '@/components/my/NotificationPrefs';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('my.ntf'))('title') };
}

interface Noti {
  id: number; eventCode: string; title: string | null;
  body: string; linkUrl: string | null; readAt: string | null; createdAt: string;
  /** v10.31 — 서버가 알림 종류 정책에서 주는 색(warn · ok · info) */
  tone?: 'warn' | 'ok' | 'info';
}

/* 서버 tone 이 없을 때(예전 응답)만 종류 코드로 고릅니다 */
const toneOf = (n: Noti) => n.tone ?? (/FAIL|REJECT|BLOCK|EXPIR|OVERDUE|PAST_DUE|DISPUT|HELD|WARN/.test(n.eventCode) ? 'warn'
  : /CONSENT|PAID|APPROV|CONFIRM|DONE|SUCCE|RENEW|GRANT|VERIFIED/.test(n.eventCode) ? 'ok' : 'info');

/* 시안처럼 바로가기 단추에 갈 곳의 이름을 붙입니다(결제 수단 확인 · 구독 보기 · 소개 내역 …) */
/* v10.99 — 단추 이름은 사전 키(my.ntf.link.*) */
type LinkKey = 'payment' | 'subscription' | 'deals' | 'settlement' | 'contracts' | 'listings' | 'chat' | 'intro' | 'partner' | 'orders' | 'go';
const LINK_LABEL: [RegExp, LinkKey][] = [
  [/^\/my\/payment/, 'payment'], [/^\/my\/subscription/, 'subscription'], [/^\/my\/deals/, 'deals'],
  [/^\/my\/settlement/, 'settlement'], [/^\/my\/contracts/, 'contracts'], [/^\/my\/listings/, 'listings'],
  [/^\/my\/inquiries|^\/chat/, 'chat'], [/^\/my\/intro/, 'intro'], [/^\/partner/, 'partner'], [/^\/my\/health/, 'orders'],
];
const linkLabel = (u: string): LinkKey => LINK_LABEL.find(([re]) => re.test(u))?.[1] ?? 'go';

/**
 * SB-MYP-NTF-010
 * v10.29 — 시안(scMyNtf) 배치: 오른쪽 위 「읽지 않음 N」 · 알림 카드(왼쪽 색 띠 · 제목 · 시각 · 본문 · 바로가기 단추).
 *   v10.31 — 시안의 「수신 설정」 표(종류 · 인앱 · 이메일 · 수신거부)와 「이메일 발송 준비 중」 안내 상자를 그립니다(GET · PATCH /me/notification-prefs).
 *   카드 색은 서버 tone(알림 종류 정책) · 바로가기 단추는 갈 곳 이름(시안 「결제 수단 확인 · 구독 보기」).
 */
export default async function NotificationsPage() {
  if (!(await me())) redirect('/login');
  const [rows, prefs] = await Promise.all([
    apiGet<Noti[]>('/me/notifications', 0).catch(() => [] as Noti[]),
    apiGet<{ emailReady: boolean; items: Pref[] }>('/me/notification-prefs', 0).catch(() => null),
  ]);
  const unread = rows.filter((n) => !n.readAt).length;
  const t = await getTranslations('my.ntf');

  return (
    <>
      <MyHead title={t('title')} sub={t('sub')}
        right={<span className="my-ls" data-ntf-unread={unread}>{t('unread', { n: String(unread) })}</span>} />
      {rows.length === 0 ? (
        <Empty>{t('empty')}</Empty>
      ) : (
        <div className="my-ntfl">
          {rows.map((n) => (
            <div key={n.id} className={`my-ntf ${toneOf(n)}${n.readAt ? '' : ' un'}`} data-ntf={n.id}>
              <div className="my-nh"><b>{n.title ?? n.eventCode}</b><span className="my-ls">{dtKst(n.createdAt)}</span></div>
              <p>{n.body}</p>
              {n.linkUrl && <Link className="my-bo sm" href={n.linkUrl}>{t(`link.${linkLabel(n.linkUrl)}`)}</Link>}
            </div>
          ))}
        </div>
      )}

      <h2 className="my-s2" id="prefs">{t('hPrefs')}</h2>
      {prefs ? <NotificationPrefs items={prefs.items} emailReady={prefs.emailReady} /> : <Empty>{t('prefsFail')}</Empty>}
      {!prefs?.emailReady && (
        <Note kind="warn"><b>{t('emailB')}</b> {t('emailText')}</Note>
      )}
    </>
  );
}

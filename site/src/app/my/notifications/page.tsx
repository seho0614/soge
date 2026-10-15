import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { dtKst } from '@/lib/format';
import { MyHead, Empty, Note } from '@/components/my/ui';
import { NotificationPrefs, type Pref } from '@/components/my/NotificationPrefs';

export const metadata: Metadata = { title: '알림' };

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
const LINK_LABEL: [RegExp, string][] = [
  [/^\/my\/payment/, '결제 수단 확인'], [/^\/my\/subscription/, '구독 보기'], [/^\/my\/deals/, '소개 내역'],
  [/^\/my\/settlement/, '정산 보기'], [/^\/my\/contracts/, '계약 보기'], [/^\/my\/listings/, '내 등록 리스팅'],
  [/^\/my\/inquiries|^\/chat/, '대화 보기'], [/^\/my\/intro/, '소개 활동'], [/^\/partner/, '파트너센터'], [/^\/my\/health/, '주문 보기'],
];
const linkLabel = (u: string) => LINK_LABEL.find(([re]) => re.test(u))?.[1] ?? '바로가기';

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

  return (
    <>
      <MyHead title="알림" sub="결제와 소개 진행에 관한 알림입니다. 돈이 걸린 안내는 수신거부할 수 없습니다 — 못 받으면 이용자가 손해를 봅니다."
        right={<span className="my-ls" data-ntf-unread={unread}>읽지 않음 {unread}</span>} />
      {rows.length === 0 ? (
        <Empty>알림이 없습니다. 거래 · 정산 · 검수 소식이 생기면 여기에 쌓입니다.</Empty>
      ) : (
        <div className="my-ntfl">
          {rows.map((n) => (
            <div key={n.id} className={`my-ntf ${toneOf(n)}${n.readAt ? '' : ' un'}`} data-ntf={n.id}>
              <div className="my-nh"><b>{n.title ?? n.eventCode}</b><span className="my-ls">{dtKst(n.createdAt)}</span></div>
              <p>{n.body}</p>
              {n.linkUrl && <Link className="my-bo sm" href={n.linkUrl}>{linkLabel(n.linkUrl)}</Link>}
            </div>
          ))}
        </div>
      )}

      <h2 className="my-s2" id="prefs">수신 설정</h2>
      {prefs ? <NotificationPrefs items={prefs.items} emailReady={prefs.emailReady} /> : <Empty>수신 설정을 불러오지 못했습니다.</Empty>}
      {!prefs?.emailReady && (
        <Note kind="warn"><b>이메일 발송은 아직 준비 중입니다.</b> 도메인 인증(SPF·DKIM)이 끝나기 전에 보내면 스팸함으로 갑니다. 발송은 성공으로 기록되고 이용자만 못 받습니다 — 그래서 지금은 인앱 알림만 나갑니다.</Note>
      )}
    </>
  );
}

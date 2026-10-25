import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { P2Body, P2Hero, P2Menu } from '@/components/partner/P2Frame';
import type { AffDashboard } from '@/components/partners/types';
import { getTranslations } from 'next-intl/server';
import { Msgs } from '@/i18n/Msgs';

interface LeadDash { applied: boolean; company?: string }

/**
 * 파트너센터(제휴수수료 트랙) 공통 틀 — SB-AFC-*
 * v10.29 — 시안 p2Shell · scP2Dsh 모양: 왼쪽 남색 메뉴(240px · 아이콘 · 아래 글귀 카드 + 사진) ·
 *          위 줄(글귀 · 알림 · 「○○ 파트너님」) · 인사 띠(대시보드는 시안 사진) · 흰 본문 상자.
 *   v10.31 (W5) — 이름은 시안처럼 「김OO 파트너님」(계정 이름 성 + OO · GET /partner/affiliate/dashboard displayName — 없으면 상호),
 *   알림 종의 숫자는 읽지 않은 알림 수(unread)입니다. 종을 누르면 알림 목록(나의공간 알림)으로 갑니다.
 *   일반 머리줄 · 꼬리줄은 그대로 둡니다(시안에는 없음 — 없애면 사이트로 돌아갈 길이 줄어 diffs 에 적고 확인을 받습니다).
 *
 * ★ `/partner`(단수)는 리드 서비스 파트너센터입니다. 여기는 `/partners`(복수) —
 *   제휴상품 링크를 뿌리고 **건당 정액 수수료를 회사가 지급**하는 곳입니다.
 * v10.100 (다국어 2-5a) — 글자는 사전 affiliate.layout. 틀이 그리는 브라우저 부품(P2Menu · P2Hero …)까지 <Msgs> 안에 둡니다.
 * ★ 파트너로 승인되지 않은 계정도 들어올 수 있게 둡니다. 막으면 "어떻게 되나"를 모릅니다.
 *   대신 모든 화면 위에 신청 안내를 띄웁니다.
 */
export default async function PartnersLayout({ children }: { children: React.ReactNode }) {
  const p = await me();
  if (!p) redirect('/login');
  const t = await getTranslations('affiliate.layout');
  const br = () => <br />;

  const [d, lead] = await Promise.all([
    apiGetPersonal<AffDashboard>('/partner/affiliate/dashboard').catch(() => null),
    apiGetPersonal<LeadDash>('/partner/dashboard').catch(() => null),
  ]);
  const notPartner = d ? !d.ok : false;
  const name = d?.displayName ? t('partnerName', { name: d.displayName }) : lead?.company ? t('partnerName', { name: lead.company }) : t('partnerAnon');
  const unread = d?.unread ?? 0;

  return (
    <Msgs ns={['affiliate', 'partner']}>
    <div className="p2wrap" data-p2-shell="">
      <aside className="p2side">
        <div className="p2brand">
          <div className="bt">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2FD1A3" strokeWidth="2" aria-hidden>
              <path d="M12 3 L21 9 L21 21 L3 21 L3 9 Z" /><path d="M9 21v-6h6v6" />
            </svg>
            <strong>{t.rich('brand', { br })}</strong>
          </div>
          <div className="bs">{t.rich('brandSub', { br })}</div>
        </div>
        <P2Menu />
        {/* ★ 파트너 화면에서 소개뱅크로 돌아갈 길 — 시안과 같은 자리(메뉴 끝) */}
        <div className="p2backw">
          <Link href="/" className="p2back">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></svg>
            {t('back')}
          </Link>
        </div>
        <div className="p2foot">
          <div className="p2card"><span style={{ fontSize: 20 }} aria-hidden>🏆</span><div className="tx">{t.rich('card', { br })}</div></div>
          <div className="p2img">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/proto-img/partner/p2-side.png" alt="" />
            <div className="p2imgtx">{t.rich('imgText', { br })}</div>
          </div>
        </div>
      </aside>
      <div className="p2main">
        <div className="p2top">
          <div className="lead">{t('topLead')}</div>
          <div className="p2topr">
            <Link className="p2bell" href={unread ? '/my/notifications' : '/partners/notices'} aria-label={unread ? t('unreadAria', { n: String(unread) }) : t('noticesAria')}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#1B2B4B" strokeWidth="2" aria-hidden><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a2 2 0 0 0 3.4 0" /></svg>
              {unread > 0 ? <i>{unread > 9 ? '9+' : unread}</i> : null}
            </Link>
            <span className="p2user"><span className="av" aria-hidden />{name}</span>
          </div>
        </div>
        <P2Hero name={name} />
        {!d && (
          <p className="form-error" role="alert">{t('loadFail')}</p>
        )}
        {notPartner && (
          <div className="notice notice-act p2notice">
            <div>
              <strong>{d?.note ?? t('notPartner')}</strong>
              <p>{t('notPartnerDesc')}</p>
            </div>
            <Link className="cta-primary as-link" href="/partners#apply">{t('howToApply')}</Link>
          </div>
        )}
        <P2Body>{children}</P2Body>
      </div>
    </div>
    </Msgs>
  );
}

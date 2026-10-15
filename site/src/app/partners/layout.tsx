import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { P2Body, P2Hero, P2Menu } from '@/components/partner/P2Frame';
import type { AffDashboard } from '@/components/partners/types';

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
 * ★ 파트너로 승인되지 않은 계정도 들어올 수 있게 둡니다. 막으면 "어떻게 되나"를 모릅니다.
 *   대신 모든 화면 위에 신청 안내를 띄웁니다.
 */
export default async function PartnersLayout({ children }: { children: React.ReactNode }) {
  const p = await me();
  if (!p) redirect('/login');

  const [d, lead] = await Promise.all([
    apiGetPersonal<AffDashboard>('/partner/affiliate/dashboard').catch(() => null),
    apiGetPersonal<LeadDash>('/partner/dashboard').catch(() => null),
  ]);
  const notPartner = d ? !d.ok : false;
  const name = d?.displayName ? `${d.displayName} 파트너님` : lead?.company ? `${lead.company} 파트너님` : '파트너님';
  const unread = d?.unread ?? 0;

  return (
    <div className="p2wrap" data-p2-shell="">
      <aside className="p2side">
        <div className="p2brand">
          <div className="bt">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2FD1A3" strokeWidth="2" aria-hidden>
              <path d="M12 3 L21 9 L21 21 L3 21 L3 9 Z" /><path d="M9 21v-6h6v6" />
            </svg>
            <strong>소개뱅크<br />PARTNERS</strong>
          </div>
          <div className="bs">좋은 제품을 소개하는<br />당신이 더 특별한 세상을 만듭니다.</div>
        </div>
        <P2Menu />
        {/* ★ 파트너 화면에서 소개뱅크로 돌아갈 길 — 시안과 같은 자리(메뉴 끝) */}
        <div className="p2backw">
          <Link href="/" className="p2back">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></svg>
            소개뱅크로 가기
          </Link>
        </div>
        <div className="p2foot">
          <div className="p2card"><span style={{ fontSize: 20 }} aria-hidden>🏆</span><div className="tx">좋은 사람의<br />소개가 더 나은 일상을<br />만듭니다.</div></div>
          <div className="p2img">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/proto-img/partner/p2-side.png" alt="" />
            <div className="p2imgtx">함께 성장하는<br />소개뱅크 PARTNERS</div>
          </div>
        </div>
      </aside>
      <div className="p2main">
        <div className="p2top">
          <div className="lead">사람을 잇는 좋은 소개, 더 큰 가치를 만듭니다.</div>
          <div className="p2topr">
            <Link className="p2bell" href={unread ? '/my/notifications' : '/partners/notices'} aria-label={unread ? `읽지 않은 알림 ${unread}건` : '공지사항'}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#1B2B4B" strokeWidth="2" aria-hidden><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a2 2 0 0 0 3.4 0" /></svg>
              {unread > 0 ? <i>{unread > 9 ? '9+' : unread}</i> : null}
            </Link>
            <span className="p2user"><span className="av" aria-hidden />{name}</span>
          </div>
        </div>
        <P2Hero name={name} />
        {!d && (
          <p className="form-error" role="alert">파트너 정보를 불러오지 못했습니다. 잠시 후 새로고침해 주십시오.</p>
        )}
        {notPartner && (
          <div className="notice notice-act p2notice">
            <div>
              <strong>{d?.note ?? '파트너로 승인된 계정이 아닙니다.'}</strong>
              <p>신청하고 운영 승인을 받으시면 링크를 만들고 수수료를 받으실 수 있습니다.</p>
            </div>
            <Link className="cta-primary as-link" href="/partners#apply">신청 방법 보기</Link>
          </div>
        )}
        <P2Body>{children}</P2Body>
      </div>
    </div>
  );
}

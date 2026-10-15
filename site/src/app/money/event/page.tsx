import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { EventJoin } from '@/components/EventJoin';
import { BackBar } from '@/components/common/BackBar';
import { GwFrame, QuickMenu, RoleTabs } from '@/components/gwan/GwParts';

export const metadata: Metadata = { title: '이벤트존' };

interface E {
  id: string; code: string; title: string; summary?: string;
  benefit: string; joinType: string; maxJoins?: number;
  startsAt: string; endsAt: string; joins: number;
  remain?: number; daysLeft?: number; landingUrl?: string;
}

/**
 * SB-MNY-EVT-010 이벤트존 — 시안 scEvent 배치(돌아가기 · 소개하기 탭 · 퀵메뉴 · 제목 · 이벤트 카드).
 *
 * ── 진행 중인 것만 보여 줍니다 ──────────────────────────────────────
 * 끝난 이벤트가 걸려 있으면 서비스가 관리되지 않는 것으로 보입니다. 기간 판정은 서버가 합니다(GET /events).
 * ── 참여했다고 바로 받는 것은 아닙니다 ── 그 사실을 먼저 알립니다.
 *
 * v10.29 — 시안의 견본 이벤트 2건 · 「계획된 것」 표(내부 기획 J-09 · J-03) · NAV-8 안내는 넣지 않았습니다(diffs 장터-7).
 */
export default async function EventPage() {
  const list = await apiGet<E[]>('/events', 60).catch(() => []);

  return (
    <><GwFrame>
      <div className="gw-wrap">
        <BackBar href="/money" label="소개장터" />
        <RoleTabs note="알고 있는 공급처 · 업체 · 매물 · 창업 자리를 소개하고 수익을 만들어보세요!" />
        <QuickMenu active="event" />
        <div className="gw-pgh"><div><h1>이벤트존</h1><p>진행 중인 프로모션입니다. <b>기간이 끝나면 자동으로 내려갑니다.</b></p></div></div>

        {list.length === 0 ? (
          <div className="gw-evs"><div className="gw-ev gw-evnone" data-event-empty="">
            <div className="gw-eh"><span className="gw-bg">진행 중인 이벤트 없음</span></div>
            <b>지금 진행 중인 이벤트가 없습니다.</b>
            <p>새 이벤트가 열리면 알림으로 알려 드립니다.</p>
          </div></div>
        ) : (
          <div className="gw-evs">
            {list.map((e) => (
              <div key={e.id} className="gw-ev" data-event={e.code}>
                <div className="gw-eh">
                  <span className="gw-bg gw-ok">진행중</span>
                  {typeof e.daysLeft === 'number' && <span className="gw-ck">{e.daysLeft <= 0 ? '오늘까지' : `${e.daysLeft}일 남음`}</span>}
                  {e.maxJoins ? <span className="gw-ck">{e.joins} / {e.maxJoins}명{typeof e.remain === 'number' && e.remain <= 10 && e.remain > 0 ? ` · ${e.remain}자리` : ''}</span> : null}
                </div>
                <b>{e.title}</b>
                <span className="gw-ls">{e.startsAt?.slice(0, 10)} ~ {e.endsAt?.slice(0, 10)}</span>
                {e.summary ? <p>{e.summary}</p> : null}
                <p><span className="gw-evk">드리는 것</span> <strong>{e.benefit}</strong></p>
                {e.joinType !== 'NONE' && <EventJoin code={e.code} full={e.remain === 0} benefit={e.benefit} />}
              </div>
            ))}
          </div>
        )}

        <div className="gw-nt gw-info">
          <b>참여하셨다고 바로 받으시는 것은 아닙니다.</b> 운영이 확인한 뒤 드리며, 드린 뒤에는 알림이 갑니다. <Link href="/my/events">내 참여 내역 →</Link>
        </div>
      </div>
    </GwFrame><i hidden data-root-end="" /></>
  );
}

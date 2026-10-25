import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { EventJoin } from '@/components/EventJoin';
import { Msgs } from '@/i18n/Msgs';
import { BackBar } from '@/components/common/BackBar';
import { GwFrame, QuickMenu, RoleTabs } from '@/components/gwan/GwParts';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('gwan'))('qm.event') };
}

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
  const t = await getTranslations('plaza.event');
  const g0 = await getTranslations('gwan');

  return (
    <><GwFrame>
      <div className="gw-wrap">
        <BackBar href="/money" label={g0('meta.MNY.name')} />
        <RoleTabs note={t('roleNote')} />
        <QuickMenu active="event" />
        <div className="gw-pgh"><div><h1>{g0('qm.event')}</h1><p>{t.rich('lead', { b: (c) => <b>{c}</b> })}</p></div></div>

        {list.length === 0 ? (
          <div className="gw-evs"><div className="gw-ev gw-evnone" data-event-empty="">
            <div className="gw-eh"><span className="gw-bg">{t('noneTag')}</span></div>
            <b>{t('noneH')}</b>
            <p>{t('noneP')}</p>
          </div></div>
        ) : (
          <div className="gw-evs">
            {list.map((e) => (
              <div key={e.id} className="gw-ev" data-event={e.code}>
                <div className="gw-eh">
                  <span className="gw-bg gw-ok">{t('live')}</span>
                  {typeof e.daysLeft === 'number' && <span className="gw-ck">{e.daysLeft <= 0 ? t('today') : t('daysLeft', { n: String(e.daysLeft) })}</span>}
                  {e.maxJoins ? <span className="gw-ck">{e.joins} / {t('people', { n: String(e.maxJoins) })}{typeof e.remain === 'number' && e.remain <= 10 && e.remain > 0 ? ` · ${t('seats', { n: String(e.remain) })}` : ''}</span> : null}
                </div>
                <b>{e.title}</b>
                <span className="gw-ls">{e.startsAt?.slice(0, 10)} ~ {e.endsAt?.slice(0, 10)}</span>
                {e.summary ? <p>{e.summary}</p> : null}
                <p><span className="gw-evk">{t('benefit')}</span> <strong>{e.benefit}</strong></p>
                {e.joinType !== 'NONE' && <Msgs ns={['join']}><EventJoin code={e.code} full={e.remain === 0} benefit={e.benefit} /></Msgs>}
              </div>
            ))}
          </div>
        )}

        <div className="gw-nt gw-info">
          {t.rich('notice', { b: (c) => <b>{c}</b> })} <Link href="/my/events">{t('myJoins')}</Link>
        </div>
      </div>
    </GwFrame><i hidden data-root-end="" /></>
  );
}

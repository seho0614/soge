import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGetPublic } from '@/lib/api';
import { me } from '@/lib/session';
import { dtKst } from '@/lib/format';
import { Empty, Note } from '@/components/my/ui';
import { GroupbuyJoin } from '@/components/mkx/GroupbuyJoin';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('mkx.gb'))('title') };
}

interface Gb { id: string; title: string; state: string; listPrice: number; dealPrice: number; targetCount: number; maxCount: number | null; perMemberMax: number; endsAt: string;
  code: string; name: string; optionLabel: string; paid: number; taken: number }
interface GbList { on: boolean; items: Gb[]; note: string }
const won = (v: number) => Number(v ?? 0).toLocaleString('ko-KR');

/**
 * SB-HLT-MKX-010 소개몰 공동구매 — v10.540 (D283 · docs/678) · GET /health/groupbuys · POST /health/groupbuys/{id}/join
 *   모집 중 · 확정(기한 안) 공동구매 — 정가 · 할인가 · 결제 참여 / 목표 · 기한 · 참여(로그인 · 기본 배송지 · 결제는 내 주문에서)
 *   mkx.groupbuy off(처음)면 「지금은 없음」만 · 주문 받기가 꺼져 있으면 참여 단추가 서버 안내를 보임
 */
export default async function GroupbuysPage() {
  const [d, who] = await Promise.all([apiGetPublic<GbList>('/health/groupbuys', 30).catch(() => null), me()]);
  const t = await getTranslations('mkx.gb');
  const labels = { join: t('join'), busy: t('busy'), login: t('login'), pay: t('pay'), failed: t('failed') };
  return (
    <div className="hlt" data-mkx-gb-page={d?.on ? 'on' : 'off'}>
      <div className="page-head"><h1>{t('title')}</h1></div>
      <p className="my-ls">{t('sub')}</p>
      {!d || !d.on || d.items.length === 0 ? <Empty>{t('empty')}</Empty> : (
        <div className="my-ntfl">
          {d.items.map((g) => (
            <div key={g.id} className="my-ntf info" data-mkx-gb={g.id}>
              <div className="my-nh"><b>{g.title}</b><span className="my-ls">{t('until', { at: dtKst(g.endsAt) })}</span></div>
              <p>
                <Link href={`/health/p/${g.code}`}>{g.name}</Link> · {g.optionLabel}{' '}
                <s>{t('won', { v: won(g.listPrice) })}</s> → <b>{t('won', { v: won(g.dealPrice) })}</b>
              </p>
              <p className="my-ls">{g.state === 'SUCCESS' ? t('confirmed', { paid: String(g.paid) }) : t('progress', { paid: String(g.paid), target: String(g.targetCount) })}
                {' '}· {t('perMember', { n: String(g.perMemberMax) })}</p>
              <GroupbuyJoin id={g.id} loggedIn={!!who} labels={labels} />
            </div>
          ))}
        </div>
      )}
      {d?.on ? <Note kind="info">{d.note}</Note> : null}
    </div>
  );
}

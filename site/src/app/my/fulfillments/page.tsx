import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { ymdKst } from '@/lib/format';
import { MyHead, Note, Empty } from '@/components/my/ui';
import { FulfillConfirm } from '@/components/my/FulfillConfirm';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('my.fulfills'))('title') };
}

interface Report { id: string; content: string | null; doneOn: string | null; state: string; rating: number | null; confirmedAt: string | null; reportedAt: string; company: string | null; summary: string | null }
/* v10.99 — 상태 이름은 사전 키(my.fulfills.st.*) */
const ST: Record<string, ['waiting' | 'confirmed' | 'disputed', string]> = { WAITING: ['waiting', 'wait'], CONFIRMED: ['confirmed', 'ok'], DISPUTED: ['disputed', 'no'] };

/**
 * v10.31 (W5 요청 · SHARED_NOTES 「소비자 쪽 — /my/fulfillments 화면 없음 → w3」) — 상담 신청에 업체가 보낸 이행 보고를 확인합니다.
 * GET /me/fulfillment-reports(W5 서버) — 확인하면 성사로 잡히고, 이의는 사유를 남깁니다. 이 화면은 알림 링크(/my/fulfillments)의 도착지입니다.
 */
export default async function FulfillmentsPage() {
  if (!(await me())) redirect('/login?next=/my/fulfillments');
  const rows = await apiGetPersonal<Report[]>('/me/fulfillment-reports').catch(() => [] as Report[]);
  const t = await getTranslations('my.fulfills');
  return (
    <><div data-my-fulfill="">
      <MyHead title={t('title')} sub={t('sub')} />
      {rows.length === 0 ? <Empty>{t('empty')}</Empty> : (
        <div className="my-reqs">
          {rows.map((r) => {
            const s = ST[r.state];
            const st = s ? [t(`st.${s[0]}`), s[1]] : [r.state, 'off'];
            return (
              <div key={r.id} className={`my-req${r.state === 'WAITING' ? '' : ' done'}`} data-fulfill-row={r.id}>
                <div className="my-rh"><b>{r.company ?? t('company')}{r.summary ? ` · ${r.summary}` : ''}</b><span className={`my-bg ${st[1]}`}>{st[0]}</span></div>
                <p className="my-ls">{t('reported', { date: ymdKst(r.reportedAt) })}{r.doneOn ? t('doneOn', { date: ymdKst(r.doneOn) }) : ''}{r.confirmedAt ? t('confirmedAt', { date: ymdKst(r.confirmedAt) }) : ''}{r.rating ? t('rating', { n: String(r.rating) }) : ''}</p>
                {r.content && <p>{r.content}</p>}
                {r.state === 'WAITING' && <FulfillConfirm id={r.id} />}
              </div>
            );
          })}
        </div>
      )}
      <Note kind="info"><b>{t('noteB')}</b> {t('noteText')}</Note>
    </div><i hidden data-root-end="" /></>
  );
}

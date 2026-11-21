import { getTranslations } from 'next-intl/server';
import { apiGetPersonal } from '@/lib/api';

interface Tr { on: boolean; mode: string; polled: { polledAt: string; lastStatus: string } | null; events: Array<{ status: string; place: string | null; detail: string | null; at: string; source: string }> }
const when = (iso: string) => new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

/**
 * v10.607 (docs/749) 배송 조회 화면의 「택배사 배송 단계」 — GET /lsq/me/orders/{no}/tracking(내 주문)
 *   택배사 조회가 꺼져 있고 쌓인 단계도 없으면 아무것도 그리지 않음 · 간주(ASSUME) 단계면 그 표시
 */
export async function LsqTrackBox({ no }: { no: string }) {
  const d = await apiGetPersonal<Tr>(`/lsq/me/orders/${encodeURIComponent(no)}/tracking`).catch(() => null);
  if (!d || (!d.on && d.events.length === 0)) return null;
  const t = await getTranslations('lsq.track');
  const ST: Record<string, string> = { PICKED: t('stPICKED'), IN_TRANSIT: t('stIN_TRANSIT'), OUT_FOR_DELIVERY: t('stOUT_FOR_DELIVERY'), DELIVERED: t('stDELIVERED'), FAILED: t('stFAILED'), UNKNOWN: t('stUNKNOWN') };
  const assumed = d.events.some((e) => e.source === 'ASSUME');
  return (
    <section className="hlt-box" data-lsq-track={d.events.length}>
      <h3>{t('title')}</h3>
      {assumed && <p className="hint">{t('assume')}</p>}
      {d.events.length === 0 ? <p className="hint">{t('none')}</p> : (
        <ul className="hlt-tl">
          {d.events.map((e, i) => (
            <li key={i} className={i === 0 ? 'on' : undefined}>
              <b>{ST[e.status] ?? e.status}</b> <span className="hint">{when(e.at)}</span>
              {e.place && <p className="hint">{e.place}</p>}
            </li>
          ))}
        </ul>
      )}
      {d.polled?.polledAt && <p className="hint">{t('polled', { at: when(d.polled.polledAt) })}</p>}
    </section>
  );
}

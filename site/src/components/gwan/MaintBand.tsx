import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { apiGet } from '@/lib/api';

/* ---------------------------------------------------------------------
 * v10.707 (D323 · docs/815) 닫힌 관 손님 안내 — 운영이 예약한 관 점검 시간(GET /gwans/{code}/maintenance · 30초 캐시)
 *   점검 중(관이 닫혀 있음): 「잠시 점검 중입니다 · ○시 ○분에 다시 엽니다 · 운영이 적은 글」 + 처음 화면으로
 *   48시간 안 다음 점검: 작은 띠 「점검 예정 — ○ ~ ○」(관이 열려 있을 때)
 *   점검 시간이 없거나 읽지 못하면 아무것도 그리지 않음(전과 같음)
 * ------------------------------------------------------------------- */
interface Item { startsAt: string; endsAt: string; note: string | null }
export interface MaintStatus { running: Item | null; next: Item | null }

const kst = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 9 * 3_600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};
export async function maintOf(code: string): Promise<MaintStatus | null> {
  return apiGet<MaintStatus>(`/gwans/${code}/maintenance`, 30).catch(() => null);
}
/** 점검 중이면 관 화면 대신 그리는 안내(없으면 null) */
export async function MaintNotice({ code, m }: { code: string; m?: MaintStatus | null }) {
  const s = m === undefined ? await maintOf(code) : m;
  if (!s?.running) return null;
  const t = await getTranslations('gwan.maint');
  /* v10.728 (D325 · docs/836) 운영이 정한 점검 화면 제목 · 글(정책 › 전체 설정 site.maint_title · site.maint_body · 비우면 사전 글) */
  const st = await apiGet<Record<string, string | null>>('/site-settings/public', 60).catch(() => ({} as Record<string, string | null>));
  return (
    <div className="gw-wrap" style={{ paddingTop: 32, paddingBottom: 48 }} data-gwan-maint="running" data-gwan-maint-code={code}>
      <div className="page-head" role="status">
        <h1>{st['site.maint_title'] || t('title')}</h1>
        <p>{t('until', { time: kst(s.running.endsAt) })}</p>
        {st['site.maint_body'] && <p style={{ whiteSpace: 'pre-line' }} data-gwan-maint-body="">{st['site.maint_body']}</p>}
        {s.running.note && <p style={{ whiteSpace: 'pre-line' }}>{s.running.note}</p>}
        <Link className="btn-ok" href="/">{t('home')}</Link>
      </div>
    </div>
  );
}
/** 열린 관 위에 작은 띠 — 48시간 안 다음 점검(없으면 null) */
export async function MaintBand({ code, m }: { code: string; m?: MaintStatus | null }) {
  const s = m === undefined ? await maintOf(code) : m;
  if (!s?.next || s.running) return null;
  const t = await getTranslations('gwan.maint');
  return (
    <div className="gw-wrap" data-gwan-maint="next" data-gwan-maint-code={code}>
      <p className="mal-warn" role="note" style={{ margin: '8px 0' }}>◷ {t('next', { from: kst(s.next.startsAt), to: kst(s.next.endsAt) })}{s.next.note ? ` · ${s.next.note}` : ''}</p>
    </div>
  );
}

import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { apiGetPublic } from '@/lib/api';
import type { PublicStatus } from '@/components/upt/IncidentBar';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('upt'))('statusTitle') };
}
export const revalidate = 30;

const LV = { MINOR: 'lvMINOR', MAJOR: 'lvMAJOR', CRITICAL: 'lvCRITICAL' } as const;
const ST = { INVESTIGATING: 'stINVESTIGATING', IDENTIFIED: 'stIDENTIFIED', MONITORING: 'stMONITORING', RESOLVED: 'stRESOLVED' } as const;
const PT = { SITE: 'partSITE', API: 'partAPI', LOGIN: 'partLOGIN', PAY: 'partPAY', MALL: 'partMALL', MAIL: 'partMAIL', ADMIN: 'partADMIN' } as const;
const OV = { ok: 'stOk', minor: 'stMinor', major: 'stMajor', maintenance: 'stMaint', degraded: 'stDegraded' } as const;
const pick = <T extends Record<string, string>>(m: T, k: string): T[keyof T] | null => (k in m ? m[k as keyof T] : null);

/**
 * SB-HOM-UPT-010 서비스 상태 (v10.497 · D272 · docs/635) — 공개 상태 주소(GET /site/status)를 그대로
 *   전체 상태 · 진행 중 장애(정도 · 상태 · 영향 · 마지막 안내) · 점검 예약 · 바깥 감시 대상(정상 · 응답 없음) · 최근 30일 끝난 장애
 *   서버가 답하지 않으면 「불러오지 못했습니다」(이 화면 자체도 서버가 필요 — 서버가 죽으면 n8n 이 텔레그램으로 알림)
 */
export default async function StatusPage() {
  const [t, locale] = await Promise.all([getTranslations('upt'), getLocale()]);
  const s = await apiGetPublic<PublicStatus>('/site/status', 30).catch(() => null);
  const fmt = (v: string | null | undefined) => (v ? new Date(v).toLocaleString(locale === 'ko' ? 'ko-KR' : 'en-US', { timeZone: 'Asia/Seoul' }) : '—');
  const en = locale !== 'ko';
  const parts = (ps: string[]) => ps.map((p) => { const k = pick(PT, p); return k ? t(k) : p; }).join(' · ');
  const ov = s ? pick(OV, s.status) : null;
  return (
    <div className="upt-page" data-screen="SB-HOM-UPT-010" data-status={s?.status ?? 'unknown'}>
      <h1>{t('statusTitle')}</h1>
      <p className="upt-sub">{t('statusSub')}</p>
      <div className={`upt-ov upt-ov-${s?.status ?? 'unknown'}`} role="status">{ov ? t(ov) : t('stUnknown')}</div>
      {s?.maintenance.from && s.maintenance.until && !s.maintenance.on && (
        <p className="upt-sub" data-status-maint="">{t('maintNote', { from: fmt(s.maintenance.from), until: fmt(s.maintenance.until) })}</p>
      )}
      {s && (<>
        <h2>{t('hOpen')}</h2>
        {s.incidents.length === 0 ? <p className="upt-none">{t('noneOpen')}</p> : s.incidents.map((x) => {
          const lv = pick(LV, x.level), st = pick(ST, x.state);
          return (
            <section key={x.id} className={`upt-card upt-lv-${x.level.toLowerCase()}`} data-status-incident={x.state}>
              <h3>{(en && x.titleEn) || x.title}</h3>
              <p className="upt-meta">{lv ? t(lv) : x.level} · {st ? t(st) : x.state} · {t('started', { at: fmt(x.startedAt) })}{x.parts.length ? ` · ${t('parts', { parts: parts(x.parts) })}` : ''}</p>
              {(x.lastNote || x.lastNoteEn) && <p>{(en && x.lastNoteEn) || x.lastNote} <span className="upt-meta">({fmt(x.lastAt)})</span></p>}
            </section>
          );
        })}
        {s.checks.length > 0 && (<>
          <h2>{t('hChecks')}</h2>
          <ul className="upt-checks">{s.checks.map((c) => (
            <li key={c.target} data-status-check={c.target}><b>{c.target}</b> {c.down ? t('checkDown') : c.ok === false ? t('checkFail') : t('checkOk')}</li>
          ))}</ul>
        </>)}
        <h2>{t('hRecent')}</h2>
        {s.recent.length === 0 ? <p className="upt-none">{t('noneRecent')}</p> : (
          <ul className="upt-recent">{s.recent.map((x) => {
            const lv = pick(LV, x.level);
            return <li key={x.id}><b>{(en && x.titleEn) || x.title}</b> <span className="upt-meta">{lv ? t(lv) : x.level} · {t('started', { at: fmt(x.startedAt) })} · {t('resolvedAt', { at: fmt(x.resolvedAt) })}</span></li>;
          })}</ul>
        )}
        <p className="upt-meta">{t('updated', { at: fmt(s.time) })}</p>
      </>)}
    </div>
  );
}

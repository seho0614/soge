import { getTranslations } from 'next-intl/server';

/**
 * v10.371 (D239 · docs/506) — 사이트 점검 중 화면 · 점검 예정 띠.
 *   설정 site.maintenance_from · site.maintenance_until(「YYYY-MM-DDTHH:MM+09:00」 · 비면 점검 없음) · site.maintenance_note(_en).
 *   레이아웃이 읽는 공개 설정은 5분마다 다시 읽으므로 시작 · 끝이 최대 5분 늦을 수 있음. 운영 화면 · API 는 그대로.
 */
type S = Record<string, string | null>;
const kst = (v: string) => v.slice(0, 16).replace('T', ' ');

export function maintenanceState(settings: S, now = Date.now()): 'on' | 'soon' | null {
  const f = Date.parse(settings['site.maintenance_from'] ?? ''), u = Date.parse(settings['site.maintenance_until'] ?? '');
  if (!Number.isFinite(f) || !Number.isFinite(u) || u <= f || now >= u) return null;
  if (now >= f) return 'on';
  return now >= f - 24 * 3600_000 ? 'soon' : null;
}

export async function MaintenancePage({ settings, locale }: { settings: S; locale: string }) {
  const t = await getTranslations('common');
  const note = ((locale === 'ko' ? '' : settings['site.maintenance_note_en']) || settings['site.maintenance_note'] || '').trim();
  const phone = (settings['footer.phone'] ?? '').trim();
  return (
    <main id="main" className="maint-page" data-maintenance="on" style={{ maxWidth: 560, margin: '80px auto', padding: '0 16px', textAlign: 'center' }}>
      <h1>{t('maintTitle')}</h1>
      <p>{note || t('maintBody')}</p>
      <p data-maintenance-until="">{t('maintUntil', { until: kst(settings['site.maintenance_until'] ?? '') })}</p>
      {phone && <p className="muted">{t('maintContact', { phone })}</p>}
    </main>
  );
}

export async function MaintenanceSoon({ settings }: { settings: S }) {
  const t = await getTranslations('common');
  return (
    <div className="site-notice-bar" role="note" data-maintenance-soon="">
      {t('maintSoon', { from: kst(settings['site.maintenance_from'] ?? ''), until: kst(settings['site.maintenance_until'] ?? '') })}
    </div>
  );
}

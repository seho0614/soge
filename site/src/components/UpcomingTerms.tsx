import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { getTranslations } from 'next-intl/server';

interface Upcoming {
  code: string; version: string; title: string; body: string;
  effectiveFrom: string; changeNote: string | null; currentVersion: string | null; isNotice?: boolean;
}

const ymd = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
const load = () => apiGet<Upcoming[]>('/terms/upcoming', 60).catch(() => [] as Upcoming[]);

/**
 * v10.161 (docs/246 · D151) — 시행 예정 약관 알림(이용약관 제14조 「시행 7일 전 고지」).
 *   시행일 전까지는 지금 약관이 적용되고, 필수 약관은 시행일부터 다시 동의를 받습니다(GET /terms/required).
 *   바뀔 글은 여기서 펼쳐 봅니다 — 약관 전문(/terms/{code})은 지금 시행 중인 판을 보여 줍니다. 예정이 없으면 아무것도 그리지 않음.
 */
export async function UpcomingTerms() {
  const list = await load();
  if (!list.length) return null;
  const t = await getTranslations('policy');
  return (
    <div className="notice" id="upcoming-terms" data-upcoming-terms={list.length}>
      <div>
        <strong>{t('upcoming.title')}</strong>
        <p>{t('upcoming.body')}</p>
        {list.map((u) => (
          <details key={`${u.code}@${u.version}`} data-upcoming-term={u.code}>
            <summary>
              {t('upcoming.row', { title: u.title, version: u.version, date: ymd(u.effectiveFrom) })}
              {u.currentVersion && <span className="hint"> ({t('upcoming.now', { version: u.currentVersion })})</span>}
            </summary>
            <p><b>{t('upcoming.change')}</b> {u.changeNote ?? '—'}</p>
            <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 360, overflow: 'auto', fontSize: 13 }}>{u.body}</pre>
          </details>
        ))}
      </div>
    </div>
  );
}

/** v10.161 — 화면 아래 한 줄(바닥줄 위) · 약관 화면의 알림으로 */
export async function UpcomingTermsBar() {
  const list = await load();
  if (!list.length) return null;
  const t = await getTranslations('policy');
  return (
    <p className="hint pc-wrap" data-upcoming-bar style={{ padding: '8px 16px' }}>
      <b>{t('upcoming.bar')}</b>{' '}
      {list.map((u) => `${u.title} (${ymd(u.effectiveFrom)})`).join(' · ')}{' '}
      <Link href="/terms#upcoming-terms">{t('upcoming.more')}</Link>
    </p>
  );
}

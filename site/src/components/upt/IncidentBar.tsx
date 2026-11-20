import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { apiGetPublic } from '@/lib/api';

/**
 * v10.497 (D272 · docs/635) 장애 공지 띠 — 운영 화면(위험감지 › 가동 · 장애 공지)에서 「띠」를 켠 끝나지 않은 공지(최대 2건)
 *   공개 상태 주소(GET /site/status · 누구에게나 같음 → apiGetPublic 60초)에서 읽음 · 서버가 답하지 않으면 그리지 않음
 *   점검 중 화면(layout 의 maint === 'on') 위에도 나옴 · 자세히 → /status
 */
export interface StatusInc { id: string; title: string; titleEn: string | null; level: 'MINOR' | 'MAJOR' | 'CRITICAL'; state: string; banner: boolean; lastNote: string | null; lastNoteEn: string | null }
export interface PublicStatus {
  status: 'ok' | 'minor' | 'major' | 'maintenance' | 'degraded'; db: boolean; time: string;
  maintenance: { on: boolean; from: string | null; until: string | null };
  incidents: Array<StatusInc & { parts: string[]; startedAt: string; lastAt: string | null }>;
  recent: Array<{ id: string; title: string; titleEn: string | null; level: string; parts: string[]; startedAt: string; resolvedAt: string }>;
  checks: Array<{ target: string; ok: boolean | null; down: boolean; at: string }>;
}

export async function IncidentBar({ locale }: { locale: string }) {
  const s = await apiGetPublic<PublicStatus>('/site/status', 60).catch(() => null);
  const list = (s?.incidents ?? []).filter((x) => x.banner).slice(0, 2);
  if (!list.length) return null;
  const t = await getTranslations('upt');
  return (
    <div className="upt-bar" role="status" data-incident-bar={String(list.length)}>
      {list.map((x) => (
        <p key={x.id} className={`upt-bar-row upt-lv-${x.level.toLowerCase()}`} data-incident-level={x.level}>
          <b>{t('incBar', { title: (locale !== 'ko' && x.titleEn) || x.title })}</b>
          {(locale !== 'ko' && x.lastNoteEn) || x.lastNote ? <span> · {(locale !== 'ko' && x.lastNoteEn) || x.lastNote}</span> : null}
          {' '}<Link href="/status">{t('incMore')}</Link>
        </p>
      ))}
    </div>
  );
}

import { getTranslations } from 'next-intl/server';
import { apiGetPersonal } from '@/lib/api';
import { DigestToggle } from './DigestToggle';

/** v10.599 (docs/741) 나의공간 › 알림 「하루 요약 받기」 — GET /me/grw/digest · 스위치(grw.digest)가 꺼져 있고 내가 켠 적도 없으면 그리지 않음 */
export async function GrwDigestBox() {
  const d = await apiGetPersonal<{ available: boolean; enabled: boolean; emailReady: boolean }>('/me/grw/digest').catch(() => null);
  if (!d || (!d.available && !d.enabled)) return null;
  const t = await getTranslations('grw.digest');
  return (
    <DigestToggle initial={d.enabled} emailReady={d.emailReady}
      labels={{ title: t('title'), on: t('on'), off: t('off'), turnOn: t('turnOn'), turnOff: t('turnOff'), note: t('note'), mailWait: t('mailWait'), failed: t('failed') }} />
  );
}

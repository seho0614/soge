import { getTranslations } from 'next-intl/server';
import { apiGetPersonal } from '@/lib/api';
import { MemberMfa, type MfaLabels } from './MemberMfa';
import { LoginAlerts, type AlertLabels } from './LoginAlerts';

interface MfaStatus { available: boolean; staff: boolean; enrolled: boolean; backupLeft: number | null; hasPassword: boolean; lockedUntil: string | null }
interface Alerts { items: Array<{ id: string; createdAt: string; ipMasked: string | null; uaKind: string | null; answer: string | null; answeredAt: string | null; current: boolean; sessionAlive: boolean }>; open: number }

/**
 * v10.592 · 593 (docs/734 · 735) 나의공간 › 보안 — 「낯선 기기 로그인」(SB-MYP-SCX-020) · 「2단계 인증」(SB-MYP-SCX-010) 두 칸(서버 화면)
 *   GET /me/login-alerts · GET /me/mfa — 못 불러오면 그 칸만 숨김(로그인 기록 화면은 그대로)
 *   2단계 칸은 sec2.member_mfa on 일 때만 · 운영 계정은 안내 글만
 */
export async function ScxSecurity() {
  const t = await getTranslations('scx');
  const [mfa, alerts] = await Promise.all([
    apiGetPersonal<MfaStatus>('/me/mfa').catch(() => null),
    apiGetPersonal<Alerts>('/me/login-alerts').catch(() => null),
  ]);
  const al: AlertLabels = {
    title: t('alertTitle'), none: t('alertNone'), text: t('alertText'), me: t('alertMe'), notMe: t('alertNotMe'), at: t('alertAt'), device: t('alertDevice'),
    ip: t('alertIp'), answer: t('alertAnswer'), answeredMe: t('alertAnsweredMe'), answeredNotMe: t('alertAnsweredNotMe'), current: t('alertCurrent'),
    notMeConfirm: t('alertNotMeConfirm'), toPassword: t('toPassword'),
  };
  const ml: MfaLabels = {
    title: t('mfaTitle'), why: t('mfaWhy'), on: t('mfaOn'), off: t('mfaOffState'), staff: t('mfaStaffNote'), needPw: t('mfaNeedPw'), start: t('mfaStart'),
    secret: t('mfaSecret'), uri: t('mfaUri'), code: t('mfaCode'), enable: t('mfaEnable'), backup: t('mfaBackup'), backupLeft: t('mfaBackupLeft'),
    disable: t('mfaDisable'), password: t('mfaPassword'), codeOrBackup: t('mfaCodeOrBackup'), disableConfirm: t('mfaDisableConfirm'),
    working: t('working'), cancel: t('cancel'), locked: t('mfaLocked'),
  };
  return (
    <>
      {alerts && <LoginAlerts items={alerts.items} labels={al} />}
      {mfa && mfa.available && <MemberMfa status={mfa} labels={ml} />}
    </>
  );
}

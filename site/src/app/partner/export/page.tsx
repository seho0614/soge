import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { me } from '@/lib/session';
import { Msgs } from '@/i18n/Msgs';
import { Pgh } from '@/components/partner/ui';
import { PtnExportView } from '@/components/vsx/PtnExportView';
import '@/styles/vsx.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('vsx.exp'))('title') };
}

/**
 * v10.544 (D284 · docs/682) SB-PTC-VSX-010 파트너센터 › 자료 내려받기
 *   GET /partner/export · POST /partner/export/request · GET /partner/export/leads?ticket= · GET /partner/export/perf
 *   리드 CSV 는 내려받기 승인(다른 SUPER) 뒤 24시간 안 한 번 · 연락처 칸 없음 · 성과 CSV 는 숫자만 · 대표 · 정산 권한 직원만
 *   파트너센터 메뉴 줄(PartnerShell)은 고치지 않음 — 실적 · 등급 화면 아래 단추로 들어옴(패치 5-6 · 5-7)
 */
export default async function PartnerExportPage() {
  if (!(await me())) redirect('/login?next=/partner/export');
  const t = await getTranslations('vsx.exp');
  return (
    <div data-screen="SB-PTC-VSX-010">
      <Pgh title={t('title')} sub={t('sub')} />
      <Msgs ns={['vsx']}><PtnExportView /></Msgs>
      <i hidden data-root-end="" />
    </div>
  );
}

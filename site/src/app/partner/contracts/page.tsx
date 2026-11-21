import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { me } from '@/lib/session';
import { Pgh } from '@/components/partner/ui';
import { PartnerContracts } from '@/components/bzx/PartnerContracts';

const T = {
  ko: { title: '파트너 계약', sub: '맺은 계약 · 만기 · 갱신 계약 서명. 만기 전에 갱신 계약이 오면 여기서 확인하고 서명합니다.' },
  en: { title: 'Partner contracts', sub: 'Your contracts, expiry dates and renewal signatures. When a renewal arrives before expiry, review and sign it here.' },
};

export async function generateMetadata(): Promise<Metadata> {
  return { title: T[(await getLocale()) === 'ko' ? 'ko' : 'en'].title };
}

/**
 * v10.609 (docs/751) SB-PTC-BZX-010 파트너센터 › 계약 — 대표 계정만(API 가 막음)
 *   GET /partner/bzx/contracts · POST /partner/bzx/contracts/{id}/sign
 *   파트너센터 메뉴 줄(PartnerShell)은 고치지 않음 — 회원 알림 BZX_PARTNER_CONTRACT 의 주소(/partner/contracts)로 들어옴
 *   v10.617 (docs/759) — 「회사 · 계정」 메뉴 안 하위 링크 「계약」으로도 들어옴(메뉴 12개는 그대로)
 */
export default async function PartnerContractsPage() {
  if (!(await me())) redirect('/login?next=/partner/contracts');
  const t = T[(await getLocale()) === 'ko' ? 'ko' : 'en'];
  return (
    <div data-screen="SB-PTC-BZX-010">
      <Pgh title={t.title} sub={t.sub} />
      <PartnerContracts />
      <i hidden data-root-end="" />
    </div>
  );
}

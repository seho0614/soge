import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { OwnChrome } from '@/components/common/OwnChrome';
import { PartnerTopBar } from '@/components/partner/PartnerShell';
import { GRADE_KO, ptCode } from '@/components/partner/ui';
import { Msgs } from '@/i18n/Msgs';
import { getTranslations } from 'next-intl/server';

interface Dash { applied: boolean; company?: string; grade?: string; card?: { mainCategory?: string | null; categoryCount?: number } }

/**
 * v10.29 — 안심소개 파트너센터(/partner/**) 공통 틀 — 시안 pcShell(cur, title, sub, body)
 *
 *   전용 상단바(어두운 초록 · 메뉴 12개)  →  본문(.wrap.admw)  →  꼬리줄(일반 꼬리줄 그대로 — 시안 FS())
 *
 * 일반 머리줄은 이 경로에서 숨깁니다(<OwnChrome /> · Chrome.tsx 의 OWN_HEADER_PATHS).
 * 오른쪽 「업체명 · 업종」은 시안 자리 그대로 — v10.31: GET /partner/dashboard 의 상호 · 대표 업종(card.mainCategory · 승인 서비스가 가장 많은 업종).
 * 로그인 확인 · 이동은 각 화면이 합니다(여기서 막으면 화면별 안내가 사라집니다).
 */
export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('partner');
  const p = await me();
  const d = p ? await apiGet<Dash>('/partner/dashboard', 0).catch(() => null) : null;
  const cat = d?.card?.mainCategory ? `${d.card.mainCategory}${(d.card.categoryCount ?? 0) > 1 ? t('common.more', { n: String((d.card.categoryCount ?? 1) - 1) }) : ''}`
    : t('shell.gradeLabel', { grade: ptCode(t, 'grade', d?.grade, GRADE_KO[d?.grade ?? ''] ?? d?.grade ?? '') });
  const corp = d?.applied && d.company ? `${d.company} · ${cat}` : null;
  return (
    <Msgs ns={['partner', 'partnerOps', 'affiliate']}>
      <div className="pt-root" data-ptc-shell="">
        <OwnChrome />
        <PartnerTopBar corp={corp} />
        <div className="pt-in pt-wrap">{children}</div>
      </div>
    </Msgs>
  );
}

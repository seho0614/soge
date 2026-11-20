import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiGetPersonal } from '@/lib/api';
import { me } from '@/lib/session';
import { MyHead, Note, Empty } from '@/components/my/ui';
import { Msgs } from '@/i18n/Msgs';
import { ToolsRow, type ToolItem, type ToolPolicy } from '@/components/lsx/ToolsRow';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('lsx'))('toolsTitle') };
}
export const dynamic = 'force-dynamic';

/** SB-MYP-LSX-020 매물 관리 도구 (v10.514 ~ 516 · D276 · docs/652 · 653) — GET /me/lsx/listings */
export default async function ListingTools() {
  if (!(await me())) redirect('/login');
  const t = await getTranslations('lsx');
  const d = await apiGetPersonal<{ policy: ToolPolicy; items: ToolItem[] }>('/me/lsx/listings').catch(() => null);
  return (
    <>
      <MyHead title={t('toolsTitle')} sub={t('toolsSub')} />
      <Note kind="info">{t('expiryNote')}</Note>
      {d && d.policy.bumpMode !== 'OFF' && (
        <Note kind="plain" data-lsx-bump-policy={d.policy.bumpMode}>
          {t('bumpRule', { h: String(d.policy.effectHours) })}
          {d.policy.bumpMode === 'FREE' && <> {t('bumpFreeLeft', { n: String(d.policy.freeLeft) })}</>}
          {d.policy.bumpMode === 'PAID' && <> {t('bumpRefundNote')}</>}
        </Note>
      )}
      {!d || d.items.length === 0 ? <Empty>{t('toolsEmpty')}</Empty> : (
        <Msgs ns={['lsx']}>
          <div data-lsx-tools={d.items.length}>{d.items.map((it) => <ToolsRow key={it.id} item={it} policy={d.policy} />)}</div>
        </Msgs>
      )}
    </>
  );
}

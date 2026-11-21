import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiGetPersonal } from '@/lib/api';
import { ymdKst } from '@/lib/format';
import { me } from '@/lib/session';
import { MyHead, Note, Table } from '@/components/my/ui';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('mtr'))('trustTitle') };
}
export const dynamic = 'force-dynamic';

interface Item { code: string; label: string; max: number; got: number; basis: Record<string, number | boolean | null> }
interface View { on: boolean; score?: number; sample?: number; items?: Item[]; computedAt?: string | null }

/**
 * SB-MYP-MTR-020 내 신뢰 점수 (v10.575 · docs/717) — GET /me/mtr/trust
 *   켜져 있을 때만(mtr.trust) · 칸마다 얻은 점수 · 근거 수 · 본인만 봄 · 노출 순위 · 검색 순서 · 소개비에 쓰지 않음
 *   칸 이름은 서버 산식 표(mtr_trust_rules.label) 그대로 · 나의공간 메뉴(MyShell)는 고치지 않음
 */
export default async function MyTrustPage() {
  if (!(await me())) redirect('/login?next=/my/trust');
  const t = await getTranslations('mtr');
  const d = await apiGetPersonal<View>('/me/mtr/trust').catch(() => null);
  const basis = (it: Item) => {
    const b = it.basis ?? {};
    const n = (k: string) => String(b[k] ?? 0);
    switch (it.code) {
      case 'IDENTITY': case 'BUSINESS': return b.verified ? t('bVerified') : t('bNotVerified');
      case 'DEAL': return t('bDeal', { n: n('deals'), full: n('fullAt') });
      case 'REVIEW': return t('bReview', { n: n('reviews'), avg: n('avg'), full: n('fullAt') });
      case 'RESPONSE': return b.enough ? t('bResponse', { n: n('conversations'), h: n('medianHours'), full: n('fullAt') }) : t('bResponseFew', { n: n('conversations') });
      case 'REPORT': return t('bReport', { n: n('upheld'), full: n('fullAt') });
      default: return t('bBase');
    }
  };
  return (
    <div data-screen="SB-MYP-MTR-020">
      <MyHead title={t('trustTitle')} sub={t('trustSub')}
        right={d?.on ? <b data-mtr-trust-score={String(d.score ?? 0)}>{t('trustScore', { score: String(d.score ?? 0) })}</b> : undefined} />
      {!d || !d.on ? <Note kind="warn" data-mtr-trust-off="">{t('trustOff')}</Note> : (
        <>
          <Table head={[t('thItem'), t('thGot'), t('thBasis')]}>
            {(d.items ?? []).map((it) => (
              <tr key={it.code} data-mtr-trust-item={it.code}>
                <td>{it.label}</td>
                <td>{it.got} / {it.max}</td>
                <td>{basis(it)}</td>
              </tr>
            ))}
          </Table>
          {d.computedAt && <p><small>{t('computedAt', { date: ymdKst(d.computedAt) })}</small></p>}
        </>
      )}
      <Note kind="info">{t('trustNote')}</Note>
    </div>
  );
}

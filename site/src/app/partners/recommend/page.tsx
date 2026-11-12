import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { ApiFailure, apiGetPersonal } from '@/lib/api';
import { CopyButton } from '@/components/partners/CopyButton';
import { siteOrigin } from '@/components/refcode/origin';
import { getTranslations } from 'next-intl/server';
import { RcmTree } from '@/components/recommend/RcmTree';
import { rcmLabels } from '@/components/recommend/labels';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('affiliate'))('recommend.metaTitle') };
}

interface Node { k: number; p: number; gen: number; name: string | null; joined: string; children: number }
interface Tree { root: { name: string; code: string | null }; total: number; truncated: boolean; generations: Array<{ gen: number; count: number }>; nodes: Node[] }
interface Mine { code: string | null; link: string | null; directCount: number }

/**
 * SB-AFC-RCM-010 추천 관계도 — v10.218 (D189 · docs/351)
 *   GET /partner/affiliate/recommend-tree(활동 중 제휴 파트너 본인 아래 전체) · GET /me/recommend(내 코드 · 링크).
 *   내가 추천한 분은 가린 이름 + 가입일, 그분들이 추천한 분은 가린 이름 + 가입 월만 — 실적 · 연락처 · 회원 번호 없음.
 *   계층 용어(하위 · 산하 · 직급)를 쓰지 않습니다. v10.254 (docs/388) — 그림 ↔ 목록(RcmTree · 나의공간과 같은 부품).
 */
export default async function PartnerRecommendPage() {
  const p = await me();
  if (!p) redirect('/login');
  const t = await getTranslations('affiliate.recommend');

  let denied = false;
  const [tree, mine, origin] = await Promise.all([
    apiGetPersonal<Tree>('/partner/affiliate/recommend-tree').catch((e) => { if (e instanceof ApiFailure && e.isGate) denied = true; return null; }),
    apiGetPersonal<Mine>('/me/recommend').catch(() => null),
    siteOrigin(),
  ]);
  const link = mine?.link ? origin + mine.link : null;

  return (
    <div data-screen="SB-AFC-RCM-010">
      <div className="page-head"><h1>{t('title')}</h1></div>
      <p className="lead">{t('lead')}</p>

      {mine?.code && (
        <div className="card p2pad" data-rcm-mine="">
          <strong>{t('myCode')}</strong> <code className="mono" data-testid="rcm-code">{mine.code}</code>{' '}
          <CopyButton text={mine.code} label={t('copyCode')} />
          {link && <><br /><code className="mono" data-testid="rcm-link">{link}</code> <CopyButton text={link} label={t('copyLink')} /></>}
        </div>
      )}

      {denied ? (
        <p className="empty" data-rcm-denied="">{t('denied')}</p>
      ) : !tree ? (
        <p className="form-error" role="alert">{t('loadFail')}</p>
      ) : tree.total === 0 ? (
        <p className="empty">{t('none')}</p>
      ) : (
        <>
          <p data-rcm-total={tree.total}>
            {t('total', { n: tree.total })}{' '}
            {tree.generations.map((g) => <span key={g.gen} className="state" data-rcm-g={g.gen}>{t(g.gen === 1 ? 'genMine' : 'genN', { g: g.gen, n: g.count })}</span>)}
          </p>
          {tree.truncated && <p className="notice">{t('truncated')}</p>}
          <p className="dim">{t('graphHint')}</p>
          <RcmTree rootName={tree.root.name} nodes={tree.nodes} L={rcmLabels(t as unknown as Parameters<typeof rcmLabels>[0])} />
          <p className="dim" style={{ marginTop: 12 }}>{t('note')}</p>
        </>
      )}
    </div>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { CopyButton } from '@/components/partners/CopyButton';
import { siteOrigin } from '@/components/refcode/origin';
import { MyHead, Note } from '@/components/my/ui';
import { RcmTree, type RcmNode } from '@/components/recommend/RcmTree';
import { rcmLabels } from '@/components/recommend/labels';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('affiliate'))('recommend.metaTitle') };
}

interface Tree { root: { name: string; code: string | null }; total: number; truncated: boolean; generations: Array<{ gen: number; count: number }>; reward: { points: number; got: number; wait: number; none: number }; nodes: RcmNode[] }
interface Mine { code: string | null; link: string | null; directCount: number; recommender: string | null }

/**
 * SB-MYP-RCM-010 나의공간 › 추천 › 추천 관계도 — v10.253 · 254 (docs/388)
 *   대표 「회원조직관리 전체 적용 · 트리 형태」(11/12) → 모든 회원이 자기 아래 관계도를 봄(제휴 파트너가 아니어도).
 *   GET /me/recommend/tree · GET /me/recommend. 가린 이름 · 가입일(직접 추천) · 가입 월(그 아래)만 — 실적 · 금액 · 연락처 · 회원 번호 없음.
 *   계층 용어(하위 · 산하 · 직급 · 조직)를 쓰지 않습니다(브랜드 원칙 conversation-audit #3).
 *   v10.258 (docs/390) — 직접 추천한 분 상자에 내가 받은 추천 보상 · 위에 합계(그분 금액 아님 · 1단계만).
 */
export default async function MyRecommendPage() {
  const p = await me();
  if (!p) redirect('/login?next=/my/recommend');
  const t = await getTranslations('affiliate.recommend');
  const [tree, mine, origin] = await Promise.all([
    apiGetPersonal<Tree>('/me/recommend/tree').catch(() => null),
    apiGetPersonal<Mine>('/me/recommend').catch(() => null),
    siteOrigin(),
  ]);
  const link = mine?.link ? origin + mine.link : null;

  return (
    <div data-screen="SB-MYP-RCM-010">
      <MyHead title={t('title')} sub={t('myLead')} />
      {mine?.code && (
        <Note kind="info" data-rcm-mine="">
          <b>{t('myCode')}</b> <code className="mono" data-testid="rcm-code">{mine.code}</code>{' '}
          <CopyButton text={mine.code} label={t('copyCode')} />
          {link && <><br /><code className="mono" data-testid="rcm-link">{link}</code> <CopyButton text={link} label={t('copyLink')} /></>}
        </Note>
      )}
      {!tree ? (
        <p className="form-error" role="alert">{t('loadFail')}</p>
      ) : tree.total === 0 ? (
        <p className="empty" data-rcm-total="0">{t('none')}</p>
      ) : (
        <>
          <p data-rcm-total={tree.total}>
            {t('total', { n: tree.total })}{' '}
            {tree.generations.map((g) => <span key={g.gen} className="state" data-rcm-g={g.gen}>{t(g.gen === 1 ? 'genMine' : 'genN', { g: g.gen, n: g.count })}</span>)}
          </p>
          <p data-rcm-reward-sum={`${tree.reward.points}|${tree.reward.got}|${tree.reward.wait}`}>
            <b>{t('rewardSum', { p: tree.reward.points.toLocaleString('ko-KR'), a: tree.reward.got, b: tree.reward.wait })}</b>{' '}
            <Link href="/my/settlement/all#referral" className="dim">{t('rewardMore')}</Link>
          </p>
          {tree.truncated && <p className="notice">{t('truncated')}</p>}
          <p className="dim">{t('graphHint')}</p>
          <RcmTree rootName={tree.root.name} nodes={tree.nodes} L={rcmLabels(t as unknown as Parameters<typeof rcmLabels>[0])} />
        </>
      )}
      <p className="dim" style={{ marginTop: 12 }}>{t('note')}</p>
      <p className="dim">{t('rewardNote')}</p>
    </div>
  );
}

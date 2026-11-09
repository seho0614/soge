import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { ApiFailure, apiGetPersonal } from '@/lib/api';
import { CopyButton } from '@/components/partners/CopyButton';
import { siteOrigin } from '@/components/refcode/origin';
import { getTranslations } from 'next-intl/server';

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
 *   계층 용어(하위 · 산하 · 직급)를 쓰지 않습니다. 접고 펴기는 <details>(자바스크립트 없이).
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

  const kids = new Map<number, Node[]>();
  for (const n of tree?.nodes ?? []) kids.set(n.p, [...(kids.get(n.p) ?? []), n]);

  const branch = (pk: number) => {
    const list = kids.get(pk) ?? [];
    if (!list.length) return null;
    return (
      <ul className="rcm-ul">
        {list.map((n) => (
          <li key={n.k} data-rcm-gen={n.gen}>
            {n.children > 0 ? (
              <details open={n.gen === 1 && list.length <= 30}>
                <summary><b>{n.name ?? t('left')}</b> <span className="dim">{t(n.gen === 1 ? 'joinedDay' : 'joinedMonth', { d: n.joined })}</span>{' '}
                  <span className="state">{t('theirs', { n: n.children })}</span></summary>
                {branch(n.k)}
              </details>
            ) : (
              <span className="rcm-leaf"><b>{n.name ?? t('left')}</b> <span className="dim">{t(n.gen === 1 ? 'joinedDay' : 'joinedMonth', { d: n.joined })}</span></span>
            )}
          </li>
        ))}
      </ul>
    );
  };

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
          <div className="card p2pad rcm-tree">
            <div><b>{tree.root.name}</b> <span className="dim">({t('me')})</span></div>
            {branch(0)}
          </div>
          <p className="dim" style={{ marginTop: 12 }}>{t('note')}</p>
        </>
      )}
    </div>
  );
}

'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

/**
 * v10.211 (D188 · docs/336) — 소개광장 맨 위 「동네픽」
 *   운영자가 승인한 동네픽만(AI 가 고르고 사람이 확인 · 30일) — 없으면 아무것도 그리지 않음.
 *   로그인했고 동네 인증이 있으면 내 시 · 구 것을 먼저, 없으면 전국 최근 6개.
 */
interface Pick { id: string; postId: string; source: 'PLAZA' | 'FOOD'; region: string; headline: string; summary: string }

export function TownPicks({ loggedIn }: { loggedIn: boolean }) {
  const t = useTranslations('plaza.picks');
  const [data, setData] = useState<{ region: string | null; items: Pick[] } | null>(null);

  useEffect(() => {
    let gone = false;
    (async () => {
      let region = '';
      if (loggedIn) {
        const m = await fetch('/api/v1/me/town').then((r) => (r.ok ? r.json() : null)).catch(() => null) as { town?: { admName?: string } | null } | null;
        region = (m?.town?.admName ?? '').replace(/\s*\S+$/, '');
      }
      const d = await fetch(`/api/v1/community/town-picks${region ? `?region=${encodeURIComponent(region)}` : ''}`)
        .then((r) => (r.ok ? r.json() : null)).catch(() => null) as { region: string | null; items: Pick[] } | null;
      if (!gone) setData(d);
    })();
    return () => { gone = true; };
  }, [loggedIn]);

  if (!data?.items?.length) return null;
  return (
    <section className="notice" data-town-picks={data.region ? 'mine' : 'all'} aria-label={t('title')}>
      <div>
        <strong>{data.region ? t('mine', { region: data.region }) : t('all')}</strong>
        <p className="hint">{t('help')}</p>
        <ul>
          {data.items.map((p) => (
            <li key={p.id} data-town-pick>
              <span className="badge">{p.source === 'FOOD' ? t('food') : t('plaza')}</span>{' '}
              <Link href={`/community/${p.postId}`}><b>{p.headline}</b></Link>
              <span className="hint"> — {p.summary}{data.region ? '' : ` · ${p.region}`}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

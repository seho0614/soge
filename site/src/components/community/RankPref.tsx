'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

/**
 * v10.507 (D274 · docs/645) 랭킹 노출 끄기 · 켜기 — SB-HOM-MLX-010 · PUT /api/v1/me/community/rank-pref { hide }
 *   끄면 공개 랭킹에 나오지 않음(점수 · 배지는 그대로 · 본인 화면에는 보임)
 */
export function RankPref({ hidden }: { hidden: boolean }) {
  const t = useTranslations('plaza');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <p data-rank-pref={hidden ? 'hidden' : 'shown'}>
      {hidden && <span className="dim">{t('rankHidden')} </span>}
      <button type="button" className="sgb-btn sgb-btn--sm sgb-btn--sec" disabled={pending}
        onClick={() => start(async () => {
          setErr(null);
          const r = await fetch('/api/v1/me/community/rank-pref', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hide: !hidden }) });
          if (!r.ok) { setErr(t('rankPrefFail')); return; }
          router.refresh();
        })}>{hidden ? t('rankShow') : t('rankHide')}</button>
      {err && <span className="form-error" role="alert"> {err}</span>}
    </p>
  );
}

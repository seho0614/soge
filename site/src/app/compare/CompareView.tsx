'use client';
/**
 * v10.502 (D273 · docs/640) SB-HOM-MBX-020 비교하기 — 브라우저 부품
 *   비교함(localStorage sgb_mbx_cmp)의 것을 GET /site/mbx/compare?type=&ids= 로 읽어 칸마다 한 줄.
 *   서버가 공개 칸만 줌 — 등록자 이름 · 연락처 · 정확한 위치 · 본문은 없음. 내려간 것은 빠지고 「n개 빠짐」.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useFmt } from '@/lib/useFmt';
import { GWAN_PATH } from '@/lib/format';
import { localCompare, saveCompare, type LocalCompare } from '@/components/mbx/mbxLocal';

type Item = Record<string, unknown> & { id?: string; code?: string; title?: string; name?: string };
interface Res { enabled: boolean; type: 'LISTING' | 'PRODUCT'; fields: Array<{ key: string; label: string }>; items: Item[]; missing: number }

const L_KEYS = ['gwanCode', 'categoryName', 'dealAmount', 'desiredFee', 'feeBearerLabel', 'region', 'listingNo', 'publishedAt', 'likeCount', 'viewCount', 'trustScore', 'owner'] as const;
const P_KEYS = ['category', 'price', 'listPrice', 'offPct', 'minUnit', 'mainIngredient', 'ratingAvg', 'reviewCount', 'soldOut', 'sellerType', 'withdrawal'] as const;
type FieldKey = (typeof L_KEYS)[number] | (typeof P_KEYS)[number];

export function CompareView({ enabled }: { enabled: boolean }) {
  const t = useTranslations('mbx.compare');
  const f = useFmt();
  const [box, setBox] = useState<LocalCompare>({ type: null, items: [] });
  const [res, setRes] = useState<Res | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => setBox(localCompare());
    sync();
    window.addEventListener('sgb-mbx-cmp', sync);
    return () => window.removeEventListener('sgb-mbx-cmp', sync);
  }, []);
  useEffect(() => {
    if (!enabled || !box.type || !box.items.length) { setRes(null); return; }
    let live = true;
    setErr(null);
    fetch(`/api/v1/site/mbx/compare?type=${box.type}&ids=${encodeURIComponent(box.items.map((x) => x.key).join(','))}`)
      .then(async (r) => { const d = await r.json().catch(() => null); if (!live) return; if (!r.ok) { setErr(d?.message ?? t('failed')); return; } setRes(d as Res); })
      .catch(() => live && setErr(t('failed')));
    return () => { live = false; };
  }, [enabled, box, t]);

  if (!enabled) return <div className="mbx-empty" data-mbx-cmp-off="">{t('off')}</div>;
  if (!box.items.length) return <div className="mbx-empty" data-mbx-cmp-empty="">{t('empty')} <Link href="/recent">{t('fromRecent')}</Link></div>;

  const keys: readonly FieldKey[] = box.type === 'PRODUCT' ? P_KEYS : L_KEYS;
  const href = (it: Item) => (box.type === 'PRODUCT' ? `/health/p/${encodeURIComponent(String(it.code))}` : `/${GWAN_PATH[String(it.gwanCode ?? '')] ?? 'money'}/${String(it.id)}`);
  const remove = (key: string) => saveCompare({ type: box.type, items: box.items.filter((x) => x.key !== key) });
  const val = (k: FieldKey, it: Item): string => {
    const v = it[k];
    if (v == null || v === '') return '—';
    switch (k) {
      case 'dealAmount': case 'desiredFee': case 'price': case 'listPrice': case 'minUnit': return f.won(v as number);
      case 'offPct': return `${String(v)}%`;
      case 'publishedAt': return new Date(String(v)).toLocaleDateString(f.ko ? 'ko-KR' : 'en-US', { timeZone: 'Asia/Seoul' });
      case 'likeCount': case 'viewCount': case 'reviewCount': return f.num(v as number);
      case 'trustScore': return String(Math.round(Number(v) * 10) / 10);
      case 'ratingAvg': return Number(v).toFixed(1);
      case 'soldOut': return v ? t('yes') : t('no');
      case 'listingNo': return `L-${String(v)}`;
      case 'sellerType': return v === 'DIRECT' ? t('direct') : t('tenant');
      case 'owner': { const o = v as { companyName?: string; verified?: boolean; confirmedDeals?: number }; return `${o.companyName ?? '—'}${o.verified ? ` · ${t('verified')}` : ''} · ${t('deals', { n: String(o.confirmedDeals ?? 0) })}`; }
      case 'mainIngredient': { const m = v as { name?: string; amount?: string | null }; return [m.name, m.amount].filter(Boolean).join(' '); }
      default: return String(v);
    }
  };

  return (
    <>
      <div className="mbx-row">
        <span className="mbx-badge">{box.type === 'PRODUCT' ? t('typeProduct') : t('typeListing')}</span>
        <span className="mbx-sub mbx-flat">{t('count', { n: String(box.items.length), max: '4' })}</span>
        <button type="button" className="mbx-btn" onClick={() => saveCompare({ type: null, items: [] })} data-mbx-cmp-clear="">{t('clear')}</button>
      </div>
      {err && <p className="mbx-note warn" role="status">{err}</p>}
      {res && res.missing > 0 && <p className="mbx-note" data-mbx-cmp-missing={res.missing}>{t('missing', { n: String(res.missing) })}</p>}
      {res && (
        <div className="mbx-cmp-scroll">
          <table className="mbx-cmp" data-mbx-cmp-table={res.items.length}>
            <thead><tr><th>{t('item')}</th>{res.items.map((it) => {
              const key = String(box.type === 'PRODUCT' ? it.code : it.id);
              return <th key={key}><Link href={href(it)}>{String(it.title ?? it.name ?? '')}</Link><br />
                <button type="button" className="mbx-btn" onClick={() => remove(key)} data-mbx-cmp-remove={key}>{t('remove')}</button></th>;
            })}</tr></thead>
            <tbody>{keys.map((k) => (
              <tr key={k} data-mbx-cmp-field={k}><th>{t(('f.' + k) as `f.${FieldKey}`)}</th>{res.items.map((it) => <td key={String(it.id ?? it.code)}>{val(k, it)}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}

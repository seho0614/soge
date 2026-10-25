/** v10.28 (D036) — 상품 상세 「리뷰」 · 「문의」 탭. 시안 SB-HLT-PRD-010 의 탭 3개(상세 · 리뷰 · 문의) */
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { apiGetPersonal } from '@/lib/api';
import { Msgs } from '@/i18n/Msgs';
import { QnaForm } from './QnaForm';
import { ymdKst } from '@/lib/format';

interface ReviewList { count: number; avg: number | null; dist: Record<string, number>; items: Array<{ id: string; rating: number; body: string; createdAt: string; writer: string; mine: boolean; optionLabel: string | null }> }
interface QnaList { count: number; items: Array<{ id: string; isPrivate: boolean; createdAt: string; writer: string; mine: boolean; body: string | null; answer: string | null; answeredAt: string | null; answered: boolean }> }

const ymd = (s: string) => ymdKst(s);      /* G-201 규칙 — toLocale… 쓰지 않음 */
export const stars = (n: number) => '★★★★★'.slice(0, Math.round(n)) + '☆☆☆☆☆'.slice(0, 5 - Math.round(n));

export async function ReviewsPanel({ code, rating }: { code: string; rating?: number }) {
  const r = await apiGetPersonal<ReviewList>(`/health/products/${encodeURIComponent(code)}/reviews${rating ? `?rating=${rating}` : ''}`)
    .catch(() => ({ count: 0, avg: null, dist: {}, items: [] }) as ReviewList);
  const base = `/health/p/${encodeURIComponent(code)}?tab=reviews`;
  const t = await getTranslations('hlt.reviews');
  const tc = await getTranslations('hlt.common');
  return (
    <div className="hlt-box" data-reviews id="reviews">
      {r.count === 0 && !rating ? <p className="hlt-mut" data-reviews-empty>{t('empty')}</p> : <>
        <div className="hlt-rvsum" data-review-avg={r.avg ?? ''}>
          <b className="hlt-rvavg">{r.avg?.toFixed(1) ?? '-'}</b> <span className="hlt-stars" aria-label={t('avgAria', { n: String(r.avg ?? 0) })}>{stars(r.avg ?? 0)}</span>
          <span className="hlt-mut"> {t('count', { n: r.count.toLocaleString('ko-KR') })}</span>
        </div>
        <div className="hlt-rvf" role="group" aria-label={t('filterAria')}>
          <Link href={base} className={!rating ? 'on' : undefined} data-rvfilter="ALL">{tc('all')}</Link>
          {[5, 4, 3, 2, 1].map((k) => <Link key={k} href={`${base}&rating=${k}`} className={rating === k ? 'on' : undefined} data-rvfilter={k}>{t('starFilter', { k: String(k), n: String(r.dist[String(k)] ?? 0) })}</Link>)}
        </div>
        {r.items.length === 0 ? <p className="hlt-mut">{t('noneForStar')}</p> : (
          <ul className="hlt-rvlist">
            {r.items.map((x) => (
              <li key={x.id} data-review={x.id}>
                <div><span className="hlt-stars">{stars(x.rating)}</span> <b>{x.writer}</b> <span className="hlt-mut hlt-sm">{ymd(x.createdAt)}{x.optionLabel && x.optionLabel !== '단품' ? ` · ${x.optionLabel}` : ''}{x.mine ? ` · ${t('mine')}` : ''}</span></div>
                <p>{x.body}</p>
              </li>))}
          </ul>)}
      </>}
      <p className="hlt-mut hlt-sm">{t('note')}</p>
    </div>
  );
}

export async function QnaPanel({ code, loggedIn }: { code: string; loggedIn: boolean }) {
  const q = await apiGetPersonal<QnaList>(`/health/products/${encodeURIComponent(code)}/qna`).catch(() => ({ count: 0, items: [] }) as QnaList);
  const t = await getTranslations('hlt.qna');
  const tc = await getTranslations('hlt.common');
  return (
    <div className="hlt-box" data-qna id="qna">
      {loggedIn ? <Msgs ns={['hlt']}><QnaForm code={code} /></Msgs> : <p className="hlt-mut" data-qna-login>{t.rich('login', { login: (c) => <Link href={`/login?next=${encodeURIComponent(`/health/p/${code}?tab=qna`)}`}>{c}</Link> })}</p>}
      {q.items.length === 0 ? <p className="hlt-mut" data-qna-empty>{t('empty')}</p> : (
        <ul className="hlt-qnalist">
          {q.items.map((x) => (
            <li key={x.id} data-qna-row={x.id}>
              <div><span className={`hlt-bdg ${x.answered ? 'st ok' : ''}`}>{x.answered ? t('answered') : t('waiting')}</span> <b>{x.writer}</b> <span className="hlt-mut hlt-sm">{ymd(x.createdAt)}{x.isPrivate ? ` · ${t('private')}` : ''}</span></div>
              <p>{x.body ?? t('privateBody')}</p>
              {x.answer && <p className="hlt-ans" data-qna-answer><b>{tc('mall')}</b> {x.answer}</p>}
            </li>))}
        </ul>)}
    </div>
  );
}

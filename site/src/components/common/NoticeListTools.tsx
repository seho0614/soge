/**
 * v10.328 (docs/456) — 공지 목록 찾기 칸 · 쪽 넘기기(30개씩). 소개광장 › 공지(v10.324)와 같은 기준 · 같은 글자(plaza.ntc).
 *   제휴 파트너센터 › 공지사항(/partners/notices) · 안심 파트너센터 › 공지 · 알림 › 「공지사항」 탭(/partner/notices)이 씀.
 *   주소 칸 nq(찾는 글자) · np(쪽) — 서버가 GET /notices?q=&page= 로 부름.
 */
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

export const NOTICE_PAGE = 30;

export function noticeQuery(sp: { nq?: string; np?: string }) {
  const nq = typeof sp.nq === 'string' ? sp.nq.trim().replace(/\s+/g, ' ').slice(0, 100) : '';
  const np = /^\d{1,4}$/.test(String(sp.np ?? '')) ? Math.max(1, Number(sp.np)) : 1;
  const qs = new URLSearchParams();
  if (nq) qs.set('q', nq);
  if (np > 1) qs.set('page', String(np));
  return { nq, np, api: `/notices${qs.toString() ? `?${qs}` : ''}` };
}

const href = (path: string, nq: string, np: number) => {
  const p = new URLSearchParams();
  if (nq) p.set('nq', nq);
  if (np > 1) p.set('np', String(np));
  return p.toString() ? `${path}?${p}` : path;
};

export async function NoticeSearch({ path, nq }: { path: string; nq: string }) {
  const t = await getTranslations('plaza');
  return (
    <form className="nt-q" action={path} method="get" role="search" data-notice-search={nq}>
      <input type="search" name="nq" defaultValue={nq} maxLength={100} placeholder={t('ntc.qPh')} aria-label={t('ntc.qAria')} />
      <button type="submit" className="btn btn-sm">{t('ntc.qGo')}</button>
      {nq && <Link href={path} data-notice-search-clear>{t('ntc.qClear')}</Link>}
    </form>
  );
}

export async function NoticeEmptyText({ nq, np, empty }: { nq: string; np: number; empty: string }) {
  const t = await getTranslations('plaza');
  return <>{nq ? t('ntc.qEmpty', { q: nq }) : np > 1 ? t('ntc.pageEmpty') : empty}</>;
}

export async function NoticePager({ path, nq, np, count }: { path: string; nq: string; np: number; count: number }) {
  if (np <= 1 && count < NOTICE_PAGE) return null;
  const t = await getTranslations('plaza');
  return (
    <nav className="nt-pg" aria-label={t('ntc.pager')} data-notice-pager={np}>
      {np > 1 && <Link href={href(path, nq, np - 1)} data-notice-newer>{t('ntc.newer')}</Link>}
      {count >= NOTICE_PAGE && <Link href={href(path, nq, np + 1)} data-notice-older>{t('ntc.older')}</Link>}
    </nav>
  );
}

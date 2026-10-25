import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiGetPersonal, ApiFailure } from '@/lib/api';
import { BackBar } from '@/components/common/BackBar';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('plaza'))('cases.title') };
}

interface Case { no: number; type: string; typeLabel: string; title: string; body: string; region: string | null; date: string; views: number; mine: boolean }

/** v10.31 (w2) — 피해 사례 한 건(GET /safety/cases/{no} · 조회 수 +1). 작성자는 내보내지 않습니다. */
export default async function Page({ params }: { params: Promise<{ no: string }> }) {
  const { no } = await params;
  if (!/^\d{1,12}$/.test(no)) notFound();
  const c = await apiGetPersonal<Case>(`/safety/cases/${no}`).catch((e) => {
    if (e instanceof ApiFailure && (e.status === 404 || e.status === 400)) return null;
    throw e;
  });
  if (!c) notFound();
  const t = await getTranslations('plaza.cases');
  const m = await getTranslations('money');
  return (
    <><div className="gw" data-gw="MNY">
      <div className="gw-wrap" style={{ paddingTop: 16 }}><BackBar href="/money/verified#cases" label={t('board')} wrap={false} /></div>
      <div className="gw-wrap" style={{ paddingTop: 14, paddingBottom: 20 }}>
        <div className="gw-panel gw-axdt" data-case={c.no} style={{ overflow: 'hidden' }}>
          <div className="gw-axdh">
            <div className="gw-axdhl"><span className="gw-axb gw-axhot">{c.typeLabel}</span><span className="gw-dtcat">{t('title')}</span></div>
            <h1 className="gw-dtt">{c.title}</h1>
            <div className="gw-dtmeta"><span className="gw-dtno">{t('no', { no: String(c.no) })}</span><span>{c.region ?? m('unknownRegion')}</span><span>{c.date}</span><span>{t('views', { n: c.views.toLocaleString('ko-KR') })}</span>{c.mine && <span>{t('mine')}</span>}</div>
          </div>
          <div className="gw-dsec"><p className="gw-body" style={{ whiteSpace: 'pre-wrap' }}>{c.body}</p></div>
          <div className="gw-dsec" style={{ marginBottom: 16 }}>
            <div className="gw-axwarn">{t('warn')}</div>
          </div>
          <div className="gw-abar">
            <Link className="gw-bo" href="/safety/guide">{t('guide')}</Link>
            <Link className="gw-bo gw-rp" href={`/support/new?type=REPORT&ref=safety-case-${c.no}`}>{t('reportPost')}</Link>
            <span className="gw-sp" />
            <Link className="gw-go" href="/support/new"><span>{t('report')}</span><small>{t('reportSub')}</small></Link>
          </div>
        </div>
      </div>
    </div><i hidden data-root-end="" /></>
  );
}

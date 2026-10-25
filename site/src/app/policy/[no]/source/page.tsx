import type { Metadata } from 'next';
import { Fragment } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiGet, ApiFailure } from '@/lib/api';
import { BackBar } from '@/components/common/BackBar';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('policy'))('meta.source') };
}

type Props = { params: Promise<{ no: string }> };

interface Source {
  no: number; title: string; org: string | null; sourceTitle: string; sourceOrg: string | null; scale: string | null; limit: string | null;
  due: string | null; dDay: number | null; url: string | null; rows: [string, string][]; sample: boolean;
}

/**
 * SB-BIZ-POL-030 지원사업 공고 원문 — 시안 scBpolSrc 배치 그대로.
 *
 * v10.31 (w2 · 10/10 「시안 기준」) — 서버 자료(GET /biz/policies/{no}/source · 소개창업 「정보」 축의 정책 원문)로 그립니다.
 *   공고 개요(공고명 · 주관 기관 · 지원 규모 · 접수 마감) · 지원 내용 표 · 신청 방법 · 원문 주소(https 만 · 새 창 · noopener).
 *   큰 단추는 시안대로 「정책 상세로」(/policy/{no}). 운영이 올린 공고가 없으면 404.
 *   시연용 자료(개발 시드)는 「시연용」을 붙입니다.
 */
export default async function PolicySourcePage({ params }: Props) {
  const { no } = await params;
  if (!/^\d{1,12}$/.test(no)) notFound();
  const it = await apiGet<Source>(`/biz/policies/${no}/source`, 60).catch((e) => {
    if (e instanceof ApiFailure && e.status === 404) return null;
    throw e;
  });
  if (!it) notFound();
  const t = await getTranslations('policy');
  return (
    <><div className="gw" data-gw="BIZ">
      <div className="gw-gwl gw-biz">
      <div className="gw-wrap" style={{ paddingTop: 16 }}><BackBar href={`/policy/${it.no}`} label={t('source.back')} wrap={false} /></div>
      <div className="gw-wrap" style={{ paddingTop: 14, paddingBottom: 20 }}>
        <div className="gw-panel gw-axdt" data-bpolsrc={it.no} style={{ overflow: 'hidden' }}>
          <div className="gw-axdh">
            <div className="gw-axdhl">
              <span className="gw-axb">{t('source.axis')}</span>
              <span className="gw-dtcat">{t('source.cat')}</span>
              {it.sample && <span className="gw-bg gw-wait">{t('source.sample')}</span>}
            </div>
            <h1 className="gw-dtt">{it.sourceTitle}</h1>
            <div className="gw-dtsub">{it.sourceOrg ?? ''}{it.due ? ` · ~${it.due}` : ''}</div>
            <div className="gw-dtmeta"><span className="gw-dtno">{t('source.no', { no: String(it.no) })}</span></div>
          </div>
          {it.sample && (
            <div className="gw-axsample">{t.rich('source.sampleNote', { b: (c) => <b>{c}</b> })}</div>
          )}
          <div className="gw-dsec"><h4>{t('source.overview')}</h4>
            <dl className="gw-spec">
              <dt>{t('source.name')}</dt><dd>{it.sourceTitle}</dd>
              <dt>{t('source.org')}</dt><dd>{it.sourceOrg ?? '—'}</dd>
              <dt>{t('source.scale')}</dt><dd>{it.scale ?? it.limit ?? '—'}</dd>
              <dt>{t('source.due')}</dt><dd>{it.due ? `${it.due}${it.dDay != null && it.dDay >= 0 ? ` (D-${it.dDay})` : ''}` : t('source.always')}</dd>
            </dl>
          </div>
          <div className="gw-dsec"><h4>{t('source.content')}</h4>
            {it.rows.length > 0
              ? <dl className="gw-spec">{it.rows.map(([k, v], i) => <Fragment key={`${i}-${k}`}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
              : <p>{t('source.noRows')}</p>}
          </div>
          <div className="gw-dsec">
            <h4>{t('source.how')}</h4>
            <p>{t.rich('source.howBody', { b: (c) => <b>{c}</b> })}</p>
            <div className="gw-axnote2">{t('source.url')} {it.url
              ? <a className="gw-code" href={it.url} target="_blank" rel="noopener noreferrer">{it.url}</a>
              : <span className="gw-code">{t('source.noUrl')}</span>}{t('source.newWin')}</div>
          </div>
          <div className="gw-dsec" style={{ marginBottom: 16 }}>
            <div className="gw-axinv">{t.rich('source.outside', { b: (c) => <b>{c}</b> })}</div>
          </div>
          <div className="gw-abar">
            <Link className="gw-bo" href="/request/new">{t('source.register')}</Link>
            <span className="gw-sp" />
            <Link className="gw-go" href={`/policy/${it.no}`}><span>{t('source.toPolicy')}</span><small>{t('source.toPolicySub')}</small></Link>
          </div>
        </div>
      </div>
      </div>
    </div><i hidden data-root-end="" /></>
  );
}

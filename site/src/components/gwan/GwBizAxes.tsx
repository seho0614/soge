/**
 * v10.31 (w2 · 10/10 「시안 기준」) — 소개창업 축 「인력 · 운영지원 · 정보」의 본문 · 상세 · 정책 원문(시안 axBodyJob · axBodyCsl · axBodyInfo · axDetail · scBpolSrc).
 *   v10.30 까지는 서버에 이 자료가 없어 「창업」 축 하나만 그렸습니다. 이제 GET /biz/axis/{JOB|SVC|POL|EDU} · /biz/quick · /biz/policies/{no}/source 로 그립니다.
 *   · 인력 — 도급으로만 잇고 개인은 노출하지 않습니다(A-09 회신 · 직업안정법 · 파견법). 화면에 「채용 · 고용 · 구직자」라는 말을 쓰지 않습니다.
 *   · 정보 — 소개비 구조 밖(거래 없음 · INV-9 대상 아님).
 *   · 시연용 자료(is_sample)는 「시연용」 표시를 붙입니다(scripts/seed-w2-demo.sql — 개발 DB 에만).
 * 사람마다 다른 칸(내 요청 · 내 항목)이 있어 조회는 apiGetPersonal(캐시 없음)입니다.
 */
import { Fragment } from 'react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { useTranslations } from 'next-intl';
import { apiGetPersonal } from '@/lib/api';
import type { AxisItem, QuickRow } from '@/components/market/types';
import { AxisRequestButton, QuickMatchForm, QuickOfferButton, ReceivedRequests } from './GwBizClient';

export const AXKIND = {
  JOB: { path: '/biz/job/', up: '/biz?axis=jobs', ax: '인력', pre: 'J', lab: '공고번호', h: '공고 내용', cat: '소개창업 · 인력 · 공고' },
  SVC: { path: '/biz/advisory/', up: '/biz?axis=advisory', ax: '운영지원', pre: 'S', lab: '서비스번호', h: '서비스 내용', cat: '소개창업 · 운영지원 · 자문 서비스' },
  POL: { path: '/policy/', up: '/biz?axis=info', ax: '정보', pre: 'P', lab: '정책번호', h: '지원 내용', cat: '소개창업 · 정보 · 정책 소개' },
  EDU: { path: '/biz/edu/', up: '/biz?axis=info&d=edu', ax: '정보', pre: 'E', lab: '과정번호', h: '과정 내용', cat: '소개창업 · 정보 · 창업 교육' },
} as const;
/* v10.97 — AXKIND 의 한국어(ax · lab · h · cat)는 AxisPage 가 그대로 쓰고, 이 파일 화면은 사전 gwan.axkind.* · gwan.biz.* 로 그립니다 */

function Sample({ on }: { on: boolean }) {
  const t = useTranslations('gwan.biz');
  return on ? <span className="gw-bg gw-wait" title={t('sampleTitle')}>{t('sample')}</span> : null;
}
const AxBadge = ({ it }: { it: AxisItem }) => <span className={`gw-axb${it.hot ? ' gw-axhot' : ''}`}>{it.badge}</span>;

/** 줄 하나 — 제목과 단추 모두 그 항목의 상세로(시안 axRow) */
function AxRow({ it, badge, ls, right, btn }: { it: AxisItem; badge: React.ReactNode; ls: React.ReactNode; right: string | null; btn: string }) {
  const href = `${AXKIND[it.kind].path}${it.no}`;
  return (
    <div className="gw-axrow" data-axno={it.no}>
      <div className="gw-axl">{badge}<Sample on={it.sample} />
        <b><Link className="gw-axtt" href={href}>{it.title}</Link></b>
        <span className="gw-ls">{ls}</span></div>
      <div className="gw-axr"><b>{right ?? ''}</b><Link className="gw-bo gw-sm" href={href}>{btn}</Link></div>
    </div>
  );
}

function B2BNote() {
  const t = useTranslations('gwan.biz');
  return <div className="gw-axwarn">{t.rich('b2b', { b: (c) => <b>{c}</b> })}</div>;
}
const B2B = <B2BNote />;

/** 인력 축 — 공고 · 지원 · 빠른 매칭(시안 axBodyJob) */
export async function AxisJob({ d, hot }: { d?: string; hot?: boolean }) {
  const t = await getTranslations('gwan.biz');
  const dir = d === 'applied' ? '지원' : d === 'quick' ? '빠른 매칭' : '공고';
  /* 갈래 값(공고 · 지원 · 빠른 매칭)은 화면 안 구분값 그대로, 보이는 이름만 사전 */
  const DIRK = { '공고': 'dir.post', '지원': 'dir.applied', '빠른 매칭': 'dir.quick' } as const;
  const PATH = { '공고': '/biz?axis=jobs', '지원': '/biz?axis=jobs&d=applied', '빠른 매칭': '/biz?axis=jobs&d=quick' } as const;
  const [list, quick] = await Promise.all([
    dir === '빠른 매칭' ? Promise.resolve(null)
      : apiGetPersonal<{ items: AxisItem[] }>(`/biz/axis/JOB?limit=30${dir === '지원' ? '&mine=1' : hot ? '&hot=1' : ''}`).catch(() => ({ items: [] as AxisItem[] })),
    dir === '빠른 매칭' ? apiGetPersonal<QuickRow[]>('/biz/quick').catch(() => [] as QuickRow[]) : Promise.resolve(null),
  ]);
  const WHEN: Record<string, string> = { TODAY: t('when.TODAY'), TOMORROW: t('when.TOMORROW'), WEEK: t('when.WEEK') };
  return (
    <>
      <div className="gw-axurg"><b>{t('hotTitle')}</b>
        <span>{hot && dir === '공고' ? t('hotOnly') : t('urgDefault')}</span>
        <Link className="gw-bo gw-sm" href={hot && dir === '공고' ? '/biz?axis=jobs' : '/biz?axis=jobs&hot=1'}>{hot && dir === '공고' ? t('viewAll') : t('goSee')}</Link></div>
      <div className="gw-panel">
        <div className="gw-axdir" role="tablist" aria-label={t('dirAria')}>
          {(['공고', '지원', '빠른 매칭'] as const).map((x) => (
            <Link key={x} role="tab" aria-selected={dir === x} className={`gw-axd${dir === x ? ' gw-on' : ''}`} href={PATH[x]}>{t(DIRK[x])}</Link>
          ))}
        </div>
        {B2B}
        {dir === '빠른 매칭' ? (
          <>
            <div className="gw-axwarn gw-ok">{t.rich('quickWarn', { b: (c) => <b>{c}</b> })}</div>
            <QuickMatchForm />
            <div className="gw-axrows">
              {(quick ?? []).map((r) => (
                <div key={r.id} className="gw-axrow" data-quick={r.id}>
                  <div className="gw-axl"><span className={`gw-axb${r.when === 'TODAY' ? ' gw-axhot' : ''}`}>{WHEN[r.when]}</span>
                    <b>{r.task} {t('headcount', { n: String(r.headcount) })}</b>
                    <span className="gw-ls">{r.region} · {t('offers', { n: String(r.offers) })}{r.mine ? t('mineSuffix') : ''}</span></div>
                  <div className="gw-axr"><QuickOfferButton id={r.id} offered={r.offered} mine={r.mine} /></div>
                </div>
              ))}
              {(quick ?? []).length === 0 && <div className="gw-axempty">{t.rich('quickEmpty', { b: (c) => <b>{c}</b> })}</div>}
            </div>
            <div className="gw-axwarn">{t.rich('payWarn', { b: (c) => <b>{c}</b> })}<br />
              {t.rich('noExpose', { b: (c) => <b>{c}</b> })}</div>
          </>
        ) : dir === '지원' && !(list?.items.length) ? (
          <div className="gw-axempty">{t.rich('appliedEmpty', { b: (c) => <b>{c}</b> })}<br />
            <Link className="gw-bo gw-sm" href="/biz?axis=jobs">{t('goJobs')}</Link></div>
        ) : (
          <div className="gw-axrows">
            {(list?.items ?? []).map((x) => dir === '지원'
              ? <AxRow key={x.id} it={x} badge={<span className="gw-axb gw-axok">{t('received')}</span>} ls={<>{x.cond} · {t('appliedLs', { state: x.myRequest?.status === 'ANSWERED' ? t('answered') : t('waiting') })}</>} right={x.price} btn={t('appliedBtn')} />
              : <AxRow key={x.id} it={x} badge={<AxBadge it={x} />} ls={<>{x.cond} · {t('fee')}</>} right={x.price} btn={t('viewPost')} />)}
            {(list?.items ?? []).length === 0 && <div className="gw-axempty">{t.rich('jobsEmpty', { b: (c) => <b>{c}</b> })}</div>}
          </div>
        )}
      </div>
    </>
  );
}

/** 운영지원 축 — 창업 컨설팅 · 회사운영 자문(시안 axBodyCsl) */
export async function AxisSvc() {
  const t = await getTranslations('gwan.biz');
  const list = await apiGetPersonal<{ items: AxisItem[] }>('/biz/axis/SVC?limit=30').catch(() => ({ items: [] as AxisItem[] }));
  return (
    <div className="gw-panel">
      <div className="gw-sh2" style={{ padding: '0 0 12px' }}><b>{t('svcTitle')}</b>
        <span className="gw-ls">{t('svcLead')}</span></div>
      <div className="gw-axrows">
        {list.items.map((x) => <AxRow key={x.id} it={x} badge={<AxBadge it={x} />} ls={<>{x.cond}{x.requestCount ? t('reqCount', { n: String(x.requestCount) }) : ''}</>} right={x.price} btn={t('detail')} />)}
        {list.items.length === 0 && <div className="gw-axempty">{t.rich('svcEmpty', { b: (c) => <b>{c}</b> })}</div>}
      </div>
      <div className="gw-axnote2">{t.rich('svcNote', { b: (c) => <b>{c}</b> })}</div>
    </div>
  );
}

/** 정보 축 — 정책 소개 · 창업 교육(시안 axBodyInfo) */
export async function AxisInfo({ d }: { d?: string }) {
  const t = await getTranslations('gwan.biz');
  const edu = d === 'edu';
  const list = await apiGetPersonal<{ items: AxisItem[] }>(`/biz/axis/${edu ? 'EDU' : 'POL'}?limit=30`).catch(() => ({ items: [] as AxisItem[] }));
  return (
    <div className="gw-panel">
      <div className="gw-axdir" role="tablist" aria-label={t('infoAria')}>
        <Link role="tab" aria-selected={!edu} className={`gw-axd${!edu ? ' gw-on' : ''}`} href="/biz?axis=info">{t('policy')}</Link>
        <Link role="tab" aria-selected={edu} className={`gw-axd${edu ? ' gw-on' : ''}`} href="/biz?axis=info&d=edu">{t('edu')}</Link>
      </div>
      <div className="gw-axinv">{t.rich('infoInv', { b: (c) => <b>{c}</b> })}</div>
      <div className="gw-axrows">
        {list.items.map((x) => edu
          ? <AxRow key={x.id} it={x} badge={<AxBadge it={x} />} ls={<>{x.period} · {x.price}</>} right={x.headcount ? t('capacity', { n: String(x.headcount) }) : x.cond} btn={t('detail')} />
          : <AxRow key={x.id} it={x} badge={<AxBadge it={x} />} ls={<>{x.org} · {x.due ? `~${x.due}` : t('always')}</>} right={x.price} btn={t('viewPost')} />)}
        {list.items.length === 0 && <div className="gw-axempty"><b>{edu ? t('eduEmpty') : t('polEmpty')}</b>{t('infoEmptyTail')}</div>}
      </div>
      {!edu && (
        <div className="gw-axcta"><b>{t('planTitle')}</b>
          <span>{t('planBody')}</span>
          <Link className="gw-bp gw-sm" href="/request/new">{t('planBtn')}</Link></div>
      )}
    </div>
  );
}

/** 상세 한 틀 — 공고(SB-BIZ-JOB-020) · 자문 서비스(SB-BIZ-SVC-020) · 정책(SB-BIZ-POL-020) · 교육(SB-BIZ-EDU-020) */
export function AxisDetail({ it }: { it: AxisItem }) {
  const KD = AXKIND[it.kind];
  const t = useTranslations('gwan');
  let notes: React.ReactNode = null; let bar: React.ReactNode = null;
  if (it.kind === 'JOB') {
    notes = <>{B2B}<div className="gw-axwarn">{t.rich('biz.payWarn', { b: (c) => <b>{c}</b> })}</div></>;
    bar = it.mine ? null : <AxisRequestButton no={it.no} kind="JOB" done={!!it.myRequest} />;
  } else if (it.kind === 'SVC') {
    notes = <div className="gw-axnote2">{t.rich('biz.svcNote', { b: (c) => <b>{c}</b> })}</div>;
    bar = it.mine ? null : <AxisRequestButton no={it.no} kind="SVC" done={!!it.myRequest} />;
  } else {
    notes = <div className="gw-axinv">{t.rich('biz.detailInv', { b: (c) => <b>{c}</b> })}</div>;
    bar = it.kind === 'POL'
      ? <Link className="gw-go" href={`/policy/${it.no}/source`}><span>{t('biz.source')}</span><small>{t('biz.sourceSub')}</small></Link>
      : <span className="gw-go gw-done" title={t('biz.enrollTitle')}><span>{t('biz.enroll')}</span><small>{t('biz.enrollSub')}</small></span>;
  }
  return (
    <div className="gw-panel gw-axdt" data-kind={it.kind} data-no={it.no} style={{ overflow: 'hidden' }}>
      <div className="gw-axdh">
        <div className="gw-axdhl"><AxBadge it={it} /><span className="gw-dtcat">{t(`axkind.${it.kind}.cat`)}</span> <Sample on={it.sample} /></div>
        <h2 className="gw-dtt">{it.title}</h2>
        {it.price && <div className="gw-dtprice">{it.price}</div>}
        {it.sub && <div className="gw-dtsub">{it.sub}</div>}
        <div className="gw-dtmeta"><span className="gw-dtno">{t(`axkind.${it.kind}.lab`)} {KD.pre}-{it.no}</span>
          {it.due && <span>{t('biz.due', { due: it.due })}{it.dDay != null ? ` (D-${it.dDay})` : ''}</span>}<span>{t('biz.postedBy', { name: it.postedBy })}</span></div>
      </div>
      {it.sample && <div className="gw-axsample">{t.rich('biz.sampleNotice', { what: it.kind === 'POL' ? t('biz.samplePol') : it.kind === 'EDU' ? t('biz.sampleEdu') : t('biz.sampleOther'), b: (c) => <b>{c}</b> })}</div>}
      <div className="gw-dsec"><h4>{t(`axkind.${it.kind}.h`)}</h4>
        {it.description && <p>{it.description}</p>}
        {it.spec && it.spec.length > 0 && <dl className="gw-spec">{it.spec.map(([k, v], i) => <Fragment key={`${i}-${k}`}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>}
      </div>
      <div className="gw-dsec" style={{ marginBottom: 16 }}>{notes}</div>
      {it.mine && (it.kind === 'JOB' || it.kind === 'SVC') && (
        <div className="gw-dsec"><h4>{t('biz.receivedHead')}</h4><ReceivedRequests no={it.no} /></div>
      )}
      <div className="gw-abar">
        {it.kind === 'POL' && <Link className="gw-bo" href="/request/new">{t('biz.planBtn')}</Link>}
        <span className="gw-sp" />
        {bar}
      </div>
    </div>
  );
}

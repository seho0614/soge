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
import { apiGetPersonal } from '@/lib/api';
import type { AxisItem, QuickRow } from '@/components/market/types';
import { AxisRequestButton, QuickMatchForm, QuickOfferButton, ReceivedRequests } from './GwBizClient';

export const AXKIND = {
  JOB: { path: '/biz/job/', up: '/biz?axis=jobs', ax: '인력', pre: 'J', lab: '공고번호', h: '공고 내용', cat: '소개창업 · 인력 · 공고' },
  SVC: { path: '/biz/advisory/', up: '/biz?axis=advisory', ax: '운영지원', pre: 'S', lab: '서비스번호', h: '서비스 내용', cat: '소개창업 · 운영지원 · 자문 서비스' },
  POL: { path: '/policy/', up: '/biz?axis=info', ax: '정보', pre: 'P', lab: '정책번호', h: '지원 내용', cat: '소개창업 · 정보 · 정책 소개' },
  EDU: { path: '/biz/edu/', up: '/biz?axis=info&d=edu', ax: '정보', pre: 'E', lab: '과정번호', h: '과정 내용', cat: '소개창업 · 정보 · 창업 교육' },
} as const;
const AXFEE = '채용 기업이 성사 수수료를 냅니다 (INV-9 · 당사자 직접 수수)';

const Sample = ({ on }: { on: boolean }) => (on ? <span className="gw-bg gw-wait" title="개발 · 시연용 자료(scripts/seed-w2-demo.sql)">시연용</span> : null);
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

const B2B = (
  <div className="gw-axwarn"><b>사람이 아니라 일을 잇습니다.</b> 구직자 개인을 노출하지 않고, 일을 맡아 하는 회원(인력대행 · 헤드헌팅 · 개인)을 소개합니다.
    소개자는 양쪽을 잇고 빠집니다 — <b>고용 과정에 개입하지 않습니다.</b></div>
);

/** 인력 축 — 공고 · 지원 · 빠른 매칭(시안 axBodyJob) */
export async function AxisJob({ d, hot }: { d?: string; hot?: boolean }) {
  const dir = d === 'applied' ? '지원' : d === 'quick' ? '빠른 매칭' : '공고';
  const PATH = { '공고': '/biz?axis=jobs', '지원': '/biz?axis=jobs&d=applied', '빠른 매칭': '/biz?axis=jobs&d=quick' } as const;
  const [list, quick] = await Promise.all([
    dir === '빠른 매칭' ? Promise.resolve(null)
      : apiGetPersonal<{ items: AxisItem[] }>(`/biz/axis/JOB?limit=30${dir === '지원' ? '&mine=1' : hot ? '&hot=1' : ''}`).catch(() => ({ items: [] as AxisItem[] })),
    dir === '빠른 매칭' ? apiGetPersonal<QuickRow[]>('/biz/quick').catch(() => [] as QuickRow[]) : Promise.resolve(null),
  ]);
  const WHEN: Record<string, string> = { TODAY: '오늘', TOMORROW: '내일', WEEK: '이번 주' };
  return (
    <>
      <div className="gw-axurg"><b>🔥 초단기 급구</b>
        <span>{hot && dir === '공고' ? '초단기 공고만 보고 있습니다' : '이 축에서 마감이 임박한 건만 모읍니다'}</span>
        <Link className="gw-bo gw-sm" href={hot && dir === '공고' ? '/biz?axis=jobs' : '/biz?axis=jobs&hot=1'}>{hot && dir === '공고' ? '전체 보기' : '보러 가기 ›'}</Link></div>
      <div className="gw-panel">
        <div className="gw-axdir" role="tablist" aria-label="인력 방향">
          {(['공고', '지원', '빠른 매칭'] as const).map((x) => (
            <Link key={x} role="tab" aria-selected={dir === x} className={`gw-axd${dir === x ? ' gw-on' : ''}`} href={PATH[x]}>{x}</Link>
          ))}
        </div>
        {B2B}
        {dir === '빠른 매칭' ? (
          <>
            <div className="gw-axwarn gw-ok"><b>도급으로만 잇습니다.</b> 일할 사람을 뽑아 드리는 것이 아니라, <b>일감을 맡을 업체</b>를 이어 드립니다.
              소개뱅크는 고용 과정에 관여하지 않고, 근로 조건과 임금은 <b>업체가 정합니다.</b></div>
            <QuickMatchForm />
            <div className="gw-axrows">
              {(quick ?? []).map((r) => (
                <div key={r.id} className="gw-axrow" data-quick={r.id}>
                  <div className="gw-axl"><span className={`gw-axb${r.when === 'TODAY' ? ' gw-axhot' : ''}`}>{WHEN[r.when]}</span>
                    <b>{r.task} {r.headcount}명</b>
                    <span className="gw-ls">{r.region} · 회신 {r.offers}곳{r.mine ? ' · 내 요청' : ''}</span></div>
                  <div className="gw-axr"><QuickOfferButton id={r.id} offered={r.offered} mine={r.mine} /></div>
                </div>
              ))}
              {(quick ?? []).length === 0 && <div className="gw-axempty"><b>열린 빠른 매칭 요청이 없습니다.</b>위 양식으로 올리면 본인인증 회원(인력대행업체 · 개인)이 회신합니다.</div>}
            </div>
            <div className="gw-axwarn"><b>대금은 당사자끼리 주고받습니다.</b> 소개뱅크 계좌로 보내지 마십시오 — 저희는 수탁하지 않습니다(INV-9 · INV-11).<br />
              <b>구직자 개인은 노출하지 않습니다.</b> 회신한 회원이 일을 맡아(도급) 처리합니다.</div>
          </>
        ) : dir === '지원' && !(list?.items.length) ? (
          <div className="gw-axempty"><b>아직 소개 요청한 공고가 없습니다.</b>「공고」에서 공고를 열어 「업체 소개 요청」을 누르면 여기에 쌓입니다.<br />
            <Link className="gw-bo gw-sm" href="/biz?axis=jobs">공고 보러 가기</Link></div>
        ) : (
          <div className="gw-axrows">
            {(list?.items ?? []).map((x) => dir === '지원'
              ? <AxRow key={x.id} it={x} badge={<span className="gw-axb gw-axok">접수됨</span>} ls={<>{x.cond} · 소개 요청 접수 — {x.myRequest?.status === 'ANSWERED' ? '업체가 회신했습니다' : '업체 회신을 기다리는 중입니다'}</>} right={x.price} btn="지원 내역" />
              : <AxRow key={x.id} it={x} badge={<AxBadge it={x} />} ls={<>{x.cond} · {AXFEE}</>} right={x.price} btn="공고 보기" />)}
            {(list?.items ?? []).length === 0 && <div className="gw-axempty"><b>지금 열린 공고가 없습니다.</b>회원(인력대행 · 헤드헌팅 등)이 공고를 올리면 여기에 나옵니다.</div>}
          </div>
        )}
      </div>
    </>
  );
}

/** 운영지원 축 — 창업 컨설팅 · 회사운영 자문(시안 axBodyCsl) */
export async function AxisSvc() {
  const list = await apiGetPersonal<{ items: AxisItem[] }>('/biz/axis/SVC?limit=30').catch(() => ({ items: [] as AxisItem[] }));
  return (
    <div className="gw-panel">
      <div className="gw-sh2" style={{ padding: '0 0 12px' }}><b>🧭 창업 컨설팅 · 회사운영 자문</b>
        <span className="gw-ls">견적 요청 → 매칭 → 계약. 소개장터의 용역 흐름을 그대로 씁니다</span></div>
      <div className="gw-axrows">
        {list.items.map((x) => <AxRow key={x.id} it={x} badge={<AxBadge it={x} />} ls={<>{x.cond}{x.requestCount ? ` · 요청 ${x.requestCount}건` : ''}</>} right={x.price} btn="상세 보기" />)}
        {list.items.length === 0 && <div className="gw-axempty"><b>등록된 자문 서비스가 없습니다.</b>회원(컨설턴트 · 세무 · 노무 · 마케팅 등)이 올리면 여기에 나옵니다.</div>}
      </div>
      <div className="gw-axnote2">컨설턴트는 <b>소개자이기도 합니다</b> — 창업 성사 건을 직접 이으면 소개비도 함께 받습니다.</div>
    </div>
  );
}

/** 정보 축 — 정책 소개 · 창업 교육(시안 axBodyInfo) */
export async function AxisInfo({ d }: { d?: string }) {
  const edu = d === 'edu';
  const list = await apiGetPersonal<{ items: AxisItem[] }>(`/biz/axis/${edu ? 'EDU' : 'POL'}?limit=30`).catch(() => ({ items: [] as AxisItem[] }));
  return (
    <div className="gw-panel">
      <div className="gw-axdir" role="tablist" aria-label="정보 종류">
        <Link role="tab" aria-selected={!edu} className={`gw-axd${!edu ? ' gw-on' : ''}`} href="/biz?axis=info">정책 소개</Link>
        <Link role="tab" aria-selected={edu} className={`gw-axd${edu ? ' gw-on' : ''}`} href="/biz?axis=info&d=edu">창업 교육</Link>
      </div>
      <div className="gw-axinv"><b>이 축은 소개비 구조 밖입니다.</b> 거래가 없으므로 INV-9(소개비 직접 수수) 적용 대상이 아니고, 카드에 소개비 · 방향(팝니다/삽니다) 칸이 없습니다.</div>
      <div className="gw-axrows">
        {list.items.map((x) => edu
          ? <AxRow key={x.id} it={x} badge={<AxBadge it={x} />} ls={<>{x.period} · {x.price}</>} right={x.headcount ? `정원 ${x.headcount}명` : x.cond} btn="상세 보기" />
          : <AxRow key={x.id} it={x} badge={<AxBadge it={x} />} ls={<>{x.org} · {x.due ? `~${x.due}` : '상시'}</>} right={x.price} btn="공고 보기" />)}
        {list.items.length === 0 && <div className="gw-axempty"><b>{edu ? '모집 중인 교육 과정이 없습니다.' : '소개 중인 정책 공고가 없습니다.'}</b>운영이 주관 기관 · 제휴 기관의 원문을 받아 올립니다.</div>}
      </div>
      {!edu && (
        <div className="gw-axcta"><b>내 창업계획 등록하기</b>
          <span>정책을 보다가 바로 &quot;이런 걸 찾습니다&quot;를 남깁니다 — 소개받기(BUY) 요청이 만들어집니다</span>
          <Link className="gw-bp gw-sm" href="/request/new">창업계획 등록</Link></div>
      )}
    </div>
  );
}

/** 상세 한 틀 — 공고(SB-BIZ-JOB-020) · 자문 서비스(SB-BIZ-SVC-020) · 정책(SB-BIZ-POL-020) · 교육(SB-BIZ-EDU-020) */
export function AxisDetail({ it }: { it: AxisItem }) {
  const KD = AXKIND[it.kind];
  let notes: React.ReactNode = null; let bar: React.ReactNode = null;
  if (it.kind === 'JOB') {
    notes = <>{B2B}<div className="gw-axwarn"><b>대금은 당사자끼리 주고받습니다.</b> 소개뱅크 계좌로 보내지 마십시오 — 저희는 수탁하지 않습니다(INV-9 · INV-11).</div></>;
    bar = it.mine ? null : <AxisRequestButton no={it.no} kind="JOB" done={!!it.myRequest} />;
  } else if (it.kind === 'SVC') {
    notes = <div className="gw-axnote2">컨설턴트는 <b>소개자이기도 합니다</b> — 창업 성사 건을 직접 이으면 소개비도 함께 받습니다.</div>;
    bar = it.mine ? null : <AxisRequestButton no={it.no} kind="SVC" done={!!it.myRequest} />;
  } else {
    notes = <div className="gw-axinv"><b>이 축은 소개비 구조 밖입니다.</b> 거래가 없으므로 INV-9(소개비 직접 수수) 적용 대상이 아닙니다 — 열람과 신청만 합니다.</div>;
    bar = it.kind === 'POL'
      ? <Link className="gw-go" href={`/policy/${it.no}/source`}><span>원문 공고 보기</span><small>공고 원문 · 주관 기관 누리집 주소</small></Link>
      : <span className="gw-go gw-done" title="제휴 기관 연동 전입니다"><span>수강 신청</span><small>제휴 기관에서 접수합니다(연동 전)</small></span>;
  }
  return (
    <div className="gw-panel gw-axdt" data-kind={it.kind} data-no={it.no} style={{ overflow: 'hidden' }}>
      <div className="gw-axdh">
        <div className="gw-axdhl"><AxBadge it={it} /><span className="gw-dtcat">{KD.cat}</span> <Sample on={it.sample} /></div>
        <h2 className="gw-dtt">{it.title}</h2>
        {it.price && <div className="gw-dtprice">{it.price}</div>}
        {it.sub && <div className="gw-dtsub">{it.sub}</div>}
        <div className="gw-dtmeta"><span className="gw-dtno">{KD.lab} {KD.pre}-{it.no}</span>
          {it.due && <span>마감 {it.due}{it.dDay != null ? ` (D-${it.dDay})` : ''}</span>}<span>올린 곳 {it.postedBy}</span></div>
      </div>
      {it.sample && <div className="gw-axsample"><b>시연용 자료입니다 — 실제 {it.kind === 'POL' ? '공고' : it.kind === 'EDU' ? '모집 과정' : '공고 · 서비스'}가 아닙니다.</b> 개발 화면 확인용으로 넣었습니다(운영 DB 에는 없음).</div>}
      <div className="gw-dsec"><h4>{KD.h}</h4>
        {it.description && <p>{it.description}</p>}
        {it.spec && it.spec.length > 0 && <dl className="gw-spec">{it.spec.map(([k, v], i) => <Fragment key={`${i}-${k}`}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>}
      </div>
      <div className="gw-dsec" style={{ marginBottom: 16 }}>{notes}</div>
      {it.mine && (it.kind === 'JOB' || it.kind === 'SVC') && (
        <div className="gw-dsec"><h4>받은 요청</h4><ReceivedRequests no={it.no} /></div>
      )}
      <div className="gw-abar">
        {it.kind === 'POL' && <Link className="gw-bo" href="/request/new">창업계획 등록</Link>}
        <span className="gw-sp" />
        {bar}
      </div>
    </div>
  );
}

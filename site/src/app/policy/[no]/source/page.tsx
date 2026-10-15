import type { Metadata } from 'next';
import { Fragment } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiGet, ApiFailure } from '@/lib/api';
import { BackBar } from '@/components/common/BackBar';

export const metadata: Metadata = { title: '공고 원문' };

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
  return (
    <><div className="gw" data-gw="BIZ">
      <div className="gw-gwl gw-biz">
      <div className="gw-wrap" style={{ paddingTop: 16 }}><BackBar href={`/policy/${it.no}`} label="정책 상세" wrap={false} /></div>
      <div className="gw-wrap" style={{ paddingTop: 14, paddingBottom: 20 }}>
        <div className="gw-panel gw-axdt" data-bpolsrc={it.no} style={{ overflow: 'hidden' }}>
          <div className="gw-axdh">
            <div className="gw-axdhl">
              <span className="gw-axb">정책</span>
              <span className="gw-dtcat">공고 원문</span>
              {it.sample && <span className="gw-bg gw-wait">시연용</span>}
            </div>
            <h1 className="gw-dtt">{it.sourceTitle}</h1>
            <div className="gw-dtsub">{it.sourceOrg ?? ''}{it.due ? ` · ~${it.due}` : ''}</div>
            <div className="gw-dtmeta"><span className="gw-dtno">정책번호 P-{it.no}</span></div>
          </div>
          {it.sample && (
            <div className="gw-axsample"><b>시연용 견본 — 실제 공고가 아닙니다.</b> 실제 서비스는 주관 기관이 낸 공고 원문(글 · 붙임 파일)과 원문 주소를 그대로 보여 줍니다.</div>
          )}
          <div className="gw-dsec"><h4>공고 개요</h4>
            <dl className="gw-spec">
              <dt>공고명</dt><dd>{it.sourceTitle}</dd>
              <dt>주관 기관</dt><dd>{it.sourceOrg ?? '—'}</dd>
              <dt>지원 규모</dt><dd>{it.scale ?? it.limit ?? '—'}</dd>
              <dt>접수 마감</dt><dd>{it.due ? `${it.due}${it.dDay != null && it.dDay >= 0 ? ` (D-${it.dDay})` : ''}` : '상시'}</dd>
            </dl>
          </div>
          <div className="gw-dsec"><h4>지원 내용</h4>
            {it.rows.length > 0
              ? <dl className="gw-spec">{it.rows.map(([k, v], i) => <Fragment key={`${i}-${k}`}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
              : <p>지원 내용 표가 아직 없습니다. 원문 주소에서 확인하십시오.</p>}
          </div>
          <div className="gw-dsec">
            <h4>신청 방법</h4>
            <p>접수는 <b>주관 기관 누리집</b>에서 합니다. 소개뱅크는 접수 · 선정에 관여하지 않습니다.</p>
            <div className="gw-axnote2">원문 주소 {it.url
              ? <a className="gw-code" href={it.url} target="_blank" rel="noopener noreferrer">{it.url}</a>
              : <span className="gw-code">주관 기관이 원문 주소를 아직 알리지 않았습니다</span>} — 새 창으로 엽니다(보던 화면 유지).</div>
          </div>
          <div className="gw-dsec" style={{ marginBottom: 16 }}>
            <div className="gw-axinv"><b>이 축은 소개비 구조 밖입니다.</b> 열람과 신청 안내만 합니다.</div>
          </div>
          <div className="gw-abar">
            <Link className="gw-bo" href="/request/new">창업계획 등록</Link>
            <span className="gw-sp" />
            <Link className="gw-go" href={`/policy/${it.no}`}><span>정책 상세로</span><small>지원 한도 · 신청 기한</small></Link>
          </div>
        </div>
      </div>
      </div>
    </div><i hidden data-root-end="" /></>
  );
}

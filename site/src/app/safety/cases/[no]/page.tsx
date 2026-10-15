import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiGetPersonal, ApiFailure } from '@/lib/api';
import { BackBar } from '@/components/common/BackBar';

export const metadata: Metadata = { title: '피해 사례' };

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
  return (
    <><div className="gw" data-gw="MNY">
      <div className="gw-wrap" style={{ paddingTop: 16 }}><BackBar href="/money/verified#cases" label="피해 사례 게시판" wrap={false} /></div>
      <div className="gw-wrap" style={{ paddingTop: 14, paddingBottom: 20 }}>
        <div className="gw-panel gw-axdt" data-case={c.no} style={{ overflow: 'hidden' }}>
          <div className="gw-axdh">
            <div className="gw-axdhl"><span className="gw-axb gw-axhot">{c.typeLabel}</span><span className="gw-dtcat">피해 사례</span></div>
            <h1 className="gw-dtt">{c.title}</h1>
            <div className="gw-dtmeta"><span className="gw-dtno">번호 {c.no}</span><span>{c.region ?? '지역 미상'}</span><span>{c.date}</span><span>조회 {c.views.toLocaleString('ko-KR')}</span>{c.mine && <span>내가 쓴 글</span>}</div>
          </div>
          <div className="gw-dsec"><p className="gw-body" style={{ whiteSpace: 'pre-wrap' }}>{c.body}</p></div>
          <div className="gw-dsec" style={{ marginBottom: 16 }}>
            <div className="gw-axwarn">이 글은 회원이 쓴 경험담입니다 — 소개뱅크가 사실을 확인한 것이 아닙니다. 연락처 · 이메일 · 계좌번호는 가려서 저장되었습니다.</div>
          </div>
          <div className="gw-abar">
            <Link className="gw-bo" href="/safety/guide">사기 예방 가이드</Link>
            <Link className="gw-bo gw-rp" href={`/support/new?type=REPORT&ref=safety-case-${c.no}`}>이 글 신고</Link>
            <span className="gw-sp" />
            <Link className="gw-go" href="/support/new"><span>사고 신고하기</span><small>피해가 있으면 바로 접수하십시오</small></Link>
          </div>
        </div>
      </div>
    </div><i hidden data-root-end="" /></>
  );
}

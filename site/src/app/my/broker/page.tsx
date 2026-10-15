import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import Link from 'next/link';
import { BrokerApply } from '@/components/BrokerApply';
import { BackBar } from '@/components/common/BackBar';

export const metadata: Metadata = { title: '중개사 인증' };

interface B {
  applied: boolean; assumed: boolean;
  licenseNo?: string; state?: string; lookupResult?: string; rejectReason?: string | null;
}

/**
 * SB-BIZ-BRK-010 중개사 인증 신청
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────
 * 부동산은 **중개사만 소개할 수 있습니다**(공인중개사법 9조).
 * 인증 없이 올리면 무등록 중개가 되고, 플랫폼이 그 자리를
 * 제공한 것이 됩니다.
 *
 * 등록 자체를 DB 트리거가 막으므로(INV-BR1), 이 화면을 거치지
 * 않으면 부동산 매물을 올릴 수 없습니다.
 *
 * v10.29 — 시안 scBrkApp 배치(돌아가기 · 제목 · 법 조항 경고 · 입력 · 단추 줄 · 안내)로 그립니다.
 *   입력 항목(개설등록번호 · 사무소 상호 · 대표자명)과 API(POST /partner/broker)는 그대로 — 시안의 시연용 예시 번호 · 제출 서류 체크는 넣지 않았습니다(diffs 창업-5).
 * v10.31 (w2 · 10/10 「시안 기준」) — 제출 서류 체크 4종 · 서류 파일 · 보증(공제) 칸을 더했습니다(PUT /me/broker/extra · D055). 시연용 예시 번호 칩은 넣지 않습니다(실제 사무소 번호를 띄우지 않음).
 */
export default async function BrokerPage() {
  const p = await me();
  if (!p) redirect('/login');

  const b = await apiGet<B>('/partner/broker', 0).catch(() => null);
  /* 반려 · 만료된 건은 다시 신청하는 자리입니다 — 상태 화면으로 돌려보내면
   * "다시 신청하기" 가 제자리를 맴돕니다. */
  const retry = b?.state === 'REJECTED' || b?.state === 'EXPIRED';
  if (b?.applied && !retry) redirect('/my/broker/status');

  return (
    <><div className="gw">
      <div className="gw-wrap gw-aiw">
        <BackBar href="/my" label="나의공간" wrap={false} />
        <div className="gw-pgh"><div><h1>중개사 인증 신청</h1><p>부동산을 소개하시려면 <b>개설등록번호 확인</b>이 필요합니다(공인중개사법 9조).</p></div></div>

        <div className="gw-nt gw-warn">
          <b>공인중개사법 제18조의2 ③</b> — 개업공인중개사가 아닌 자는 중개대상물을 표시 · 광고할 수 없습니다. 그래서 부동산 매물은 인증을 마친 사업자만 공개할 수 있습니다.
        </div>

        {retry ? (
          <div className="gw-nt gw-warn">
            <b>{b?.state === 'EXPIRED' ? '인증 기한이 지났습니다.' : '이전 신청이 반려되었습니다.'}</b>
            {b?.rejectReason ? <> 사유: {b.rejectReason}</> : null} 고쳐서 다시 신청해 주십시오.
          </div>
        ) : null}

        {b?.assumed ? (
          <div className="gw-nt gw-warn">
            <b>지금은 국토부 연동 전이라 대조를 건너뜁니다.</b> 입력하신 번호가 실제와 맞는지 확인하지 않습니다 — 연동 후 다시 확인하며, 맞지 않으면 인증이 취소됩니다.
          </div>
        ) : null}

        {/* v10.38 (D096 · P2P) — 공인중개사 인증은 개인(본인인증)도 신청합니다. 인증 대상은 개설등록번호입니다 */}
        {!p.identityVerifiedAt && !p.businessVerifiedAt ? (
          <div className="gw-nt gw-warn"><b>본인인증이 먼저 필요합니다.</b> <Link href="/verify">인증하러 가기 →</Link></div>
        ) : (
          <div className="gw-brkform gw-brkwrap"><BrokerApply assumed={!!b?.assumed} /></div>
        )}

        <div className="gw-dact" style={{ marginTop: 12 }}>
          <Link className="gw-bo" href="/my/broker/status">내 인증 상태</Link>
          <Link className="gw-bo" href="/mal/brokers">공인중개사 매물 연동</Link>
        </div>

        <div className="gw-nt gw-info"><b>대조가 맞아도 자동 승인은 없습니다.</b> 명의 도용은 번호 대조로 거를 수 없어 운영이 한 번 더 봅니다.</div>
        <div className="gw-nt gw-info"><b>180일마다 다시 확인합니다.</b> 폐업하셨는데 인증이 남아 있으면 안 되기 때문입니다.</div>
      </div>
    </div><i hidden data-root-end="" /></>
  );
}

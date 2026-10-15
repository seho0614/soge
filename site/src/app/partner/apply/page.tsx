import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet, apiGetPersonal } from '@/lib/api';
import { ApplyForm } from '@/components/ApplyForm';
import { AxisApply } from '@/components/AxisApply';
import { Bg, Note, Pgh, Tw, bizNo } from '@/components/partner/ui';

export const metadata: Metadata = { title: '입점 신청' };

/** v10.32 — 시안 「STEP 01 · 사업자 확인」 표의 값(GET /me/account — 본인 것만) */
interface Acc {
  account: { email: string; name: string; phone: string | null; identityVerifiedAt: string | null };
  business: { bizRegNo: string; companyName: string | null; ceoName: string | null; bizType: string | null; bizItem: string | null; verifiedAt: string | null; ntsStatus: string | null } | null;
}
const maskPhone = (v: string | null) => (v ? v.replace(/^(\d{3})-?(\d{3,4})-?(\d{4})$/, '$1-****-$3') : null);
const maskEmail = (e: string) => e.replace(/^(.{3})[^@]*/, '$1****');

interface Dash { applied: boolean; status?: string; company?: string; note?: string; rejectReason?: string | null }

/**
 * SB-PTC-CTR-100 입점 신청 — v10.29 시안 scPtnApply 배치(.nsteps 3단계 → .fset 「입점할 축」 → 단추 줄)
 *
 * ── 3단계입니다 ─────────────────────────────────────────────────────
 *   1. 본인 · 사업자 확인  본인인증이면 개인으로, 사업자 인증이면 사업자로 신청합니다(v10.38 · P2P — 사업자 인증은 선택)
 *   2. 입점 신청     업종과 지역을 정합니다
 *   3. 운영 승인     사람이 봅니다 — 자동 승인은 두지 않았습니다
 *
 * 대조가 맞아도 **명의 도용은 거를 수 없어서** 마지막은 사람이 봅니다.
 * v10.32 — 시안의 「STEP 01 값 · 확인」 표는 이 계정의 실제 값 · 상태로 넣었습니다(개발 현황 칩 대신). 「본사 승인 화면 보기」(BO) 단추 · 워크스루는 시연 전용이라 그대로 둡니다.
 */
export default async function ApplyPage() {
  const p = await me();
  if (!p) redirect('/login');

  const [d, acc] = await Promise.all([
    apiGet<Dash>('/partner/dashboard', 0).catch(() => null),
    apiGetPersonal<Acc>('/me/account').catch(() => null),
  ]);
  /* v10.38 (D096 · P2P) — 계정 기준. 본인인증 개인은 사업자 정보 없이 「개인 활동 정보」로 신청합니다 */
  const actorOk = !!(p.identityVerifiedAt || p.businessVerifiedAt);
  const asBiz = !!p.businessVerifiedAt;
  /* 반려된 신청은 고쳐서 다시 낼 수 있습니다 — 사유를 먼저 보여 드립니다. */
  const rejected = d?.status === 'REJECTED';
  const applied = !!d?.applied && !rejected;
  const active = d?.status === 'ACTIVE';
  const cls = (done: boolean, now: boolean) => (done ? 'done' : now ? 'on' : undefined);

  return (
    <><Pgh title="입점 신청" sub="본인 · 사업자 확인 → 입점 신청 → 운영 승인. 본사 승인이 나야 서비스를 걸 수 있습니다. 리드를 열 때만 충전 잔액에서 확인비용이 빠집니다." />

      <ol className="pt-nsteps">
        <li className={cls(actorOk, !actorOk)}>
          <span className="n">1</span>
          <div>
            <b>1. 본인 · 사업자 확인</b><Bg tone={actorOk ? 'ok' : 'wait'}>{asBiz ? '사업자 인증 완료' : actorOk ? '본인인증 완료 · 개인으로 신청' : '필요'}</Bg>
            <p>본인인증을 하면 <b>개인으로</b> 바로 신청합니다. 사업자로 신청하시려면 사업자 인증(국세청 대조)을 하십시오 — 선택입니다.</p>
            {!actorOk ? <p><Link className="pt-bp sm" href="/verify">인증하러 가기</Link></p> : null}
          </div>
        </li>

        <li className={cls(applied, actorOk && !applied)}>
          <span className="n">2</span>
          <div>
            <b>2. 입점 신청</b><Bg tone={applied ? 'ok' : rejected ? 'no' : 'off'}>{applied ? '접수됨' : rejected ? '반려' : '대기'}</Bg>
            <p>받으실 업종과 지역을 정합니다. 나중에 바꾸실 수 있습니다.</p>
            {rejected ? (
              <div className="note warn" id="partner-rejected">
                <b>입점 신청이 반려되었습니다.</b>
                {d?.rejectReason ? <><br />사유: {d.rejectReason}</> : null}
                <br />사유를 고치신 뒤 다시 신청하실 수 있습니다.
              </div>
            ) : null}
            {actorOk && !applied ? <ApplyForm /> : null}
          </div>
        </li>

        <li className={cls(active, applied && !active)}>
          <span className="n">3</span>
          <div>
            <b>3. 운영 승인</b><Bg tone={active ? 'ok' : applied ? 'wait' : 'off'}>{active ? '승인' : applied ? '심사 중' : '대기'}</Bg>
            <p>
              사람이 확인합니다. <strong>자동 승인은 두지 않았습니다</strong> —
              대조가 맞아도 명의 도용은 거를 수 없기 때문입니다.
            </p>
            {applied && !active ? (
              <div className="note info">접수되었습니다. 영업일 기준 1~2일 안에 결과를 알려 드립니다.</div>
            ) : null}
          </div>
        </li>
      </ol>

      {/* 2026-10-02 — 안심소개 축별 입점 (서버 D018). 본인 · 사업자 확인 뒤에 고릅니다(v10.38 · 개인 가능). 입점 승인과 따로 축마다 심사합니다. */}
      {/* 시안 .fset 「입점할 축 — 여러 개 고를 수 있고 축마다 따로 승인합니다」 자리. 부품(AxisApply)이 제 제목 · 표를 그립니다 */}
      {actorOk ? <AxisApply /> : <Note kind="info"><b>본인인증이 먼저입니다.</b> 인증을 마치면 여기서 입점할 축을 고를 수 있습니다(사업자 인증은 선택).</Note>}

      {/* v10.32 — 시안 「STEP 01 · 사업자 확인」 표 + 알림 안내 띠. 시안의 개발 현황 칩(국세청 키 없음 · PASS 미연동) 대신 이 계정의 실제 상태를 적습니다 */}
      {acc && (
        <section className="pt-fset" data-apply-step1="">
          <h3>STEP 01 · 사업자 확인</h3>
          <Tw head={['항목', '값', '확인']}>
            <tr><td><b>사업자등록번호</b></td><td>{acc.business ? bizNo(acc.business.bizRegNo) : '—'}</td>
              <td>{acc.business?.verifiedAt ? <Bg tone="ok">국세청 대조 완료</Bg> : acc.business ? <Bg tone="wait">확인 대기</Bg> : <Bg tone="off">미등록 · 개인으로 신청(선택)</Bg>}</td></tr>
            <tr><td><b>상호</b></td><td>{acc.business?.companyName ?? '—'}</td><td>{acc.business?.companyName ? <Bg tone="ok">저장됨</Bg> : <Bg tone="off">없음</Bg>}</td></tr>
            <tr><td><b>대표자</b></td><td>{acc.business?.ceoName ?? '—'}</td><td>{acc.business?.ceoName ? <Bg tone="ok">저장됨</Bg> : <Bg tone="off">없음</Bg>}</td></tr>
            <tr><td><b>업태 · 종목</b></td><td>{[acc.business?.bizType, acc.business?.bizItem].filter(Boolean).join(' · ') || '—'}</td><td>{acc.business?.bizType || acc.business?.bizItem ? <Bg tone="ok">저장됨</Bg> : <Bg tone="off">없음</Bg>}</td></tr>
            <tr><td><b>담당자</b></td><td>{[acc.account.name, maskPhone(acc.account.phone)].filter(Boolean).join(' · ')}</td>
              <td>{acc.account.identityVerifiedAt ? <Bg tone="ok">본인인증 완료</Bg> : <Bg tone="wait">본인인증 필요</Bg>}</td></tr>
            <tr><td><b>로그인 아이디</b></td><td>{maskEmail(acc.account.email)}</td><td><Bg tone="ok">이 주소가 그대로 아이디입니다</Bg></td></tr>
          </Tw>
        </section>
      )}
      <Note kind="warn" data-apply-notify=""><b>접수하면 운영이 직접 확인합니다.</b> 반려되면 사유를 알림으로 보내 드리고, 고쳐서 다시 신청하실 수 있습니다.
        승인되면 이 화면과 파트너센터 홈의 상태가 「승인」으로 바뀝니다.</Note>

      {active ? (
        <Note kind="ok">
          <b>이미 파트너이십니다.</b> <Link href="/partner">파트너센터로 가기 →</Link>
        </Note>
      ) : null}

      <div className="pt-dact">
        <Link className="pt-bo" href="/partner/listings">내 매물 · 입점 상태</Link>
        <Link className="pt-bo" href="/partner">파트너센터 홈</Link>
      </div>
    <i hidden data-root-end="" /></>
  );
}

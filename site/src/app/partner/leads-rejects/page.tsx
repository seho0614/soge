import type { Metadata } from 'next';
import Link from 'next/link';
import { ymdKst } from '@/lib/format';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { FeeDisputeForm } from '@/components/FeeDisputeForm';
import { Bg, Empty, Note, Pgh, S2, Tw, won, type Tone } from '@/components/partner/ui';

export const metadata: Metadata = { title: '반려 · 이의신청' };

interface Fee {
  id: number; amount: string; state: string; voidRule: string | null; summary: string; incurredAt: string;
  deliveredAt?: string; disputable?: boolean; disputeState?: string | null; settleMode?: string;
}
interface Fees { rows: Fee[] }
interface Rej {
  cap: { month: string; received: number; used: number; cap: number };
  rows: Array<{ id: number; no: string; feeId: number; leadNo: string; summary: string; reasonCode: string; reason: string;
    requestedAt: string; state: string; decisionReason: string | null; decidedAt: string | null; amount: number; settleMode: string; restored: number | null }>;
  note: string;
}
const ST: Record<string, [string, Tone]> = { REQUESTED: ['본사 심사중', 'wait'], ACCEPTED: ['인정', 'ok'], DISMISSED: ['기각', 'no'] };
const RC: Record<string, string> = { FALSE_INFO: '허위 정보', UNREACHABLE: '연락 불가', DUPLICATE: '중복 접수', OUT_OF_SCOPE: '다른 지역 · 분야 요청' };

/**
 * SB-PTC-CTR-330 반려 · 이의신청 — v10.31 (W5 · 10/10 시안 기준 scPtnRej) · 주소도 시안대로 /partner/leads-rejects(옛 /partner/rejects 는 여기로)
 *   신청 내역 표(RJ 번호 · 리드 · 사유 · 신청일 · 결과) → 안내 → 반려 한도 → 반려 신청(개발에만 있던 폼 · 유지).
 *   ★ 문구 「무효」 → 시안대로 「환급」: 이용료가 선불 충전으로 바뀌어(D070) 인정되면 차감한 확인비용이 잔액으로 실제로 돌아옵니다.
 *   시안의 「본사 처리 화면 보기」(운영 화면 단추)는 파트너 화면에 두지 않습니다(권한 — 운영 화면은 별도 BO).
 */
export default async function LeadsRejectsPage() {
  const p = await me();
  if (!p) redirect('/login');
  const [f, r] = await Promise.all([
    apiGet<Fees>('/partner/fees', 0).catch(() => null),
    apiGet<Rej>('/partner/rejects', 0).catch(() => null),
  ]);
  const open = (f?.rows ?? []).filter((x) => x.disputable);
  const rows = r?.rows ?? [];

  return (
    <><Pgh title="반려 · 이의신청" sub="잘못 들어온 리드는 반려를 신청합니다. 인정되면 확인비용이 환급됩니다." />
      {rows.length === 0 ? <Empty>신청한 반려가 없습니다.</Empty> : (
        <Tw id="my-disputes" head={['신청번호', '리드', '사유', '신청일', '결과']}>
          {rows.map((d) => {
            const st = ST[d.state] ?? [d.state, 'wait' as Tone];
            return (
              <tr key={d.id}>
                <td><b className="pt-code">{d.no}</b></td>
                <td><span className="pt-code">{d.leadNo}</span><div className="pt-ls">{d.summary}</div></td>
                <td className="reason"><b>{RC[d.reasonCode] ?? d.reasonCode}</b> — {d.reason}</td>
                <td>{ymdKst(d.requestedAt)}</td>
                <td>
                  <Bg tone={st[1]}>{st[0]}</Bg>
                  {d.state === 'ACCEPTED'
                    ? <div className="pt-ls">확인비용 {won(d.restored ?? d.amount)}원 {d.settleMode === 'PREPAID' ? '환급' : '청구에서 뺌(전환 전 후불분)'}</div>
                    : d.decisionReason ? <div className="pt-ls">{d.decisionReason}</div> : null}
                </td>
              </tr>
            );
          })}
        </Tw>
      )}
      <Note kind="info"><b>반려는 접수 72시간 이내 · 한 건에 한 번 · 월 15% 한도 세 조건을 모두 만족해야 자격이 있습니다.</b> 자격은 서버(DB)가 봅니다.</Note>
      {r?.cap && (
        <div className="pt-cap" data-reject-cap>
          <div className="cb"><div className="cf" style={{ width: `${Math.min(100, Math.round((r.cap.used / Math.max(1, r.cap.cap)) * 100))}%` }} /></div>
          <div className="cl"><b>{r.cap.used} / {r.cap.cap}건</b><span className="pt-ls">{r.cap.month} · 접수 {r.cap.received}건의 15%</span></div>
        </div>
      )}
      <Note kind="warn"><b>상담 결렬은 반려 사유가 아닙니다.</b> 판정은 위험감지 규칙 근거로 본사가 합니다 — 인정되면 차감한 그대로(보너스 몫은 보너스로) 잔액에 돌아옵니다.</Note>

      <S2>반려 신청</S2>
      <div className="pt-fset">
        <FeeDisputeForm fees={open.map((x) => ({ id: x.id, summary: x.summary, amount: x.amount, deliveredAt: x.deliveredAt }))} />
      </div>
      <Note kind="plain">그 밖의 이의(금액 · 등급)는 <Link href="/support">고객센터</Link>로 문의해 주십시오.</Note>
      <div className="pt-dact">
        <Link className="pt-bo" href="/partner/leads">상담 신청으로</Link>
        <Link className="pt-bo" href="/partner/cash">리드 이용료</Link>
      </div>
    <i hidden data-root-end="" /></>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { ymdKst } from '@/lib/format';
import { Bg, Empty, Note, Pgh, S2, Tw, won, type Tone } from '@/components/partner/ui';
import { AutoForm, ChargeForm, RefundForm } from '@/components/partner/CashPanel';

export const metadata: Metadata = { title: '리드 이용료' };

interface Cash {
  mode: string; total: number; paid: number; bonus: number; bonusRate: number; grade: string; canMoney: boolean;
  auto: { on: boolean; below: number | null; amount: number | null; engine: boolean; card: { company: string | null; last4: string | null } | null; failedAt: string | null; failReason: string | null };
  month: { used: number; usedBonus: number };
  refundable: number;
  limits: { min: number; max: number; maxBalance: number };
  legacy: { pending: number; count: number };
  log: Array<{ id: number; kind: string; kindKo: string; at: string; memo: string | null; refType: string | null; refId: string | null; leadSummary: string | null; paid: number; bonus: number; total: number }>;
  charges: Array<{ id: string; amount: number; bonus: number; source: string; state: string; stub: boolean; approvedAt: string | null; refunded: number; failReason: string | null; createdAt: string }>;
  refunds: Array<{ id: string; amount: number; refunded: number; clawback: number; state: string; reason: string; createdAt: string }>;
  note: string; scope: string;
}
const CH_ST: Record<string, [string, Tone]> = { READY: ['결제 전', 'off'], DONE: ['충전됨', 'ok'], FAILED: ['실패', 'no'], UNKNOWN: ['확인 중', 'wait'] };
const RF_ST: Record<string, [string, Tone]> = { REQUESTED: ['처리 중', 'wait'], DONE: ['환불됨', 'ok'], PARTIAL: ['일부 환불', 'wait'], FAILED: ['실패 · 잔액으로 되돌림', 'no'] };
const sign = (n: number) => (n > 0 ? `+${won(n)}` : n < 0 ? `-${won(-n)}` : '0');

/**
 * SB-PTC-CTR-400 리드 이용료 — v10.31 (W5 · 10/10 시안 기준 scPtnCash) **선불 충전 잔액**
 *   금액 3칸(총 잔액 · 유상 잔액 · 등급 할인) → 안내 → 「자동 청구」 상자 → 충전 · 환불 → 「사용 내역」 표(원장).
 *   전에는 후불 청구(INV-11)였고 시안의 잔액 칸 · 자동 청구를 옮기지 않았습니다 — 10/10 지시로 시안대로 바꿨습니다(결정 기록 w5).
 *   ★ 충전금은 자사 리드 확인비용 선납으로만 씁니다(다른 곳 사용 · 양도 · 현금화 없음) — 화면 아래 안내.
 *   옛 주소 /partner/fees 는 여기로 옵니다.
 */
export default async function CashPage({ searchParams }: { searchParams: Promise<{ pay?: string }> }) {
  const p = await me();
  if (!p) redirect('/login');
  const sp = await searchParams;
  const c = await apiGet<Cash>('/partner/cash', 0).catch(() => null);
  if (!c) return <><Pgh title="리드 이용료" /><Empty>파트너가 아닙니다. <Link href="/partner/apply">입점 신청</Link>부터 해 주십시오.</Empty><i hidden data-root-end="" /></>;
  const room = Math.max(0, c.limits.maxBalance - c.paid);

  return (
    <><Pgh title="리드 이용료" sub="리드를 열 때 쓰는 잔액입니다. 잔액이 0이면 상담을 못 받습니다." />
      {sp.pay === 'fail' && <Note kind="warn"><b>결제가 끝나지 않았습니다.</b> 다시 충전해 주십시오 — 돈은 빠져나가지 않았습니다.</Note>}

      <div className="pt-esc" data-cash-sum>
        <div className="er"><span>총 잔액</span><b>{won(c.total)}원</b></div>
        <div className="er"><span>유상 잔액 <i className="pt-ls">환불 대상</i></span><b>{won(c.paid)}원</b></div>
        <div className="er"><span>등급 할인 <i className="pt-ls">보너스 · 먼저 차감</i></span><b>{won(c.bonus)}원</b></div>
      </div>
      <Note kind="info"><b>차감은 보너스를 먼저, 그다음 유상 잔액에서 합니다.</b> 반려가 인정되면 낸 그대로 잔액으로 환급됩니다. 이번 달 사용 {won(c.month.used)}원(보너스 {won(c.month.usedBonus)}원).</Note>
      {c.total <= 0 && <Note kind="warn"><b>잔액이 없어 새 상담이 배정되지 않습니다.</b> 충전하시면 바로 다시 받습니다.</Note>}

      <S2>충전</S2>
      <div className="pt-fset"><ChargeForm min={c.limits.min} max={c.limits.max} room={room} bonusRate={c.bonusRate} canMoney={c.canMoney} /></div>

      <S2>자동 청구</S2>
      <AutoForm on={c.auto.on} below={c.auto.below} amount={c.auto.amount} engine={c.auto.engine} card={c.auto.card}
                min={c.limits.min} max={c.limits.max} canMoney={c.canMoney} />
      {c.auto.failReason && <Note kind="warn"><b>최근 자동 충전 실패</b> — {c.auto.failReason}{c.auto.failedAt ? ` (${ymdKst(c.auto.failedAt)})` : ''}</Note>}
      <Note kind="warn"><b>자동 청구는 구독 결제와 같은 카드(빌링키)로 충전합니다.</b> 잔액이 정한 금액 아래로 내려가면 그 자리에서 한 번 충전하고, 실패하면 한 시간 뒤 다시 시도합니다. 입금 확인은 결제사 승인으로 합니다.</Note>

      <S2>사용 내역</S2>
      {c.log.length === 0 ? <Empty>아직 내역이 없습니다. 충전하시면 여기에 쌓입니다.</Empty> : (
        <Tw head={['일자', '내용', '금액', '비고']} numCols={[2]}>
          {c.log.map((l) => (
            <tr key={l.id}>
              <td>{ymdKst(l.at)}</td>
              <td><b>{l.kindKo}{l.leadSummary ? ` — ${l.leadSummary}` : ''}</b></td>
              <td className="num"><span className={l.total < 0 ? 'pt-no' : 'pt-ok2'}>{sign(l.total)}</span></td>
              <td>{l.bonus !== 0 && l.paid !== 0 ? `보너스 ${sign(l.bonus)} · 유상 ${sign(l.paid)}`
                : l.bonus !== 0 ? (l.total < 0 ? '보너스에서 차감' : '보너스 잔액') : l.total < 0 ? '유상 잔액에서 차감' : '유상 잔액'}
                {l.memo && l.memo !== l.kindKo && !l.memo.startsWith('리드 확인') ? <span className="pt-ls"> · {l.memo}</span> : null}</td>
            </tr>
          ))}
        </Tw>
      )}

      <S2>충전 · 환불</S2>
      <div className="pt-pact"><RefundForm refundable={c.refundable} canMoney={c.canMoney} /></div>
      {c.charges.length > 0 && (
        <Tw head={['충전일', '금액', '등급 할인', '상태', '환불']} numCols={[1, 2, 4]}>
          {c.charges.map((x) => {
            const st = CH_ST[x.state] ?? [x.state, 'off' as Tone];
            return (
              <tr key={x.id}>
                <td>{ymdKst(x.approvedAt ?? x.createdAt)}{x.source === 'AUTO' ? <span className="pt-ls"> · 자동</span> : null}</td>
                <td className="num"><b>{won(x.amount)}원</b></td>
                <td className="num">{won(x.bonus)}원</td>
                <td><Bg tone={st[1]}>{st[0]}</Bg>{x.stub ? <span className="pt-ls"> 시험 결제</span> : null}{x.failReason ? <div className="pt-ls">{x.failReason}</div> : null}</td>
                <td className="num">{x.refunded ? `${won(x.refunded)}원` : '—'}</td>
              </tr>
            );
          })}
        </Tw>
      )}
      {c.refunds.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <Tw head={['신청일', '신청 금액', '환불', '보너스 회수', '상태', '사유']} numCols={[1, 2, 3]}>
            {c.refunds.map((r) => {
              const st = RF_ST[r.state] ?? [r.state, 'off' as Tone];
              return (
                <tr key={r.id}>
                  <td>{ymdKst(r.createdAt)}</td><td className="num">{won(r.amount)}원</td><td className="num"><b>{won(r.refunded)}원</b></td>
                  <td className="num">{won(r.clawback)}원</td><td><Bg tone={st[1]}>{st[0]}</Bg></td><td>{r.reason}</td>
                </tr>
              );
            })}
          </Tw>
        </div>
      )}

      {c.legacy.count > 0 && (
        <Note kind="plain"><b>전환 전 후불 미청구분 {won(c.legacy.pending)}원({c.legacy.count}건)</b>은 종전대로 청구됩니다 — <Link href="/partner/settlement">정산</Link>에서 봅니다.</Note>
      )}
      <Note kind="warn"><b>충전금은 소개뱅크 리드 확인비용 선납으로만 씁니다.</b> 다른 가맹점 · 다른 회원에게 쓰거나 넘기거나 현금으로 바꿀 수 없고, 유상 잔액은 결제 취소로 환불합니다(등급 할인분은 환불 대상이 아닙니다). 한 번에 {won(c.limits.max)}원, 유상 잔액은 {won(c.limits.maxBalance)}원까지 둘 수 있습니다.</Note>
      <div className="pt-dact">
        <Link className="pt-bo" href="/partner/leads">상담 신청</Link>
        <Link className="pt-bo" href="/partner/leads-rejects">반려 · 이의신청</Link>
        <Link className="pt-bo" href="/partner/settlement">정산</Link>
      </div>
    <i hidden data-root-end="" /></>
  );
}

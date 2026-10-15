import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { dtKst } from '@/lib/format';
import { DealConfirm } from '@/components/DealConfirm';
import { DealShell } from '@/components/deal/DealShell';
import { loadDeal } from '@/components/deal/load';
import '@/styles/proto-w1.css';

export const metadata: Metadata = { title: '성사 확정' };

/**
 * SB-HOM-DEL-030 성사 확정 — v10.31 시안 scDealConfirm: 3단계 띠 · 거래 정보 표 · 확인 n/2 목록 · 7일 자동 안내 · 정산 신청으로 / 이전 — 결제.
 *   확정 경로는 둘입니다 (2026-10-01 결정 Q3) — ① 양측이 여기서 각각 「거래 성사 확인」 ② 계약서 양측 서명(A-15). 버튼(DealConfirm)은 그대로.
 */
export default async function ConfirmPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await me())) redirect('/login');
  const r = await loadDeal(id);
  if ('error' in r) return <div className="w1 w1-wrap"><div className="w1-empty">{r.error}</div></div>;
  const d = r.d;
  const conf = (p: string) => d.confirmations.find((c) => c.party === p);
  const parties: Array<[string, string, string]> = [['BUYER', '소개받는자', d.buyer], ['SELLER', '제휴사', d.seller]];
  const done = parties.filter(([p]) => conf(p)).length;
  const all = ['CONFIRMED', 'SETTLED'].includes(d.status) || done === 2;
  const mine = d.myRole !== 'INTRODUCER' && !conf(d.myRole) && !all;
  return (
    <DealShell d={d} step={2} title="성사 확정" sub="소개받는자와 제휴사가 각각 확인해야 성사입니다 (INV-4). 한쪽만 눌러서는 넘어가지 않습니다.">
      <div className="w1-cfm">
        <div className="cn"><b>확인 {all ? 2 : done} / 2</b><span className={`w1-bg ${all ? 'ok' : 'wait'}`}>{all ? '성사 확정' : '대기 중'}</span></div>
        {parties.map(([p, role, name]) => {
          const c = conf(p);
          return (
            <div key={p} className="cw">
              <div><b>{role} · {name}</b>{d.myRole === p ? ' (나)' : ''}
                <div className="w1-ls">{c ? `${dtKst(c.confirmedAt)}${c.isAuto ? ' · 자동 확정' : ''}` : all ? '계약서 서명으로 확정' : '아직 확인하지 않았습니다'}</div></div>
              {c || all ? <span className="w1-bg ok">확인 완료</span> : <span className="w1-bg wait">대기</span>}
            </div>
          );
        })}
      </div>
      <div className="w1-nt warn" style={{ marginTop: 10 }}><b>7일 동안 응답이 없으면 자동으로 확정됩니다.</b> 확인 철회는 상대가 확인하기 전까지만 됩니다.</div>
      {all
        ? <div className="w1-nt ok" style={{ marginTop: 8 }}><b>양측 확인이 끝났습니다 — 정산을 신청할 수 있습니다 (INV-3).</b>{d.confirmedAt ? ` 확정 ${dtKst(d.confirmedAt)}` : ''}</div>
        : <div className="w1-nt" style={{ marginTop: 8 }}><b>아직 정산을 신청할 수 없습니다.</b> 양측 확인이 끝나야 열립니다 — 지금은 {done}/2 진행 중입니다.</div>}
      {/* 거래 당사자에게는 늘 둡니다 — 확인한 뒤(mine 이 거짓)에도 같은 자리에 남아 결과 글이 지워지지 않음(단추만 빠짐) */}
      {d.myRole !== 'INTRODUCER' && <DealConfirm dealId={d.id} done={!mine} />}
      <div className="w1-dact">
        {all ? <Link className="w1-bp" href="/my/settlement">정산 신청으로</Link>
          : <button className="w1-bp" disabled title="양측 확인이 모두 끝나야 정산을 신청할 수 있습니다(INV-4).">정산 신청으로</button>}
        <Link className="w1-bo" href={`/deal/${d.id}/payment`}>이전 — 결제</Link>
        {all && d.myRole !== 'INTRODUCER' && <Link className="w1-bo" href={`/deal/${d.id}/review`}>후기 쓰기</Link>}
      </div>
    </DealShell>
  );
}

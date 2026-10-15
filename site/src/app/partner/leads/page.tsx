import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { ViewLeadButton, ContactButton } from './ViewLeadButton';
import { LeadMemo } from './LeadMemo';
import { dtKst, ymdKst } from '@/lib/format';
import { Bg, Empty, Note, Pgh, S2, Tabs, Tw, won } from '@/components/partner/ui';

export const metadata: Metadata = { title: '상담 신청' };

interface Lead {
  deliveryId: string; leadId: string; summary: string;
  sido: string | null; sigungu: string | null;
  urgent: boolean; deliveredAt: string; viewedAt: string | null;
  fee: string | null; contact: string | null;
  state?: 'DELIVERED' | 'VIEWED' | 'EXPIRED' | 'REVOKED';
  expiresAt?: string | null; categoryName?: string | null; hasContact?: boolean; note?: string | null;
  /* v10.31 (W5) */
  grade?: string | null; gradeLabel?: string | null; alimState?: string; feeQuote?: string | number | null;
  memo?: string | null; memoCount?: number; disputeState?: string | null; disputeId?: number | null;
}
interface Stats { rates: Array<{ grade: string; rate: string | number; label?: string; alimBand?: string | null }> }
interface Rejects { cap: { month: string; received: number; used: number; cap: number }; note: string }
interface Pricing { myFee: number | null; formType: string | null }

type Tab = 'all' | 'new' | 'done' | 'rej' | 'exp';
const isRej = (l: Lead) => !!l.disputeState && l.disputeState === 'REQUESTED';
const isNew = (l: Lead) => !l.viewedAt && l.state !== 'EXPIRED' && l.state !== 'REVOKED';
const isDone = (l: Lead) => !!l.viewedAt && !isRej(l);
const isExp = (l: Lead) => !l.viewedAt && (l.state === 'EXPIRED' || l.state === 'REVOKED');
const ALIM: Record<string, string> = { NONE: '미발송', SENT: '발송', CONFIRMED: '확정', NO_RESPONSE: '미응답', FAILED: '발송실패', CANCELED: '취소' };
const BAND: Record<string, string> = { CONFIRMED: '확정', NO_RESPONSE: '미응답', FAILED: '발송실패' };
const gcls = (label?: string | null) => (label ? `g${label.replace(/[+\-]/, '')}` : 'miss');

/**
 * SB-PTC-CTR-300 상담 신청 — v10.31 (W5 · 10/10 시안 기준 scPtnLead)
 *   탭(전체 · 확인 전 · 확인 완료 · 반려 신청 + 개발에만 있던 「기한 지남」) → 상담 줄(등급 배지 · 알림톡 · 상태 · 확인비용 · 메모) →
 *   「등급 · 확인비용」 표(등급 · 비율 · 확인비용 · 붙는 조건) → 「반려 한도」 막대(이번 달 받은 리드의 15%) → 반려 · 이의신청 단추.
 *   등급은 알림톡 결과가 정합니다 — 연동 전에는 「미판정」(기준 단가 그대로)으로 보입니다(지어내지 않음).
 *   열람 전에는 요약만 보입니다(시안의 「이**」 가린 이름도 열람 전에는 내지 않음 — 개인정보 보호 유지).
 */
export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const p = await me();
  if (!p) redirect('/login');
  const sp = await searchParams;
  const tab: Tab = (['all', 'new', 'done', 'rej', 'exp'] as const).includes(sp.tab as Tab) ? (sp.tab as Tab) : 'all';

  const [leads, stats, rej, pricing] = await Promise.all([
    apiGet<Lead[]>('/partner/leads', 0).catch(() => [] as Lead[]),
    apiGet<Stats>('/partner/stats', 0).catch(() => null),
    apiGet<Rejects>('/partner/rejects', 0).catch(() => null),
    apiGet<Pricing[]>('/partner/pricing', 0).catch(() => [] as Pricing[]),
  ]);
  const unread = leads.filter(isNew).length;
  const rows = leads.filter((l) => tab === 'all' || (tab === 'new' ? isNew(l) : tab === 'done' ? isDone(l) : tab === 'rej' ? isRej(l) : isExp(l)));
  const href = (t: Tab) => (t === 'all' ? '/partner/leads' : `/partner/leads?tab=${t}`);
  /* 등급표의 「최고 확인비용」 — 내 업종 중 가장 높은 S 단가(시안 grade.top) */
  const top = pricing.reduce((m, r) => Math.max(m, Number(r.myFee ?? 0)), 0);
  const cap = rej?.cap;

  return (
    <><Pgh title="상담 신청" sub="리드를 열면 확인비용이 리드 이용료에서 빠집니다. 등급이 곧 금액입니다." />

      <Tabs cur={tab} items={[
        { key: 'all', label: '전체', count: leads.length, href: href('all') },
        { key: 'new', label: '확인 전', count: unread, href: href('new') },
        { key: 'done', label: '확인 완료', count: leads.filter(isDone).length, href: href('done') },
        { key: 'rej', label: '반려 신청', count: leads.filter(isRej).length, href: href('rej') },
        { key: 'exp', label: '기한 지남', count: leads.filter(isExp).length, href: href('exp') },
      ]} />

      {leads.length === 0 ? (
        <Empty>
          아직 받은 상담 신청이 없습니다. 상담 업종의 승인된 서비스 · 활동 지역 · 리드 이용료 잔액이 있어야 배정됩니다
          (보험 · 카드 · 금융 · 통신 · 의료는 자격 심사 통과가 먼저입니다).
        </Empty>
      ) : rows.length === 0 ? (
        <Empty>이 상태의 상담이 없습니다.</Empty>
      ) : rows.map((l) => {
        const done = !!l.viewedAt;
        const exp = isExp(l);
        const rj = isRej(l);
        const label = l.gradeLabel ?? null;
        return (
          <article key={l.deliveryId} data-lead-row={l.deliveryId} data-delivery={l.deliveryId}
                   className={`pt-lrow${exp ? ' read' : ''} req${done || exp ? ' done' : ''}`}>
            <div className="lt">
              <div className="lh">
                <span className={`pt-gbadge ${gcls(label)}`} title={label ? `${label} 등급` : '알림톡 결과가 없어 등급 전'}>{label ?? '미판정'}</span>
                <span className="pt-ck">알림톡 {ALIM[l.alimState ?? 'NONE'] ?? l.alimState}</span>
                {l.urgent ? <Bg tone="no">급구</Bg> : null}
                <Bg tone={rj ? 'wait' : done ? 'ok' : exp ? 'off' : 'wait'}>{rj ? '반려 신청' : done ? '확인 완료' : exp ? '기한 지남' : '확인 전'}</Bg>
              </div>
              <b>{l.summary}</b>
              <span className="pt-ls">
                L-{l.leadId.replace(/-/g, '').slice(0, 6).toUpperCase()} · {l.categoryName ? `${l.categoryName} · ` : ''}
                {[l.sido, l.sigungu].filter(Boolean).join(' ')} · 접수 {ymdKst(l.deliveredAt)}
                {!l.viewedAt && l.state === 'DELIVERED' && l.expiresAt ? ` · ${dtKst(l.expiresAt)}까지 열람` : ''}
              </span>
              {exp ? <span className="pt-ls">{l.note ?? '열람 기한이 지나 다른 업체로 넘어갔습니다.'} 확인비용은 없습니다.</span> : null}
              {done ? <LeadMemo deliveryId={l.deliveryId} last={l.memo ?? null} count={l.memoCount ?? 0} /> : null}
            </div>
            <div className="pt-lstat">
              <span>확인비용 <b>{l.fee ? `${won(l.fee)}원` : l.feeQuote != null ? `${won(l.feeQuote)}원` : '—'}</b>{!l.fee && !done && !exp ? <span className="pt-ls"> 열 때</span> : null}</span>
            </div>
            <div className="pt-lact">
              {rj ? (
                <button className="pt-bo sm off" disabled title="본사가 반려 신청을 심사하는 중입니다. 결과가 나오면 열립니다.">본사 심사중</button>
              ) : done ? (
                l.hasContact === false
                  ? <span className="pt-ls">연락처가 따로 저장되지 않은 옛 형식 리드입니다.</span>
                  : <ContactButton deliveryId={l.deliveryId} />
              ) : exp ? (
                <button className="pt-bo sm off" disabled title="기한이 지나 열 수 없습니다.">기한 지남</button>
              ) : (
                <ViewLeadButton deliveryId={l.deliveryId} fee={l.feeQuote ?? null} />
              )}
            </div>
          </article>
        );
      })}

      <S2>등급 · 확인비용</S2>
      <Note kind="info">
        <b>파트너는 확인비용을 등급마다 입력하지 않습니다.</b> 최고 확인비용 하나만 정하면 8등급 비율을 곱해 전 등급이 채워집니다.
        어느 등급이 붙느냐는 알림톡 수신 결과가 정합니다.{top ? <> 최고 확인비용 <b>{won(top)}원</b> 기준입니다(내 업종 중 가장 높은 S 단가 — <Link href="/partner/pricing">단가 · 소개비</Link>).</> : null}
      </Note>
      {stats?.rates?.length ? (
        <Tw head={['등급', '비율', '확인비용', '붙는 조건(알림톡)']} numCols={[1, 2]}>
          {stats.rates.map((r) => (
            <tr key={r.grade}>
              <td><span className={`pt-gbadge ${gcls(r.label ?? r.grade)}`}>{r.label ?? r.grade}</span></td>
              <td className="num">{Math.round(Number(r.rate) * 100)}%</td>
              <td className="num"><b>{top ? `${won(Math.round(top * Number(r.rate)))}원` : '—'}</b></td>
              <td>{r.alimBand ? BAND[r.alimBand] ?? r.alimBand : '—'}</td>
            </tr>
          ))}
        </Tw>
      ) : <Empty>등급 비율을 불러오지 못했습니다.</Empty>}
      <Note kind="warn">
        <b>알림톡 · SMS 연동이 아직 없습니다.</b> 그래서 지금 들어오는 리드는 등급이 붙지 않은 「미판정」이며, 확인비용은 기준 단가 그대로입니다 —
        연동되면 수신 결과대로 등급이 붙습니다(운영이 확인한 결과를 넣을 수도 있습니다).
      </Note>

      <S2>반려 한도</S2>
      {cap ? (
        <div className="pt-cap" data-reject-cap>
          <div className="cb"><div className="cf" style={{ width: `${Math.min(100, Math.round((cap.used / Math.max(1, cap.cap)) * 100))}%` }} /></div>
          <div className="cl"><b>{cap.used} / {cap.cap}건</b><span className="pt-ls">{cap.month} · 접수 {cap.received}건의 15%</span></div>
        </div>
      ) : <Empty>반려 한도를 불러오지 못했습니다.</Empty>}
      <Note kind="info"><b>반려는 접수 72시간 이내 · 한 건에 한 번 · 월 접수량의 15%까지입니다.</b> 한도가 없으면 확인비용을 내지 않고 리드만 소진하는 경로가 열립니다. 상담 결렬은 반려 사유가 아닙니다.</Note>
      <div className="pt-pact"><Link className="pt-bo" href="/partner/leads-rejects">반려 · 이의신청 내역</Link></div>
    <i hidden data-root-end="" /></>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { ymdKst } from '@/lib/format';
import { Bg, Empty, Note, Pgh, S2, Tw, won, type Tone } from '@/components/partner/ui';
import { AutoForm, ChargeForm, RefundForm } from '@/components/partner/CashPanel';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('partnerOps.cash'))('title') };
}

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
/* 충전 · 환불 상태 글자는 사전 partnerOps.cash.chSt.<코드> · rfSt.<코드> (v10.100 · 2-5a) */
const CH_ST: Record<string, Tone> = { READY: 'off', DONE: 'ok', FAILED: 'no', UNKNOWN: 'wait' };
const RF_ST: Record<string, Tone> = { REQUESTED: 'wait', DONE: 'ok', PARTIAL: 'wait', FAILED: 'no' };
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
  const t = await getTranslations('partnerOps.cash');
  const code = (g: 'chSt' | 'rfSt', s: string) => (t.has(`${g}.${s}` as never) ? t(`${g}.${s}` as never) : s);
  const c = await apiGet<Cash>('/partner/cash', 0).catch(() => null);
  if (!c) return <><Pgh title={t('title')} /><Empty>{t.rich('notPartner', { a: (x) => <Link href="/partner/apply">{x}</Link> })}</Empty><i hidden data-root-end="" /></>;
  const room = Math.max(0, c.limits.maxBalance - c.paid);

  return (
    <><Pgh title={t('title')} sub={t('sub')} />
      {sp.pay === 'fail' && <Note kind="warn">{t.rich('payFail', { b: (x) => <b>{x}</b> })}</Note>}

      <div className="pt-esc" data-cash-sum>
        <div className="er"><span>{t('total')}</span><b>{won(c.total)}원</b></div>
        <div className="er"><span>{t('paid')} <i className="pt-ls">{t('paidSub')}</i></span><b>{won(c.paid)}원</b></div>
        <div className="er"><span>{t('bonus')} <i className="pt-ls">{t('bonusSub')}</i></span><b>{won(c.bonus)}원</b></div>
      </div>
      <Note kind="info">{t.rich('orderNote', { used: `${won(c.month.used)}원`, bonus: `${won(c.month.usedBonus)}원`, b: (x) => <b>{x}</b> })}</Note>
      {c.total <= 0 && <Note kind="warn">{t.rich('zeroNote', { b: (x) => <b>{x}</b> })}</Note>}

      <S2>{t('chargeH')}</S2>
      <div className="pt-fset"><ChargeForm min={c.limits.min} max={c.limits.max} room={room} bonusRate={c.bonusRate} canMoney={c.canMoney} /></div>

      <S2>{t('autoH')}</S2>
      <AutoForm on={c.auto.on} below={c.auto.below} amount={c.auto.amount} engine={c.auto.engine} card={c.auto.card}
                min={c.limits.min} max={c.limits.max} canMoney={c.canMoney} />
      {c.auto.failReason && <Note kind="warn"><b>{t('autoFail')}</b> — {c.auto.failReason}{c.auto.failedAt ? ` (${ymdKst(c.auto.failedAt)})` : ''}</Note>}
      <Note kind="warn">{t.rich('autoNote', { b: (x) => <b>{x}</b> })}</Note>

      <S2>{t('logH')}</S2>
      {c.log.length === 0 ? <Empty>{t('logEmpty')}</Empty> : (
        <Tw head={[t('lth.date'), t('lth.desc'), t('lth.amount'), t('lth.note')]} numCols={[2]}>
          {c.log.map((l) => (
            <tr key={l.id}>
              <td>{ymdKst(l.at)}</td>
              <td><b>{l.kindKo}{l.leadSummary ? ` — ${l.leadSummary}` : ''}</b></td>
              <td className="num"><span className={l.total < 0 ? 'pt-no' : 'pt-ok2'}>{sign(l.total)}</span></td>
              <td>{l.bonus !== 0 && l.paid !== 0 ? t('split', { b: sign(l.bonus), p: sign(l.paid) })
                : l.bonus !== 0 ? (l.total < 0 ? t('fromBonus') : t('bonusBal')) : l.total < 0 ? t('fromPaid') : t('paid')}
                {l.memo && l.memo !== l.kindKo && !l.memo.startsWith('리드 확인') ? <span className="pt-ls"> · {l.memo}</span> : null}</td>
            </tr>
          ))}
        </Tw>
      )}

      <S2>{t('crH')}</S2>
      <div className="pt-pact"><RefundForm refundable={c.refundable} canMoney={c.canMoney} /></div>
      {c.charges.length > 0 && (
        <Tw head={[t('cth.date'), t('lth.amount'), t('bonus'), t('cth.state'), t('cth.refund')]} numCols={[1, 2, 4]}>
          {c.charges.map((x) => {
            const st: [string, Tone] = [code('chSt', x.state), CH_ST[x.state] ?? 'off'];
            return (
              <tr key={x.id}>
                <td>{ymdKst(x.approvedAt ?? x.createdAt)}{x.source === 'AUTO' ? <span className="pt-ls"> · {t('auto')}</span> : null}</td>
                <td className="num"><b>{won(x.amount)}원</b></td>
                <td className="num">{won(x.bonus)}원</td>
                <td><Bg tone={st[1]}>{st[0]}</Bg>{x.stub ? <span className="pt-ls"> {t('stub')}</span> : null}{x.failReason ? <div className="pt-ls">{x.failReason}</div> : null}</td>
                <td className="num">{x.refunded ? `${won(x.refunded)}원` : '—'}</td>
              </tr>
            );
          })}
        </Tw>
      )}
      {c.refunds.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <Tw head={[t('rth.date'), t('rth.amount'), t('cth.refund'), t('rth.clawback'), t('cth.state'), t('rth.reason')]} numCols={[1, 2, 3]}>
            {c.refunds.map((r) => {
              const st: [string, Tone] = [code('rfSt', r.state), RF_ST[r.state] ?? 'off'];
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
        <Note kind="plain">{t.rich('legacyNote', { amt: `${won(c.legacy.pending)}원`, n: String(c.legacy.count), b: (x) => <b>{x}</b>, a: (x) => <Link href="/partner/settlement">{x}</Link> })}</Note>
      )}
      <Note kind="warn">{t.rich('useNote', { max: `${won(c.limits.max)}원`, maxBal: `${won(c.limits.maxBalance)}원`, b: (x) => <b>{x}</b> })}</Note>
      <div className="pt-dact">
        <Link className="pt-bo" href="/partner/leads">{t('lnLeads')}</Link>
        <Link className="pt-bo" href="/partner/leads-rejects">{t('lnRej')}</Link>
        <Link className="pt-bo" href="/partner/settlement">{t('lnSettle')}</Link>
      </div>
    <i hidden data-root-end="" /></>
  );
}

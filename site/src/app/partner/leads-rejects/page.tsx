import type { Metadata } from 'next';
import Link from 'next/link';
import { ymdKst } from '@/lib/format';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { FeeDisputeForm } from '@/components/FeeDisputeForm';
import { Bg, Empty, Note, Pgh, S2, Tw, won, type Tone } from '@/components/partner/ui';
import { getTranslations } from 'next-intl/server';
import { Msgs } from '@/i18n/Msgs';   // v10.101 — 아래 부품이 쓰는 사전 묶음(deal · docs/159)

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('partnerOps.rejects'))('title') };
}

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
/* 상태 글자 · 반려 사유 글자는 사전 partnerOps.rejects.st.<코드> · rc.<코드> (v10.100 · 2-5a) */
const ST: Record<string, Tone> = { REQUESTED: 'wait', ACCEPTED: 'ok', DISMISSED: 'no' };

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
  const t = await getTranslations('partnerOps.rejects');
  const tl = await getTranslations('partnerOps.leads');
  const code = (g: 'st' | 'rc', c: string) => (t.has(`${g}.${c}` as never) ? t(`${g}.${c}` as never) : c);

  return (
    <><Pgh title={t('title')} sub={t('sub')} />
      {rows.length === 0 ? <Empty>{t('empty')}</Empty> : (
        <Tw id="my-disputes" head={[t('th.no'), t('th.lead'), t('th.reason'), t('th.date'), t('th.result')]}>
          {rows.map((d) => {
            const st: [string, Tone] = [code('st', d.state), ST[d.state] ?? 'wait'];
            return (
              <tr key={d.id}>
                <td><b className="pt-code">{d.no}</b></td>
                <td><span className="pt-code">{d.leadNo}</span><div className="pt-ls">{d.summary}</div></td>
                <td className="reason"><b>{code('rc', d.reasonCode)}</b> — {d.reason}</td>
                <td>{ymdKst(d.requestedAt)}</td>
                <td>
                  <Bg tone={st[1]}>{st[0]}</Bg>
                  {d.state === 'ACCEPTED'
                    ? <div className="pt-ls">{tl('fee')} {won(d.restored ?? d.amount)}원 {d.settleMode === 'PREPAID' ? t('refunded') : t('deducted')}</div>
                    : d.decisionReason ? <div className="pt-ls">{d.decisionReason}</div> : null}
                </td>
              </tr>
            );
          })}
        </Tw>
      )}
      <Note kind="info">{t.rich('eligNote', { b: (c) => <b>{c}</b> })}</Note>
      {r?.cap && (
        <div className="pt-cap" data-reject-cap>
          <div className="cb"><div className="cf" style={{ width: `${Math.min(100, Math.round((r.cap.used / Math.max(1, r.cap.cap)) * 100))}%` }} /></div>
          <div className="cl"><b>{tl('capCount', { used: String(r.cap.used), cap: String(r.cap.cap) })}</b><span className="pt-ls">{r.cap.month} · {tl('capOf', { n: String(r.cap.received) })}</span></div>
        </div>
      )}
      <Note kind="warn">{t.rich('judgeNote', { b: (c) => <b>{c}</b> })}</Note>

      <S2>{tl('tab.rej')}</S2>
      <div className="pt-fset">
        <Msgs ns={['deal']}><FeeDisputeForm fees={open.map((x) => ({ id: x.id, summary: x.summary, amount: x.amount, deliveredAt: x.deliveredAt }))} /></Msgs>
      </div>
      <Note kind="plain">{t.rich('otherNote', { a: (c) => <Link href="/support">{c}</Link> })}</Note>
      <div className="pt-dact">
        <Link className="pt-bo" href="/partner/leads">{t('toLeads')}</Link>
        <Link className="pt-bo" href="/partner/cash">{t('toCash')}</Link>
      </div>
    <i hidden data-root-end="" /></>
  );
}

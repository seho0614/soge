'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useFmt } from '@/lib/useFmt';

export interface SellerSettlement {
  id: string; from: string; to: string; gross: number | string; commission: number | string; refund: number | string;
  carriedIn: number | string; net: number | string; status: string; invoiceState: string; invoiceNo: string | null; items: number;
  /** v10.169 — 결제대행사 지급 요청(판매자 하위가맹점으로) */
  payoutState?: 'READY' | 'DONE' | 'FAILED' | null; payoutRef?: string | null;
}
interface Line { kind: 'SALE' | 'REFUND'; orderNo: string; goodsAmount: number | string; commission: number | string; net: number | string }

/**
 * v10.168 (D157 · docs/259) — 판매자센터 「정산」: 주 1회 마감 정산서 · 주문별 명세(입점 약관 제19조).
 *   지급은 결제대행사가 판매자 하위가맹점으로 합니다(결정 A) — 여기서는 금액과 상태만.
 */
export function SellerSettlements({ rows }: { rows: SellerSettlement[] }) {
  const t = useTranslations('hlt.ssettle');
  const f = useFmt();
  const [open, setOpen] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function show(id: string) {
    if (open === id) { setOpen(null); return; }
    setErr(null);
    const r = await fetch(`/api/v1/me/health/seller/settlements/${id}`);
    if (!r.ok) { setErr(t('errLoad')); return; }
    setLines(await r.json()); setOpen(id);
  }

  return (
    <section className="hlt-box" data-seller-settlements={rows.length}>
      <h3>{t('title')}</h3>
      <p className="hint">{t('help')}</p>
      {err && <p className="form-error" role="alert">{err}</p>}
      {rows.length === 0 && <p className="hint">{t('empty')}</p>}
      {rows.length > 0 && (
        <table className="tbl hlt-tbl">
          <thead><tr><th>{t('period')}</th><th>{t('gross')}</th><th>{t('commission')}</th><th>{t('refund')}</th><th>{t('net')}</th><th>{t('status')}</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-seller-settlement={r.id}>
                <td>{r.from.slice(0, 10)} ~ {r.to.slice(0, 10)}</td>
                <td>{f.won(r.gross, '-')}</td><td>{f.won(r.commission, '-')}</td><td>{f.won(r.refund, '-')}</td>
                <td><b>{f.won(r.net, '-')}</b>{Number(r.carriedIn) !== 0 ? <small className="dim"> ({t('carried', { amt: f.won(r.carriedIn, '-') })})</small> : null}</td>
                <td>{t(`st.${r.status as 'DRAFT'}`)}{r.invoiceState === 'ISSUED' ? <small className="dim"> · {t('invoice', { no: r.invoiceNo ?? '' })}</small> : null}{r.payoutState ? <small className="dim" data-payout={r.payoutState}> · {t(`payout.${r.payoutState}`)}</small> : null}</td>
                <td><button className="hlt-btn sm" onClick={() => void show(r.id)}>{open === r.id ? t('close') : t('detail', { n: String(r.items) })}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open && (
        <table className="tbl hlt-tbl" data-settlement-lines={open}>
          <thead><tr><th>{t('order')}</th><th>{t('kind')}</th><th>{t('gross')}</th><th>{t('commission')}</th><th>{t('net')}</th></tr></thead>
          <tbody>{lines.map((l) => (
            <tr key={l.kind + l.orderNo}><td>{l.orderNo}</td><td>{t(`k.${l.kind}`)}</td><td>{f.won(l.goodsAmount, '-')}</td><td>{f.won(l.commission, '-')}</td><td>{f.won(l.net, '-')}</td></tr>
          ))}</tbody>
        </table>
      )}
    </section>
  );
}

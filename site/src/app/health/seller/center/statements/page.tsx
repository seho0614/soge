/** SB-HLT-SLX-010 판매자센터 › 월 정산서 (v10.532 · D281 · docs/670) */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGetPersonal, ApiFailure } from '@/lib/api';
import { me } from '@/lib/session';
import { getFmt } from '@/lib/getFmt';
import { Crumb, HltNav, HltEmpty } from '@/components/health/HltParts';
import { PrintButton } from '@/components/slx/PrintButton';
import { getTranslations } from 'next-intl/server';
import '@/styles/slx.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('hlt');
  const ts = await getTranslations('slx.stmt');
  return { title: t('meta.title', { title: ts('title') }) };
}
export const dynamic = 'force-dynamic';

const YM = /^[0-9]{4}-(0[1-9]|1[0-2])$/;   // 서버 STMT_YM · DB CHECK 와 같음
type MonthRow = { ym: string; id: string | null; weeks: number; net: number | null; paid: number | null; mailState: string | null; mailedAt: string | null; preview: boolean };
type List = { seller: { code: string; name: string }; items: MonthRow[]; note: string };
type Line = { id: string; from: string; to: string; gross: number; fee: number; feeVat: number; refund: number; returnShip?: number; carriedIn: number; net: number; carriedOut: number; status: string; invoiceState: string; invoiceNo: string | null; items: number };
type Doc = {
  id: string | null; ym: string; preview: boolean; company: string;
  seller: { code: string; name: string; bizRegNo: string | null; ceoName: string | null; ecomRegNo: string | null; addr: string | null };
  weeks: number; gross: number; fee: number; feeVat: number; refund: number; returnShip?: number; carriedIn: number; net: number; carriedOut: number; paid: number; lines: Line[];
  mailState: string; mailedAt: string | null; note: string;
};

/**
 * 판매자센터 「월 정산서」 — GET /me/health/seller/statements · GET /me/health/seller/statements/{ym}
 *   주 정산서(월요일 시작)를 시작일이 그 달인 것끼리 모은 한 장 · 아직 안 만든 달은 지금 기록으로 셈한 미리보기
 *   「인쇄 · PDF 저장」 = 브라우저 인쇄 창(대상 「PDF로 저장」) · 인쇄할 때는 머리줄 · 길 안내 · 단추를 숨김(slx.css)
 *   메일은 운영이 켰을 때(처음 꺼짐) 같은 달에 한 번만 — 여기서는 보낸 때만 보여 줌
 */
export default async function HltSellerStatementsPage({ searchParams }: { searchParams: Promise<{ ym?: string }> }) {
  if (!(await me())) redirect('/login');
  const t = await getTranslations('hlt.center');
  const ts = await getTranslations('slx.stmt');
  const f = await getFmt();
  const sp = await searchParams;
  let list: List | null = null;
  let notSeller = false;
  try {
    list = await apiGetPersonal<List>('/me/health/seller/statements');
  } catch (e) {
    notSeller = e instanceof ApiFailure && e.status === 403;
  }
  const ym = list ? (sp.ym && YM.test(sp.ym) ? sp.ym : list.items[0]?.ym) : undefined;
  const doc = list && ym ? await apiGetPersonal<Doc>(`/me/health/seller/statements/${ym}`).catch(() => null) : null;
  const w = (v: number | null | undefined) => f.won(v ?? 0, '-');
  const stLabel = (s: string) => (s === 'DRAFT' ? ts('stDRAFT') : s === 'CONFIRMED' ? ts('stCONFIRMED') : s === 'PAID' ? ts('stPAID') : s === 'CARRIED' ? ts('stCARRIED') : s);
  return (
    <><div className="hlt" data-slx-statements-page={doc?.ym ?? ''}>
      <div className="slx-noprint">
        <HltNav back="/health/seller/center" />
        <Crumb items={[{ href: '/health/seller', label: t('apply') }, { href: '/health/seller/center', label: ts('back') }, { label: ts('title') }]} />
      </div>
      <div className="page-head slx-noprint"><h1>{ts('title')}</h1></div>
      {notSeller ? <HltEmpty msg={t('notSeller')} href="/health/seller" label={t('apply')} /> : list === null ? <p className="form-error" role="alert">{t('errLoad')}</p> : <>
        <p className="lead slx-noprint">{ts('lead')}</p>
        {list.items.length === 0 ? <p className="empty" data-slx-stmt-empty="">{ts('empty')}</p> : (
          <ul className="slx-months" aria-label={ts('months')}>
            {list.items.map((m) => (
              <li key={m.ym}><Link href={`/health/seller/center/statements?ym=${m.ym}`} className={m.ym === ym ? 'on' : undefined} data-slx-month={m.ym}>
                {m.ym} <small>{m.preview ? ts('preview') : m.mailState === 'SENT' ? ts('sent') : ts('made')}</small>
              </Link></li>
            ))}
          </ul>
        )}
        {doc && (
          <>
            <div className="slx-bar slx-noprint">
              <PrintButton label={ts('print')} />
              <span className="slx-hint">{ts('printHelp')}</span>
            </div>
            <article className="slx-sheet" data-slx-sheet={doc.ym} data-slx-preview={doc.preview ? '1' : '0'}>
              <h2>{ts('docTitle', { ym: doc.ym })}</h2>
              <div className="slx-meta">
                <span>{ts('seller')} <b>{doc.seller.name}</b> ({doc.seller.code})</span>
                <span>{ts('payer')} <b>{doc.company}</b></span>
                <span>{ts('bizNo')} {doc.seller.bizRegNo ?? '—'}</span>
                <span>{ts('ceo')} {doc.seller.ceoName ?? '—'}</span>
                <span>{ts('ecom')} {doc.seller.ecomRegNo ?? '—'}</span>
                <span>{ts('weeks', { n: doc.weeks })}{doc.preview ? <> · <span className="slx-badge">{ts('preview')}</span></> : null}{doc.mailState === 'SENT' ? <> · <span className="slx-badge ok">{ts('sent')}</span></> : null}</span>
              </div>
              <div className="slx-scroll">
                <table className="slx-tbl">
                  <thead><tr><th className="num">{ts('gross')}</th><th className="num">{ts('fee')}</th><th className="num">{ts('feeVat')}</th><th className="num">{ts('refund')}</th><th className="num">{ts('returnShip')}</th><th className="num">{ts('net')}</th><th className="num">{ts('paid')}</th><th className="num">{ts('carriedOut')}</th></tr></thead>
                  <tbody><tr className="sum"><td className="num">{w(doc.gross)}</td><td className="num">{w(doc.fee)}</td><td className="num">{w(doc.feeVat)}</td><td className="num">{w(doc.refund)}</td><td className="num" data-slx-return-ship={doc.returnShip ?? 0}>{w(doc.returnShip)}</td><td className="num">{w(doc.net)}</td><td className="num">{w(doc.paid)}</td><td className="num">{w(doc.carriedOut)}</td></tr></tbody>
                </table>
                <table className="slx-tbl" data-slx-lines={doc.lines.length}>
                  <thead><tr><th>{ts('week')}</th><th className="num">{ts('gross')}</th><th className="num">{ts('fee')}</th><th className="num">{ts('refund')}</th><th className="num">{ts('returnShip')}</th><th className="num">{ts('carriedIn')}</th><th className="num">{ts('net')}</th><th>{ts('status')}</th></tr></thead>
                  <tbody>
                    {doc.lines.map((l) => (
                      <tr key={l.id}>
                        <td>{l.from} ~ {l.to}</td><td className="num">{w(l.gross)}</td><td className="num">{w(l.fee)}</td><td className="num">{w(l.refund)}</td><td className="num">{w(l.returnShip)}</td>
                        <td className="num">{w(l.carriedIn)}</td><td className="num">{w(l.net)}</td><td>{stLabel(l.status)}{l.invoiceNo ? ` · ${l.invoiceNo}` : ''}</td>
                      </tr>
                    ))}
                    {doc.lines.length === 0 && <tr><td colSpan={8}>{ts('noWeeks')}</td></tr>}
                  </tbody>
                </table>
              </div>
              <p className="slx-hint">{ts('note')}</p>
            </article>
            <p className="slx-hint slx-noprint">{ts('mailNote')}</p>
          </>
        )}
      </>}
    </div><i hidden data-root-end="" /></>
  );
}

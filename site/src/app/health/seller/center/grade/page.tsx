/** SB-HLT-SMQ-020 판매자센터 › 판매 평가 (v10.579 · docs/721) */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { apiGetPersonal, ApiFailure } from '@/lib/api';
import { me } from '@/lib/session';
import { Crumb, HltNav, HltEmpty } from '@/components/health/HltParts';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('hlt');
  const tg = await getTranslations('smx.smq.grade');
  return { title: t('meta.title', { title: tg('title') }) };
}
export const dynamic = 'force-dynamic';

type Rules = { latePct: number; cancelPct: number; qnaPct: number; minOrders: number; shipDays: number; limitMonths: number; limitDays: number; qnaDueHours: number };
type Month = { ym: string; orders: number; lateShip: number; sellerCancels: number; qnaTotal: number; qnaLate: number; latePct: number | null; cancelPct: number | null; qnaPct: number | null; grade: string; level?: string; over: string[] };
type View = { on: boolean; seller: { code: string; name: string }; rules: Rules; minQna: number; months: Month[]; current: Month;
  limit: { state: string; reason: string; fromOn: string | null; untilOn: string | null; inEffect: boolean } | null; note: string };

/**
 * 판매자센터 「판매 평가」 — GET /me/health/seller/grade
 *   공개 기준(배송 지연 · 판매자 사정 취소 · 반품 · 문의 답 늦음) · 이번 달 미리보기 · 알린 최근 6달 · 적용 중 노출 제한
 *   읽기만 — 기준 값 · 스위치는 운영(SUPER)이 정함
 */
export default async function HltSellerGradePage() {
  if (!(await me())) redirect('/login');
  const t = await getTranslations('hlt.center');
  const tg = await getTranslations('smx.smq.grade');
  let d: View | null = null;
  let notSeller = false;
  try {
    d = await apiGetPersonal<View>('/me/health/seller/grade');
  } catch (e) {
    notSeller = e instanceof ApiFailure && e.status === 403;
  }
  const pc = (v: number | null) => (v == null ? '—' : `${v}%`);
  const gradeOf = (g: string) => (g === 'N' ? tg('gradeN') : g);
  const lv = (m: Month) => (m.level === 'LIMIT' ? tg('lvLIMIT') : m.level === 'WARN' ? tg('lvWARN') : (m.over ?? []).length ? tg('lvWARN') : tg('lvOK'));
  const row = (m: Month, cur: boolean) => (
    <tr key={m.ym} data-smq-grade-month={m.ym}>
      <td>{m.ym}{cur ? ` · ${tg('now')}` : ''}</td>
      <td className="num">{m.orders}</td>
      <td className="num">{m.lateShip} <span className={(m.over ?? []).includes('late') ? 'warn-text' : 'hlt-mut'}>{pc(m.latePct)}</span></td>
      <td className="num">{m.sellerCancels} <span className={(m.over ?? []).includes('cancel') ? 'warn-text' : 'hlt-mut'}>{pc(m.cancelPct)}</span></td>
      <td className="num">{m.qnaLate} / {m.qnaTotal} <span className={(m.over ?? []).includes('qna') ? 'warn-text' : 'hlt-mut'}>{pc(m.qnaPct)}</span></td>
      <td><b>{gradeOf(m.grade)}</b></td>
      <td>{lv(m)}</td>
    </tr>
  );
  return (
    <><div className="hlt" data-smq-grade-page={d ? (d.on ? 'on' : 'off') : ''}>
      <HltNav back="/health/seller/center" />
      <Crumb items={[{ href: '/health/seller', label: t('apply') }, { href: '/health/seller/center', label: tg('back') }, { label: tg('title') }]} />
      <div className="page-head"><h1>{tg('title')}</h1></div>
      {!d ? (notSeller ? <HltEmpty msg={t('notSeller')} href="/health/seller" label={t('apply')} /> : <p className="form-error" role="alert">{t('errLoad')}</p>) : (
        <>
          <p className={d.on ? 'hlt-mut' : 'warn-text'}>{d.on ? tg('onNote') : tg('offNote')}</p>
          {d.limit && <p className="warn-text" data-smq-grade-limit={d.limit.inEffect ? 'on' : 'off'}>{tg('limit', { from: d.limit.fromOn ?? '', to: d.limit.untilOn ?? '', r: d.limit.reason })}</p>}
          <div className="hlt-box" data-smq-grade-rules="">
            <p><b>{tg('rulesH')}</b></p>
            <ul>
              <li>{tg('ruleLate', { d: String(d.rules.shipDays), p: String(d.rules.latePct) })}</li>
              <li>{tg('ruleCancel', { p: String(d.rules.cancelPct) })}</li>
              <li>{tg('ruleQna', { h: String(d.rules.qnaDueHours), p: String(d.rules.qnaPct) })}</li>
              <li>{tg('ruleSample', { o: String(d.rules.minOrders), q: String(d.minQna) })}</li>
              <li>{tg('ruleLimit', { m: String(d.rules.limitMonths), d: String(d.rules.limitDays) })}</li>
            </ul>
          </div>
          <div className="hlt-box">
            <table className="tbl hlt-tbl" data-smq-grade-rows={d.months.length + 1}>
              <thead><tr><th>{tg('thYm')}</th><th className="num">{tg('thOrders')}</th><th className="num">{tg('thLate')}</th><th className="num">{tg('thCancel')}</th><th className="num">{tg('thQna')}</th><th>{tg('thGrade')}</th><th>{tg('thLevel')}</th></tr></thead>
              <tbody>
                {row(d.current, true)}
                {d.months.map((m) => row(m, false))}
              </tbody>
            </table>
          </div>
          {d.months.length === 0 && <p className="hlt-mut hlt-sm">{tg('noMonths')}</p>}
        </>
      )}
    </div><i hidden data-root-end="" /></>
  );
}

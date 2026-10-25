import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { ymdKst } from '@/lib/format';
import { Bg, Empty, Note, Pgh, S2, SVC_ST, Tw, won } from '@/components/partner/ui';
import { BlockEditor, MatrixEditor, ServiceActions } from '@/components/partner/ServiceTools';
import { getFmt } from '@/lib/getFmt';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('partnerOps.svcDetail'))('title') };
}

interface D {
  id: string; title: string; body: string | null; status: string; rejectReason: string | null; createdAt: string; updatedAt: string;
  formType: string | null; formLabel: string | null; target: string | null; receiveMode: string | null;
  topFee: number | null; referralRate: number | null; rebateBonus: number | null; suspendedBy: string | null;
  categoryName: string | null; categoryFee: string | null;
  blocks: Array<{ kind: string; label: string; filled: boolean; body: string | null; fileId: string | null }>;
  matrix: { rows: Array<{ key: string; label: string }>; cols: Array<{ key: string; label: string }>; cells: Array<{ row: string; col: string; amount: number }> };
  events: Array<{ action: string; from: string | null; to: string | null; reason: string | null; at: string }>;
  stats: { received: number; viewed: number };
  canEdit: boolean; canSuspend: boolean; canResume: boolean;
}
/* 처리 · 검수 상태 글자는 사전 partnerOps.svcDetail.act.<코드> · svcSt.<코드> (v10.100 · 2-5a) */

/**
 * SB-PTC-CTR-201 서비스 상세 · 상세페이지 — v10.31 (W5 · 10/10 시안 기준 scPtnSvcDetail)
 *   요약(.dsum) → 「상세페이지 블록」 표(블록 · 상태 · 내용 — 채우기/고치기) → 안내 → 「서비스 수정 · 노출 중단 · 승인 · 반려 이력」 단추.
 *   매트릭스 견적 서비스면 견적 칸을 여기서 고칩니다. 처리 이력은 서버 기록(partner_service_events)입니다.
 */
export default async function ServiceDetail({ params }: { params: Promise<{ id: string }> }) {
  const p = await me();
  if (!p) redirect('/login');
  const { id } = await params;
  const t = await getTranslations('partnerOps.svcDetail');
  const f = await getFmt();
  const to = await getTranslations('partnerOps');
  const svc = (c: string) => (to.has(`svcSt.${c}` as never) ? to(`svcSt.${c}` as never) : SVC_ST[c]?.[0] ?? c);
  const act = (c: string) => (t.has(`act.${c}` as never) ? t(`act.${c}` as never) : c);
  const s = await apiGet<D>(`/partner/services/${encodeURIComponent(id)}`, 0).catch(() => null);
  if (!s) {
    return (
      <><Pgh title={t('short')} />
        <Empty>{t('notFound')}</Empty>
        <div className="pt-dact"><Link className="pt-bo" href="/partner/services">{t('toList')}</Link></div>
      <i hidden data-root-end="" /></>
    );
  }
  const st = s.status === 'SUSPENDED' && s.suspendedBy === 'PARTNER' ? [t('archived'), 'off'] as const : [svc(s.status), SVC_ST[s.status]?.[1] ?? 'off'] as const;

  return (
    <><Pgh title={t('title')} sub={t('sub')} />
      <div className="pt-dsum">
        <div className="dr"><span>{t('k.svc')}</span><b>{s.title}</b></div>
        <div className="dr"><span>{t('k.state')}</span><b><Bg tone={st[1]}>{st[0]}</Bg></b></div>
        <div className="dr"><span>{t('k.form')}</span><b>{s.formLabel ?? t('simple')}{s.categoryName ? ` · ${s.categoryName}` : ''}</b></div>
        <div className="dr"><span>{t('k.id')}</span><b className="pt-code">S-{s.id.slice(0, 8)}</b></div>
        <div className="dr"><span>{t('k.target')}</span><b>{s.target ?? '—'}</b></div>
        <div className="dr"><span>{t('k.topFee')}</span><b>{s.topFee ? f.wonOf(won(s.topFee)) : s.categoryFee ? t('catBase', { amt: f.wonOf(won(s.categoryFee)) }) : '—'}</b></div>
        <div className="dr"><span>{t('k.refFee')}</span><b>{s.referralRate != null ? t('onDeal', { pct: String(Math.round(s.referralRate * 1000) / 10) }) : '—'}{s.rebateBonus ? ` · ${t('rebate', { amt: f.wonOf(won(s.rebateBonus)) })}` : ''}</b></div>
        <div className="dr"><span>{t('k.leads')}</span><b>{t('recvLine', { n: String(s.stats.received), v: String(s.stats.viewed) })}</b></div>
        <div className="dr"><span>{t('k.updated')}</span><b>{ymdKst(s.updatedAt)}</b></div>
      </div>
      {s.status === 'REJECTED' && s.rejectReason && (
        <Note kind="warn"><b>{t('rejReason')}</b> — {s.rejectReason}<br />{t('rejFix')}</Note>
      )}

      <S2>{t('blocksH')}</S2>
      <Tw head={[t('bth.block'), t('k.state'), t('bth.body'), '']}>
        {s.blocks.map((b) => (
          <tr key={b.kind} data-block-row={b.kind}>
            <td><b>{b.label}</b></td>
            <td>{b.filled ? <Bg tone="ok">{t('filled')}</Bg> : <Bg tone="off">{t('emptyBlock')}</Bg>}</td>
            <td>{b.body ? <span style={{ whiteSpace: 'pre-wrap' }}>{b.body.length > 120 ? `${b.body.slice(0, 120)}…` : b.body}</span> : b.fileId ? t('photo1') : '—'}</td>
            <td><BlockEditor id={s.id} kind={b.kind} label={b.label} body={b.body} fileId={b.fileId} /></td>
          </tr>
        ))}
      </Tw>
      <Note kind="info">{t.rich('blockNote', { b: (c) => <b>{c}</b> })}</Note>
      <Note kind="warn">{t.rich('editNote', { b: (c) => <b>{c}</b> })}</Note>

      {s.formType === 'MATRIX' && (<>
        <S2>{t('mxH')}</S2>
        <MatrixEditor id={s.id} rows={s.matrix.rows} cols={s.matrix.cols} cells={s.matrix.cells} />
      </>)}

      <ServiceActions id={s.id} title={s.title} body={s.body} target={s.target} receiveMode={s.receiveMode}
                      topFee={s.topFee} referralRate={s.referralRate} rebateBonus={s.rebateBonus}
                      baseFee={s.categoryFee != null ? Number(s.categoryFee) : null}
                      canEdit={s.canEdit} canSuspend={s.canSuspend} canResume={s.canResume} status={s.status} />

      <S2>{t('histH')}</S2>
      {s.events.length === 0 ? <Empty>{t('histEmpty')}</Empty> : (
        <Tw head={[t('hth.date'), t('hth.act'), t('k.state'), t('hth.reason')]}>
          {s.events.map((e, i) => (
            <tr key={i}><td>{ymdKst(e.at)}</td><td><b>{act(e.action)}</b></td>
              <td>{e.to ? svc(e.to) : '—'}</td><td>{e.reason ?? '—'}</td></tr>
          ))}
        </Tw>
      )}
      <div className="pt-dact">
        <Link className="pt-bo" href="/partner/services">{t('toList')}</Link>
        <Link className="pt-bo" href="/partner/regions">{t('regions')}</Link>
        <Link className="pt-bp" href="/partner/reviews">{t('reviews')}</Link>
      </div>
    <i hidden data-root-end="" /></>
  );
}

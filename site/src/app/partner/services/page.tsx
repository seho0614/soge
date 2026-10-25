import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { ymdKst } from '@/lib/format';
import { Bg, Empty, Note, Pgh, S2, SVC_ST, Tw } from '@/components/partner/ui';
import { MatrixEditor } from '@/components/partner/ServiceTools';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('partnerOps.services'))('title') };
}

interface Svc {
  id: string; title: string; status: string; rejectReason: string | null; createdAt: string;
  updatedAt?: string; formType?: string | null; suspendedBy?: string | null; categoryName?: string | null;
  leadCount?: number; viewedCount?: number; doneCount?: number; convRate?: string | number | null;
}
interface Detail { matrix: { rows: Array<{ key: string; label: string }>; cols: Array<{ key: string; label: string }>; cells: Array<{ row: string; col: string; amount: number }> }; title: string }
/* 등록 방식 · 검수 상태 글자는 사전 partnerOps.form.<코드> · svcSt.<코드> (v10.100 · 2-5a) */

/**
 * SB-PTC-CTR-200 내 서비스 — v10.31 (W5 · 10/10 시안 기준 scPtnSvc)
 *   단추 줄 → 표(서비스 · 등록 방식 · 상태 · 받은 리드 · 성사율 · 수정일 · 상세) → 「자동 견적 매트릭스」(매트릭스 견적 서비스의 칸 값).
 *   받은 리드 = 그 서비스 업종으로 받은 배정 · 성사율 = 소비자가 확인한 이행 보고 ÷ 연락처를 연 배정(서버 계산).
 *   파트너가 멈춘 서비스는 「보관(노출 중단)」으로 보입니다.
 */
export default async function ServicesPage() {
  const p = await me();
  if (!p) redirect('/login');

  const list = await apiGet<Svc[]>('/partner/services', 0).catch(() => [] as Svc[]);
  const approved = list.filter((s) => s.status === 'APPROVED').length;
  const mxSvc = list.find((s) => s.formType === 'MATRIX' && s.status !== 'REJECTED');
  const t = await getTranslations('partnerOps.services');
  const to = await getTranslations('partnerOps');
  const code = (g: 'form' | 'svcSt', c: string, fb: string) => (to.has(`${g}.${c}` as never) ? to(`${g}.${c}` as never) : fb);
  const mx = mxSvc ? await apiGet<Detail>(`/partner/services/${encodeURIComponent(mxSvc.id)}`, 0).catch(() => null) : null;

  return (
    <><Pgh title={t('title')} sub={t('sub')} />
      <div className="pt-pact" data-ptn-actions>
        <Link className="pt-bp" href="/partner/services/new" data-ptn-new>{t('new')}</Link>
        <Link className="pt-bo" href="/partner/regions">{t('regions')}</Link>
        <Link className="pt-bo" href="/partner/performance">{t('performance')}</Link>
        <Link className="pt-bo" href="/partner/reviews">{t('reviews')}</Link>
      </div>

      {approved === 0 && (
        <Note kind="warn">{t.rich('noApproved', { b: (c) => <b>{c}</b> })}</Note>
      )}

      {list.length === 0 ? (
        <Empty>{t('empty')}</Empty>
      ) : (
        <Tw head={[t('th.svc'), t('th.form'), t('th.state'), t('th.leads'), t('th.conv'), t('th.updated'), '']} numCols={[3, 4]}>
          {list.map((s) => {
            const st = s.status === 'SUSPENDED' && s.suspendedBy === 'PARTNER' ? [t('archived'), 'off'] as const : [code('svcSt', s.status, SVC_ST[s.status]?.[0] ?? s.status), SVC_ST[s.status]?.[1] ?? 'off'] as const;
            return (
              <tr key={s.id}>
                <td>
                  <b>{s.title}</b><br /><span className="pt-ls pt-code">S-{s.id.slice(0, 8)}{s.categoryName ? ` · ${s.categoryName}` : ''}</span>
                  {s.rejectReason ? <div className="pt-wn">{s.rejectReason}</div> : null}
                  {s.status === 'IN_REVIEW' ? <div className="pt-ls">{t('inReview')}</div> : null}
                </td>
                <td>{s.formType ? code('form', s.formType, s.formType) : <span className="pt-ls">— ({t('simple')})</span>}</td>
                <td><Bg tone={st[1]}>{st[0]}</Bg></td>
                <td className="num">{s.leadCount ?? 0}</td>
                <td className="num">{s.convRate != null ? `${s.convRate}%` : '—'}</td>
                <td>{ymdKst(s.updatedAt ?? s.createdAt)}</td>
                <td><Link className="pt-bo sm" href={`/partner/services/${encodeURIComponent(s.id)}`}>{t('detail')}</Link></td>
              </tr>
            );
          })}
        </Tw>
      )}

      <S2>{t('mxH')}</S2>
      {mxSvc && mx ? (
        <>
          <p className="pt-ls">{t('mxOf', { title: mx.title })}</p>
          <MatrixEditor rows={mx.matrix.rows} cols={mx.matrix.cols} cells={mx.matrix.cells} readOnly />
        </>
      ) : <Empty>{t('mxEmpty')}</Empty>}
      <Note kind="warn">{t.rich('axisNote', { b: (c) => <b>{c}</b> })}</Note>
      <Note kind="info">
        {t.rich('rejNote', { b: (c) => <b>{c}</b> })}
      </Note>
    <i hidden data-root-end="" /></>
  );
}

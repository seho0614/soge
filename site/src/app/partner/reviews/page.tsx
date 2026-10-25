import type { Metadata } from 'next';
import Link from 'next/link';
import { ymdKst } from '@/lib/format';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { Bg, Empty, Note, Pgh, ptCode, Tw, type Tone } from '@/components/partner/ui';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('partner.meta'))('reviews') };
}

interface Row {
  id: string; title: string; status: string;
  rejectReason: string | null; createdAt: string; categoryName: string | null;
}

/* v10.100 (다국어 2-5a) — 결과 글자는 사전 partner.reviews.st.<코드> */
const LABEL: Record<string, Tone> = {
  DRAFT: 'wait', IN_REVIEW: 'wait', APPROVED: 'ok',
  REJECTED: 'no', SUSPENDED: 'no',
};

/**
 * SB-PTC-CTR-250 승인 · 반려 이력 — v10.29 시안 scPtnRev 표(서비스 · 이름 · 요청일 · 결과 · 이후)
 *
 * 반려에는 **반드시 사유가 있습니다**(DB 가 강제합니다).
 * 무엇을 고쳐야 다시 올릴 수 있는지 모르면 같은 것을 또 올리게 됩니다.
 * 시안의 「본사 검수 화면 보기」(BO 로 가는 단추)는 파트너 화면에 두지 않았습니다(diffs).
 */
export default async function ReviewsPage() {
  const p = await me();
  if (!p) redirect('/login');
  const t = await getTranslations('partner.reviews');
  const tp = await getTranslations('partner');

  const rows = await apiGet<Row[]>('/partner/reviews', 0).catch(() => []);

  return (
    <><Pgh title={t('title')} sub={<>{t.rich('sub', { b: (c) => <b>{c}</b> })}</>} />

      {rows.length === 0 ? (
        <Empty>{t('empty')}</Empty>
      ) : (
        <Tw head={[t('thSvc'), t('thName'), t('thDate'), t('thResult'), t('thAfter')]}>
          {rows.map((r) => {
            const st = [ptCode(t, 'st', r.status, r.status), LABEL[r.status] ?? ('off' as Tone)] as const;
            return (
              <tr key={r.id}>
                <td><b className="pt-code">{r.categoryName ?? '—'}</b></td>
                <td><b>{r.title}</b></td>
                <td>{ymdKst(r.createdAt)}</td>
                <td><Bg tone={st[1]}>{st[0]}</Bg></td>
                <td className="reason">
                  {r.status === 'REJECTED'
                    ? <>{r.rejectReason ?? '—'} <Link className="pt-bo sm" href={`/partner/services/${encodeURIComponent(r.id)}`}>{t('fix')}</Link></>
                    : r.status === 'IN_REVIEW' ? <span className="pt-ls">{t('wait')}</span> : r.status === 'APPROVED' ? t('live') : '—'}
                </td>
              </tr>
            );
          })}
        </Tw>
      )}

      <Note kind="info">{t.rich('note', { b: (c) => <b>{c}</b> })}</Note>
      <div className="pt-dact"><Link className="pt-bo" href="/partner/services">{tp('common.toServices')}</Link></div>
    <i hidden data-root-end="" /></>
  );
}

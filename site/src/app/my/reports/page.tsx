import type { Metadata } from 'next';
import { ymdKst } from '@/lib/format';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { MyHead, Note, Empty, Table } from '@/components/my/ui';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('my.reports'))('title') };
}

interface R {
  id: string; state: string; reasonCode: string; reasonLabel?: string;
  targetType: string; resolution?: string; createdAt: string; handledAt?: string;
}

/* v10.99 — 상태 · 대상 이름은 사전 키(my.reports.st.* · my.reports.tt.*) */
const ST: Record<string, ['open' | 'queued' | 'upheld' | 'dismissed', string]> = {
  OPEN: ['open', 'wait'], QUEUED: ['queued', 'wait'], UPHELD: ['upheld', 'ok'], DISMISSED: ['dismissed', 'no'],
};
const TT: Record<string, 'listing' | 'request' | 'service' | 'profile' | 'post' | 'comment'> = {
  LISTING: 'listing', REQUEST: 'request', SERVICE: 'service', PROFILE: 'profile',
  POST: 'post', COMMENT: 'comment',   // v10.80 — 전에는 글도 영어 코드로 보였음
};

/**
 * SB-MYP-RPT-010 내 신고 내역
 *
 * 처리했는지 안 했는지 모르면 같은 건을 또 올립니다. **기각도 사유와 함께 보여 줍니다.**
 * v10.29 — 시안(scMyRpt) 배치: 머리 설명에 확인 중 건수 → 표(대상 · 사유 · 상태 · 처리 내용 · 신고) → 안내.
 */
export default async function MyReportsPage() {
  const p = await me();
  if (!p) redirect('/login');

  const rows = await apiGet<R[]>('/me/reports', 0).catch(() => [] as R[]);
  const open = rows.filter((r) => r.state === 'OPEN' || r.state === 'QUEUED').length;
  const t = await getTranslations('my.reports');

  return (
    <>
      <MyHead title={t('title')}
        sub={open > 0 ? t('subOpen', { n: String(open) }) : t('sub')} />
      {rows.length === 0 ? (
        <Empty>{t('empty')}</Empty>
      ) : (
        <Table head={[t('thTarget'), t('thReason'), t('thStatus'), t('thResolution'), t('thDate')]}>
          {rows.map((r) => {
            const s = ST[r.state];
            const tt = TT[r.targetType];
            const st = s ? [t(`st.${s[0]}`), s[1]] : [r.state, 'off'];
            return (
              <tr key={r.id}>
                <td>{tt ? t(`tt.${tt}`) : r.targetType}</td>
                <td><b>{r.reasonLabel ?? r.reasonCode}</b></td>
                <td><span className={`my-bg ${st[1]}`}>{st[0]}</span></td>
                <td>{r.resolution ?? '—'}</td>
                <td>{ymdKst(r.createdAt)}</td>
              </tr>
            );
          })}
        </Table>
      )}
      <Note kind="info"><b>{t('noteB')}</b> {t('noteText')}</Note>
    </>
  );
}

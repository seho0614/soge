import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { createPrivacyRequest, me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { MyHead, Note, Table } from '@/components/my/ui';
import { PrivacyRequestForm } from './PrivacyRequestForm';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('my.privacy'))('title') };
}

interface Req { id: string; kind: string; status: string; dueOn: string; resultNote: string | null; extendReason: string | null; handledAt: string | null; createdAt: string; body: string | null }
interface Data { items: Req[]; dueDays: number; kinds: Array<{ code: string; label: string }> }

/**
 * SB-MYP-PRV-010 개인정보 권리 요청 (v10.181 · D170 · docs/283)
 *   GET  /me/privacy-requests — 내 요청 · 처리 기한 날수
 *   POST /me/privacy-requests — 열람 · 정정 · 삭제 · 처리정지 · 처리 결과는 알림
 */
export default async function PrivacyPage() {
  if (!(await me())) redirect('/login?next=/my/account/privacy');
  const t = await getTranslations('my.privacy');
  const d = await apiGetPersonal<Data>('/me/privacy-requests').catch(() => null);
  const fmt = (s: string) => new Date(s).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
  const KIND: Record<string, string> = { ACCESS: t('kind.ACCESS'), CORRECT: t('kind.CORRECT'), DELETE: t('kind.DELETE'), SUSPEND: t('kind.SUSPEND') };
  const STATUS: Record<string, string> = { OPEN: t('status.OPEN'), EXTENDED: t('status.EXTENDED'), DONE: t('status.DONE'), REJECTED: t('status.REJECTED') };

  async function doRequest(kind: string, body: string) {
    'use server';
    return createPrivacyRequest(kind, body);
  }

  return (
    <><div data-my-privacy="">
      <MyHead title={t('title')} sub={t('sub')}
        right={<Link className="my-bo" href="/my/account">{t('backProfile')}</Link>} />
      <Note kind="info"><b>{t('selfB')}</b> {t('selfText')} <Link href="/my/account/data">{t('toData')}</Link> · <Link href="/my/account">{t('toProfile')}</Link> · <Link href="/my/account/withdraw">{t('toWithdraw')}</Link></Note>
      {!d ? <Note kind="warn" role="alert">{t('loadFail')}</Note> : (
        <>
          <h2 className="my-st2">{t('hNew')}</h2>
          <Note kind="plain">{t('due', { days: String(d.dueDays) })}</Note>
          <PrivacyRequestForm kinds={Object.entries(KIND).map(([code, label]) => ({ code, label }))} action={doRequest} />
          <h2 className="my-st2">{t('hMine')}</h2>
          {d.items.length === 0 ? <Note kind="plain">{t('empty')}</Note> : (
            <Table head={[t('thAt'), t('thKind'), t('thBody'), t('thDue'), t('thStatus')]}>
              {d.items.map((r) => (
                <tr key={r.id} data-privacy-row={r.status}>
                  <td>{fmt(r.createdAt)}</td>
                  <td>{KIND[r.kind] ?? r.kind}</td>
                  <td style={{ whiteSpace: 'pre-wrap' }}>{r.body ?? '—'}</td>
                  <td>{r.dueOn}</td>
                  <td><b>{STATUS[r.status] ?? r.status}</b>
                    {r.extendReason && <div>{t('extendReason')}: {r.extendReason}</div>}
                    {r.resultNote && <div>{r.resultNote}</div>}</td>
                </tr>
              ))}
            </Table>
          )}
        </>
      )}
    </div><i hidden data-root-end="" /></>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { ymdKst } from '@/lib/format';
import { BackBar } from '@/components/common/BackBar';
import { InquiryFeedback } from '@/components/support/InquiryFeedback';   // v10.341 (D231)
import { InquiryPhotos } from '@/components/bzx/InquiryPhotos';   // v10.611 (docs/753)
import { Msgs } from '@/i18n/Msgs';
import { getTranslations } from 'next-intl/server';
import '@/styles/proto-w1.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('deal.meta'))('supportHistory') };
}

interface Inquiry {
  id: string; no?: string; category: string; categoryLabel?: string | null; title: string; status: string;
  statusLabel?: string; answer: string | null; createdAt: string; answeredAt?: string | null; channel?: string; feedback?: string | null;
}

/** SB-HOM-CSB-020 — v10.31 시안 scAskList: 표(문의번호 · 제목 · 응대 · 상태 · 접수일 · 최근 답변) + 새 문의 */
export default async function HistoryPage() {
  if (!(await me())) redirect('/login?next=/support/history');
  const t = await getTranslations('deal.support');
  const rows = await apiGetPersonal<Inquiry[]>('/me/inquiries').catch(() => [] as Inquiry[]);
  return (
    <div className="w1 w1-wrap w1-csb" data-screen="SB-HOM-CSB-020">{/* v10.32 — 시안 .wrap.srcw 폭 · 단추 줄 왼쪽 · 0건이어도 표 모양(빈 줄) */}
      <BackBar href="/support" label={t('histBack')} wrap={false} />
      <div className="w1-aih" style={{ marginTop: 10 }}><h1>{t('histTitle')}</h1><p>{t('histLead')}</p></div>
      <div style={{ overflowX: 'auto', marginTop: 14 }}>
        <table className="w1-tb">
          <thead><tr><th>{t('th.no')}</th><th>{t('th.title')}</th><th>{t('th.channel')}</th><th>{t('th.state')}</th><th>{t('th.created')}</th><th>{t('th.answer')}</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="w1-ls" style={{ textAlign: 'center', padding: '28px 12px' }}>{t('histEmpty')}</td></tr>}
            {rows.map((r) => (
              <tr key={r.id}>
                <td><b style={{ fontFamily: 'var(--mono, monospace)', fontSize: 12 }}>{r.no ?? r.id.slice(0, 8)}</b></td>
                <td><b>{r.title}</b>{r.categoryLabel ? <div className="w1-ls">{r.categoryLabel}</div> : null}<InquiryPhotos id={r.id} closed={r.status === 'CLOSED'} /></td>
                <td>{r.channel === 'BOT' ? t('chBot') : t('chAgent')}</td>
                <td>{r.status === 'ANSWERED' || r.status === 'CLOSED' ? <span className="w1-bg ok">{r.statusLabel ?? t('answered')}</span> : <span className="w1-bg wait">{r.statusLabel ?? t('received')}</span>}</td>
                <td>{ymdKst(r.createdAt)}</td>
                {/* v10.333 (D225 · docs/464) — 운영 화면 「1:1 문의」에서 단 답변 전체를 펼쳐 봄(전: 80자에서 자름) */}
                <td style={{ maxWidth: 360 }} data-inquiry-answer={r.answer ? 'yes' : 'no'}>{r.answer
                  ? <details><summary>{r.answer.slice(0, 80) + (r.answer.length > 80 ? '…' : '')}</summary>
                      <p style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>{r.answer}</p>
                      {r.answeredAt && <p className="w1-ls" style={{ margin: '4px 0 0' }}>{t('answeredOn', { d: ymdKst(r.answeredAt) })}</p>}
                      {(r.status === 'ANSWERED' || r.status === 'CLOSED' || r.feedback === 'UNRESOLVED') && <Msgs ns={['deal']}><InquiryFeedback id={r.id} feedback={r.feedback ?? null} /></Msgs>}</details>
                  : <span className="w1-ls">{t('noAnswer')}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="w1-dact"><Link className="w1-bp" href="/support">{t('newInquiry')}</Link><Link className="w1-bo" href="/support/new">{t('form')}</Link></div>
    </div>
  );
}

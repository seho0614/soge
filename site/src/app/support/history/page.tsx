import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { ymdKst } from '@/lib/format';
import { BackBar } from '@/components/common/BackBar';
import '@/styles/proto-w1.css';

export const metadata: Metadata = { title: '내 문의 내역' };

interface Inquiry {
  id: string; no?: string; category: string; categoryLabel?: string | null; title: string; status: string;
  statusLabel?: string; answer: string | null; createdAt: string; answeredAt?: string | null; channel?: string;
}

/** SB-HOM-CSB-020 — v10.31 시안 scAskList: 표(문의번호 · 제목 · 응대 · 상태 · 접수일 · 최근 답변) + 새 문의 */
export default async function HistoryPage() {
  if (!(await me())) redirect('/login?next=/support/history');
  const rows = await apiGetPersonal<Inquiry[]>('/me/inquiries').catch(() => [] as Inquiry[]);
  return (
    <div className="w1 w1-wrap w1-csb" data-screen="SB-HOM-CSB-020">{/* v10.32 — 시안 .wrap.srcw 폭 · 단추 줄 왼쪽 · 0건이어도 표 모양(빈 줄) */}
      <BackBar href="/support" label="1:1 문의" wrap={false} />
      <div className="w1-aih" style={{ marginTop: 10 }}><h1>내 문의 내역</h1><p>챗봇이 답한 것과 상담원이 답한 것을 함께 봅니다.</p></div>
      <div style={{ overflowX: 'auto', marginTop: 14 }}>
        <table className="w1-tb">
          <thead><tr><th>문의번호</th><th>제목</th><th>응대</th><th>상태</th><th>접수일</th><th>최근 답변</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="w1-ls" style={{ textAlign: 'center', padding: '28px 12px' }}>문의 내역이 없습니다.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id}>
                <td><b style={{ fontFamily: 'var(--mono, monospace)', fontSize: 12 }}>{r.no ?? r.id.slice(0, 8)}</b></td>
                <td><b>{r.title}</b>{r.categoryLabel ? <div className="w1-ls">{r.categoryLabel}</div> : null}</td>
                <td>{r.channel === 'BOT' ? '챗봇 → 상담원' : '상담원'}</td>
                <td>{r.status === 'ANSWERED' || r.status === 'CLOSED' ? <span className="w1-bg ok">{r.statusLabel ?? '답변 완료'}</span> : <span className="w1-bg wait">{r.statusLabel ?? '접수'}</span>}</td>
                <td>{ymdKst(r.createdAt)}</td>
                <td style={{ maxWidth: 320 }}>{r.answer ? r.answer.slice(0, 80) + (r.answer.length > 80 ? '…' : '') : <span className="w1-ls">아직 없음</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="w1-dact"><Link className="w1-bp" href="/support">새 문의</Link><Link className="w1-bo" href="/support/new">문의하기 폼</Link></div>
    </div>
  );
}

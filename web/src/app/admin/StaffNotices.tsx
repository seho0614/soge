import { useApi } from '../../lib/useApi';
import { ymd } from '../../lib/act';

interface StaffNotice { id: string; title: string; body: string; isPinned: boolean; publishedAt: string }

/**
 * v10.279 (D210 · docs/408) — 운영 화면 첫 화면 「관리자 공지」
 *   등급 「관리자」(STAFF)가 들어간 게시 공지만 · 운영 화면 계정만 봄(사용자 웹에는 나오지 않음).
 *   등록은 노출 › 메인 운영 › 「콘텐츠」 › 공지 등록에서 등급 「관리자」를 고름(최고 관리자).
 */
export function StaffNotices() {
  const q = useApi<StaffNotice[]>('/admin/staff-notices');
  const rows = q.data ?? [];
  if (q.error || rows.length === 0) return null;   // 없으면 자리를 차지하지 않음
  return (
    <div className="card pad" data-staff-notices={rows.length} style={{ margin: '0 0 12px' }}>
      <b>관리자 공지</b> <span className="dim">— 운영 화면 계정만 봅니다</span>
      {rows.map((x) => (
        <details key={x.id} data-staff-notice={x.id} style={{ marginTop: 6 }}>
          <summary>{x.isPinned ? '📌 ' : ''}{x.title} <span className="dim">{ymd(x.publishedAt)}</span></summary>
          <p style={{ whiteSpace: 'pre-line', margin: '6px 0 0' }}>{x.body}</p>
        </details>
      ))}
    </div>
  );
}

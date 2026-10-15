import type { Metadata } from 'next';
import Link from 'next/link';
import { ymdKst } from '@/lib/format';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { Bg, Empty, Note, Pgh, Tabs, Tw } from '@/components/partner/ui';
import { ActButton } from '@/components/partner/act';

export const metadata: Metadata = { title: '공지 · 알림' };

interface N {
  id: string; title: string; body: string | null;
  eventCode: string | null; linkUrl: string | null; createdAt: string; readAt: string | null;
  kind?: string; goUrl?: string | null;   /* v10.31 (W5) — 분류 · 「보기」가 갈 화면(서버) */
}
interface Notice { id: string; gwanCode: string | null; title: string; body: string; isPinned: boolean; publishedAt: string | null }

const GWAN: Record<string, string> = { MNY: '소개장터', MAL: '안심소개', BIZ: '소개창업', HLT: '소개몰' };

/**
 * SB-PTC-CTR-700 공지 · 알림 센터 — v10.29 시안 scPtnNoti 배치(탭 「공지사항 · 알림」 → 표 / 알림 줄)
 *
 * 정책이 바뀌면 여기에 남습니다. 알림톡은 놓칠 수 있지만 **이 목록은 남아 있어야** "못 들었다" 는 분쟁을 줄입니다.
 *   공지사항 = GET /notices (본사 공지) · 알림 = GET /partner/notices (내 알림)
 * v10.31 (W5 · 10/10 시안 기준) — 알림 분류(리드 · 검수 · 리드 이용료 · 정산 · 공지) · 「보기」의 화면 이동(분류별) · 「모두 읽음」(POST /partner/notices/read-all).
 */
export default async function NoticesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const p = await me();
  if (!p) redirect('/login');
  const sp = await searchParams;
  const tab = sp.tab === 'alarm' ? 'alarm' : 'notice';

  const [rows, notices] = await Promise.all([
    apiGet<N[]>('/partner/notices', 0).catch(() => [] as N[]),
    apiGet<Notice[]>('/notices', 60).catch(() => [] as Notice[]),
  ]);
  const unread = rows.filter((r) => !r.readAt).length;

  return (
    <><Pgh title="공지 · 알림" sub={unread > 0 ? <>본사 공지와 내 알림입니다. 읽지 않은 알림이 <b>{unread}건</b> 있습니다.</> : '본사 공지와 내 알림입니다.'} />
      <Tabs cur={tab} items={[
        { key: 'notice', label: '공지사항', count: notices.length, href: '/partner/notices' },
        { key: 'alarm', label: '알림', count: unread, href: '/partner/notices?tab=alarm' },
      ]} />

      {tab === 'notice' ? (
        notices.length === 0 ? <Empty>등록된 공지가 없습니다.</Empty> : (
          <Tw head={['제목', '분류', '등록일']}>
            {notices.map((x) => (
              <tr key={x.id}>
                <td>{x.isPinned ? <><Bg tone="no">필독</Bg> </> : null}<b>{x.title}</b>
                  {x.body ? <details><summary className="pt-ls">내용 보기</summary><p className="pt-ls" style={{ whiteSpace: 'pre-wrap' }}>{x.body}</p></details> : null}
                </td>
                <td>{x.gwanCode ? GWAN[x.gwanCode] ?? x.gwanCode : '전체'}</td>
                <td>{x.publishedAt ? ymdKst(x.publishedAt) : '—'}</td>
              </tr>
            ))}
          </Tw>
        )
      ) : rows.length === 0 ? (
        <Empty>아직 받은 알림이 없습니다.</Empty>
      ) : (
        <div className="notice-list">
          {rows.map((n) => (
            <div key={n.id} className={`pt-lrow${n.readAt ? ' read' : ' unread'}`}>
              <div className="lt">
                <div className="lh">
                  <span className="pt-ck">{n.kind ?? '공지'}</span>
                  {n.readAt ? <Bg tone="off">읽음</Bg> : <Bg tone="wait">안 읽음</Bg>}
                </div>
                <b>{n.title}</b>
                <span className="pt-ls">{ymdKst(n.createdAt)}{n.body ? ` · ${n.body}` : ''}</span>
              </div>
              <div />
              <div className="pt-lact">
                {/* v10.27 (G-130) — 그 알림의 화면으로. 사이트 안 주소만(바깥 주소 · // 로 시작하는 것은 그리지 않음) */}
                {(() => { const go = n.goUrl ?? n.linkUrl; return go && /^\/(?![\/\\])/.test(go)
                  ? <Link className="pt-bo sm nt-go" href={go} data-ntgo="">보기</Link> : null; })()}
              </div>
            </div>
          ))}
          {unread > 0 && <div className="pt-dact"><ActButton url="/partner/notices/read-all" label="모두 읽음" done="모두 읽음으로 표시했습니다." /></div>}
        </div>
      )}

      <Note kind="info">
        <b>알림톡을 놓치셔도 여기 남습니다.</b> 정책 변경과 청구 안내는 이 목록에서 다시 확인하실 수 있습니다.
      </Note>
    <i hidden data-root-end="" /></>
  );
}

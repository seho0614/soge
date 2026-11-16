/**
 * v10.320 (docs/446) 소개광장 › 「공지」 탭 · 「전체」 탭 맨 위 — 운영 화면 「공지 등록」에서 쓴 공지(GET /notices · 보는 사람 등급 기준).
 *   공지는 한 곳(운영 화면)에서만 씁니다 — 소개광장 · 고객센터 › 공지사항 · 메인 띠 · 회원 알림이 같은 공지를 보여 줍니다.
 *   full: 펼치기 · 첨부 · 「새 글」 · 읽음 기록(고객센터와 같은 부품 NoticeDetails · NoticeFiles) — 주소 #n-<id> 로 그 공지
 *   pinned: 「상단 고정」만 최대 2줄(메인 띠와 같은 기준) → 「공지」 탭의 그 공지로
 */
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { NoticeDetails } from '@/components/common/NoticeDetails';
import { NoticeFiles, type NoticeFile } from '@/components/common/NoticeFiles';

export interface PlazaNotice { id: string; title: string; body: string; isPinned: boolean; publishedAt: string | null; unread?: boolean; files?: NoticeFile[] }
export const PLAZA_PINNED_MAX = 2;
export const plazaNoticeHref = (id?: string) => `/community?board=NOTICE${id ? `#n-${id}` : ''}`;

export async function PlazaNotices({ rows, login, mode }: { rows: PlazaNotice[]; login: boolean; mode: 'full' | 'pinned' }) {
  const t = await getTranslations('plaza');
  const s = await getTranslations('deal.support');
  if (mode === 'pinned') {
    const pins = rows.filter((n) => n.isPinned).slice(0, PLAZA_PINNED_MAX);
    if (!pins.length) return null;
    return (
      <ul className="plz-ntcp" aria-label={t('ntc.pinnedAria')} data-plaza-pinned={pins.length}>
        {pins.map((n) => (
          <li key={n.id}><Link href={plazaNoticeHref(n.id)} data-plaza-pin={n.id}>
            <span className="plz-pin">{t('ntc.badge')}</span> <b>{n.title}</b> <span className="dim">{String(n.publishedAt ?? '').slice(0, 10)}</span>
          </Link></li>
        ))}
      </ul>
    );
  }
  return (
    <section className="plz-ntc" aria-labelledby="plz-ntc-h" data-plaza-notices={rows.length}>
      <h2 id="plz-ntc-h" className="plz-ntch">{t('ntc.h')}</h2>
      {rows.length === 0 ? <p className="plz-empty" data-plaza-notices-empty>{t('ntc.empty')}</p> : (
        <ul className="plz-ntcl">
          {rows.map((n) => (
            <li key={n.id} id={`n-${n.id}`} className="card" data-plaza-notice={n.id}>
              <NoticeDetails id={n.id} unread={n.unread === true} newLabel={s('ntcNew')} login={login} summary={<>
                {n.isPinned && <span className="plz-pin">{s('ntcPinned')}</span>} <strong>{n.title}</strong>{' '}
                <span className="dim">{String(n.publishedAt ?? '').slice(0, 10)}</span>
              </>}>
                <p style={{ whiteSpace: 'pre-line' }}>{n.body}</p>
                <NoticeFiles id={n.id} files={n.files} label={s('ntcFiles')} />
              </NoticeDetails>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

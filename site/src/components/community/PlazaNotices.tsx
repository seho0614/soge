/**
 * v10.320 (docs/446) 소개광장 › 「공지」 탭 · 「전체」 탭 맨 위 — 운영 화면 「공지 등록」에서 쓴 공지(GET /notices · 보는 사람 등급 기준).
 *   공지는 한 곳(운영 화면)에서만 씁니다 — 소개광장 · 고객센터 › 공지사항 · 메인 띠 · 회원 알림이 같은 공지를 보여 줍니다.
 *   full: 펼치기 · 첨부 · 「새 글」 · 읽음 기록(고객센터와 같은 부품 NoticeDetails · NoticeFiles) — 주소 #n-<id> 로 그 공지
 *   pinned: 「상단 고정」만 최대 2줄(메인 띠와 같은 기준) → 「공지」 탭의 그 공지로
 *   v10.324 (docs/451) 찾기 칸(nq · 제목 · 본문) · 30개씩 「지난 공지 더 보기」(np) — 고정 공지는 앞 쪽에 먼저
 *   v10.323 고침 — 로그인 안 하면 「로그인하면 회원 공지도」 안내(옛 고객센터 › 공지사항과 같음 · data-notice-login)
 *   v10.327 (docs/455) #n-<id> 공지가 이 쪽에 없으면(30개 밖) 한 건만 불러 「지난 공지」로 펼친 채(NoticeHashOpen)
 *   v10.322 (D222 · docs/449) 고정 줄에도 「새 글」 · 공지 탭 「모두 읽음」(로그인 · 안 읽은 공지가 있을 때) · #n-<id> 로 오면 그 공지를 펼친 채(NoticeDetails)
 */
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { NoticeDetails } from '@/components/common/NoticeDetails';
import { NoticeFiles, type NoticeFile } from '@/components/common/NoticeFiles';
import { PlazaReadAll } from './PlazaReadAll';
import { NoticeHashOpen } from '@/components/common/NoticeHashOpen';

export interface PlazaNotice { id: string; title: string; body: string; isPinned: boolean; publishedAt: string | null; unread?: boolean; files?: NoticeFile[] }
export const PLAZA_PINNED_MAX = 2;
export const plazaNoticeHref = (id?: string) => `/community?board=NOTICE${id ? `#n-${id}` : ''}`;
export const PLAZA_NOTICE_PAGE = 30;
const ntcListHref = (nq: string, np: number) => {
  const p = new URLSearchParams({ board: 'NOTICE' });
  if (nq) p.set('nq', nq);
  if (np > 1) p.set('np', String(np));
  return `/community?${p}`;
};

export async function PlazaNotices({ rows, login, mode, nq = '', np = 1 }: { rows: PlazaNotice[]; login: boolean; mode: 'full' | 'pinned'; nq?: string; np?: number }) {
  const t = await getTranslations('plaza');
  const s = await getTranslations('deal.support');
  if (mode === 'pinned') {
    const pins = rows.filter((n) => n.isPinned).slice(0, PLAZA_PINNED_MAX);
    if (!pins.length) return null;
    return (
      <ul className="plz-ntcp" aria-label={t('ntc.pinnedAria')} data-plaza-pinned={pins.length}>
        {pins.map((n) => (
          <li key={n.id}><Link href={plazaNoticeHref(n.id)} data-plaza-pin={n.id}>
            <span className="plz-pin">{t('ntc.badge')}</span> {n.unread === true && <><span className="nt-new" data-plaza-pin-new>{s('ntcNew')}</span>{' '}</>}<b>{n.title}</b> <span className="dim">{String(n.publishedAt ?? '').slice(0, 10)}</span>
          </Link></li>
        ))}
      </ul>
    );
  }
  return (
    <section className="plz-ntc" aria-labelledby="plz-ntc-h" data-plaza-notices={rows.length}>
      <h2 id="plz-ntc-h" className="plz-ntch">{t('ntc.h')}{login && rows.some((n) => n.unread === true) && <>{' '}<PlazaReadAll label={t('ntc.readAll')} failLabel={t('ntc.readAllFail')} /></>}</h2>
      {!login && <p className="w1-nt" data-notice-login><Link href={`/login?next=${encodeURIComponent('/community?board=NOTICE')}`}>{s('ntcLogin')}</Link></p>}
      <form className="plz-ntcq" action="/community" method="get" role="search" data-plaza-notice-search={nq}>
        <input type="hidden" name="board" value="NOTICE" />
        <input type="search" name="nq" defaultValue={nq} maxLength={100} placeholder={t('ntc.qPh')} aria-label={t('ntc.qAria')} />
        <button type="submit" className="btn btn-sm">{t('ntc.qGo')}</button>
        {nq && <Link href="/community?board=NOTICE" data-plaza-notice-search-clear>{t('ntc.qClear')}</Link>}
      </form>
      <NoticeHashOpen shown={rows.map((n) => n.id)} login={login} labels={{ old: t('ntc.oldOne'), isNew: s('ntcNew'), files: s('ntcFiles'), gone: t('ntc.gone') }} />
      {rows.length === 0 ? <p className="plz-empty" data-plaza-notices-empty>{nq ? t('ntc.qEmpty', { q: nq }) : np > 1 ? t('ntc.pageEmpty') : t('ntc.empty')}</p> : (
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
      {(np > 1 || rows.length >= PLAZA_NOTICE_PAGE) && (
        <nav className="plz-ntcpg" aria-label={t('ntc.pager')} data-plaza-notice-pager={np}>
          {np > 1 && <Link href={ntcListHref(nq, np - 1)} data-plaza-notice-newer>{t('ntc.newer')}</Link>}
          {rows.length >= PLAZA_NOTICE_PAGE && <Link href={ntcListHref(nq, np + 1)} data-plaza-notice-older>{t('ntc.older')}</Link>}
        </nav>
      )}
    </section>
  );
}

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { AgreeForm } from './AgreeForm';
import { OptionalConsents } from './OptionalConsents';
import { NoticeTerms } from '@/components/NoticeTerms';
import { UpcomingTerms } from '@/components/UpcomingTerms';
import '@/styles/proto-w1.css';
import { getTranslations } from 'next-intl/server';
import { Msgs } from '@/i18n/Msgs';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('policy'))('meta.agree') };
}

interface Term {
  code: string; title: string; version: string;
  isRequired: boolean; agreed: boolean; effectiveFrom: string | null;
  /** v10.28 (G-214) */ changedAt?: string | null; oldVersion?: boolean;
  /** v10.28 (재동의) */ agreedVersion?: string | null; changeNote?: string | null;
}

type Props = { searchParams: Promise<{ next?: string | string[] }> };

/** 동의 뒤 돌아갈 주소 — 우리 사이트 안의 경로만(로그인 화면과 같은 규칙) */
function safeNext(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  if (typeof s !== 'string' || s.length === 0 || s.length > 500) return null;
  if (!s.startsWith('/') || s.startsWith('//') || s.includes('\\') || s.includes('://')) return null;
  if (/[\u0000-\u001f]/.test(s)) return null;
  if (s.startsWith('/terms/agree')) return null;
  return s;
}

/**
 * SB-HOM-ETC-022 약관 동의 · 재동의(v10.28 — 전에는 ETC-020 으로 적혀 있었으나 그 ID 는 「푸터 · 약관 · 법정고지」)
 *
 * **발행된 것만 보여 줍니다.** 초안에 동의를 받으면 나중에 본문이
 * 바뀌어 "무엇에 동의했는가"를 답할 수 없습니다.
 *
 * 개인화 응답이라 apiGetPersonal 을 씁니다 — apiGet 은 캐시 키에
 * 쿠키가 없어 남의 동의 상태가 보일 수 있습니다.
 */
export default async function AgreePage({ searchParams }: Props) {
  const t = await getTranslations('policy');
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const p = await me();
  if (!p) redirect(next ? `/login?next=${encodeURIComponent('/terms/agree?next=' + next)}` : '/login');

  const terms = await apiGetPersonal<Term[]>('/terms/required').catch(() => []);
  const pending = terms.filter((t) => t.isRequired && !t.agreed);
  /* v10.28 (재동의 · 10/9 답) — 필수 약관에 동의하지 않은 채로 로그인이 필요한 화면을 열면 여기로 옵니다(미들웨어 · 로그인 직후). */

  return (
    <><main className="main" data-screen="SB-HOM-ETC-022">
      <div className="page-head">
        <h1>{t('agree.title')}</h1>
        <p className="hint">
          {pending.length > 0
            ? t('agree.pendingN', { n: String(pending.length) })
            : t('agree.allDone')}
        </p>
      </div>

      {/* v10.161 (D151) — 시행 예정 약관(시행일부터 다시 동의) */}
      <UpcomingTerms />
      {pending.length > 0 && (
        <div className="notice notice-act" data-reconsent>
          <div>
            <strong>{pending.some((x) => x.agreedVersion) ? t('agree.changed') : t('agree.needed')}</strong>
            <p>{t('agree.neededBody')}</p>
          </div>
        </div>
      )}
      {/* v10.32 — 시안처럼 맨 위에 띠 · 판 비교 표를 늘 둡니다. 동의할 것이 없으면 초록 띠 · 필수 약관 전체의 판(서버 값) */}
      {pending.length === 0 && terms.length > 0 && (
        <div className="notice notice-ok" data-reconsent-none="">
          <div><strong>{t('agree.okTitle')}</strong>
            <p>{t('agree.okBody')}</p></div>
        </div>
      )}
      {pending.length === 0 && terms.some((t) => t.isRequired) && (
        <table className="tbl" data-reconsent-table="all">
          <thead><tr><th>{t('agree.colTerm')}</th><th>{t('agree.colAgreed')}</th><th>{t('agree.colNow')}</th><th>{t('agree.colChange')}</th></tr></thead>
          <tbody>{terms.filter((x) => x.isRequired).map((x) => (
            <tr key={x.code} data-terms-row={x.code}>
              <td>{x.title}</td>
              <td>{x.agreedVersion ?? (x.agreed ? x.version : '—')}</td>
              <td><b>{x.version}</b></td>
              <td>{x.changeNote ?? '—'}</td>
            </tr>))}</tbody>
        </table>
      )}
      {pending.length > 0 && (
        <table className="tbl" data-reconsent-table>
          <thead><tr><th>{t('agree.colTerm')}</th><th>{t('agree.colAgreed')}</th><th>{t('agree.colNow')}</th><th>{t('agree.colChange')}</th></tr></thead>
          <tbody>{pending.map((x) => (
            <tr key={x.code} data-reconsent-row={x.code}>
              <td>{x.title}</td>
              <td>{x.agreedVersion ?? '—'}</td>
              <td>{x.version}</td>
              <td>{x.changeNote ?? (x.agreedVersion ? '—' : t('agree.first'))}</td>
            </tr>))}</tbody>
        </table>
      )}

      {terms.length === 0 ? (
        <div className="notice">
          {t.rich('agree.none', { b: (c) => <b>{c}</b> })}
        </div>
      ) : (<>
        {/* v10.28 (G-214) — 필수 약관에 모두 동의한 회원은 선택 항목을 바로 켜고 끕니다(바꾼 기록이 쌓임) */}
        {/* v10.102 2-5c — 두 브라우저 부품이 화면 전용 사전(policy)을 씁니다 */}
        <Msgs ns={['policy']}>
        <AgreeForm terms={terms} next={next} />
        {/* v10.32 — 시안 순서: 필수 · 동의하고 계속 → 선택 항목 바꾸기 */}
        {pending.length === 0 && <OptionalConsents terms={terms} />}
        </Msgs>
        {/* v10.28 (G-218) — 위탁 안내는 동의 칸이 아니라 알림 링크 */}
        <NoticeTerms />
      </>)}

      <div className="notice">
        {t.rich('agree.logged', { b: (c) => <b>{c}</b> })}
      </div>

      <div className="notice">
        {t.rich('agree.optAnytime', { b: (c) => <b>{c}</b> })}
      </div>
    </main><i hidden data-root-end="" /></>
  );
}

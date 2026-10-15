import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { AgreeForm } from './AgreeForm';
import { OptionalConsents } from './OptionalConsents';
import { NoticeTerms } from '@/components/NoticeTerms';
import '@/styles/proto-w1.css';

export const metadata: Metadata = { title: '약관 동의' };

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
        <h1>약관 동의</h1>
        <p className="hint">
          {pending.length > 0
            ? `동의가 필요한 필수 약관이 ${pending.length}건 있습니다.`
            : '필수 약관에 모두 동의하셨습니다.'}
        </p>
      </div>

      {pending.length > 0 && (
        <div className="notice notice-act" data-reconsent>
          <div>
            <strong>{pending.some((t) => t.agreedVersion) ? '약관이 바뀌었습니다' : '약관 동의가 필요합니다'}</strong>
            <p>필수 약관에 동의하셔야 로그인이 필요한 기능을 쓰실 수 있습니다. 둘러보기 · 약관 보기 · 로그아웃은 그대로 됩니다.
              선택 항목(마케팅 · 맞춤형 광고 · 야간 광고)은 지금 상태 그대로입니다.</p>
          </div>
        </div>
      )}
      {/* v10.32 — 시안처럼 맨 위에 띠 · 판 비교 표를 늘 둡니다. 동의할 것이 없으면 초록 띠 · 필수 약관 전체의 판(서버 값) */}
      {pending.length === 0 && terms.length > 0 && (
        <div className="notice notice-ok" data-reconsent-none="">
          <div><strong>필수 약관에 모두 동의하셨습니다</strong>
            <p>지금 판 그대로 동의되어 있습니다. 약관이 바뀌면 이 자리에 바뀐 점이 나오고 다시 동의를 받습니다.</p></div>
        </div>
      )}
      {pending.length === 0 && terms.some((t) => t.isRequired) && (
        <table className="tbl" data-reconsent-table="all">
          <thead><tr><th>약관</th><th>동의하신 판</th><th>지금 판</th><th>바뀐 점</th></tr></thead>
          <tbody>{terms.filter((t) => t.isRequired).map((t) => (
            <tr key={t.code} data-terms-row={t.code}>
              <td>{t.title}</td>
              <td>{t.agreedVersion ?? (t.agreed ? t.version : '—')}</td>
              <td><b>{t.version}</b></td>
              <td>{t.changeNote ?? '—'}</td>
            </tr>))}</tbody>
        </table>
      )}
      {pending.length > 0 && (
        <table className="tbl" data-reconsent-table>
          <thead><tr><th>약관</th><th>동의하신 판</th><th>지금 판</th><th>바뀐 점</th></tr></thead>
          <tbody>{pending.map((t) => (
            <tr key={t.code} data-reconsent-row={t.code}>
              <td>{t.title}</td>
              <td>{t.agreedVersion ?? '—'}</td>
              <td>{t.version}</td>
              <td>{t.changeNote ?? (t.agreedVersion ? '—' : '처음 동의')}</td>
            </tr>))}</tbody>
        </table>
      )}

      {terms.length === 0 ? (
        <div className="notice">
          <b>아직 발행된 약관이 없습니다.</b> 발행 전에는 동의를 받지 않습니다 —
          초안에 동의하시면 나중에 본문이 바뀌었을 때
          무엇에 동의하셨는지 확인할 수 없습니다.
        </div>
      ) : (<>
        {/* v10.28 (G-214) — 필수 약관에 모두 동의한 회원은 선택 항목을 바로 켜고 끕니다(바꾼 기록이 쌓임) */}
        <AgreeForm terms={terms} next={next} />
        {/* v10.32 — 시안 순서: 필수 · 동의하고 계속 → 선택 항목 바꾸기 */}
        {pending.length === 0 && <OptionalConsents terms={terms} />}
        {/* v10.28 (G-218) — 위탁 안내는 동의 칸이 아니라 알림 링크 */}
        <NoticeTerms />
      </>)}

      <div className="notice">
        <b>동의 시각이 기록됩니다.</b> 나중에 &ldquo;동의한 적 없다&rdquo;는
        다툼이 생기면 이 기록이 근거가 됩니다.
      </div>

      <div className="notice">
        <b>선택 항목은 언제든 바꾸실 수 있습니다.</b> 마케팅 수신과 성향 기반
        광고는 필수가 아니며, 철회하셔도 서비스 이용에 영향이 없습니다.
      </div>
    </main><i hidden data-root-end="" /></>
  );
}

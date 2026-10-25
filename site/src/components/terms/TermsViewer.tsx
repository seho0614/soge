/**
 * v10.31 — 시안 termsv 「약관 전문」: 약관 탭(칩) · 선택한 약관의 판 · 시행일 · 조항 목록 · 본문(마크다운을 그려서).
 *   목록은 GET /terms/index(유효 · 시행 예정 · 폐기), 본문은 GET /terms/doc/{code}. 폐기된 약관은 탭에서 흐리게 · 본문 대신 안내.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useFmt } from '@/lib/useFmt';
import type { Fmt } from '@/lib/fmtBind';
import { ymdKst } from '@/lib/format';
import { BackBar } from '@/components/common/BackBar';
import { Markdown, toc } from './Markdown';

export interface TermIndex { code: string; version: string; title: string; status: string; isRequired: boolean; isNotice: boolean; effectiveFrom: string | null; scheduled: boolean }
export interface TermDoc { code: string; version: string; title: string; body: string; isRequired: boolean; effectiveFrom?: string; scheduled?: boolean; isNotice?: boolean }

/* 시안 이용안내 표의 순서 */
const ORDER = ['SERVICE', 'PRIVACY', 'REFUND', 'THIRDPARTY', 'OUTSOURCE', 'HLT_SALE', 'ADPERSONAL', 'MARKETING', 'MARKETING_NIGHT', 'LOCATION'];
export function sortTerms<T extends { code: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => (ORDER.indexOf(a.code) + 1 || 99) - (ORDER.indexOf(b.code) + 1 || 99));
}
/* v10.102 2-5c — 글자는 사전 policy.state.* · 날짜는 f.ymd(ko 는 ymdKst 그대로) */
export type PolicyT = ReturnType<typeof useTranslations<'policy'>>;
export function termState(t: TermIndex, tr: PolicyT, f: Fmt): string {
  if (t.status === 'ARCHIVED') return t.code === 'LOCATION' ? tr('state.archivedLocation') : tr('state.archived');
  const when = t.effectiveFrom ? f.ymd(t.effectiveFrom, ymdKst(t.effectiveFrom)) : '';
  if (t.scheduled) return tr('state.scheduled', { when });
  if (t.isNotice) return tr('state.notice');
  if (t.code === 'HLT_SALE') return tr('state.direct');
  return `${tr('state.effective', { when })}${t.isRequired ? '' : tr('state.optional')}`;
}

/**
 * v10.32 (추가) — 시안 scTerms(terms · termsv 같은 그림): 제목은 /terms 이면 「약관 · 법정 고지」(SB-HOM-ETC-020), /terms/{코드} 이면 「약관 전문」(SB-HOM-ETC-021).
 *   배치는 시안처럼 칩 아래 **한 카드**(약관 이름 · 판 · 시행일 → 조 목록 → 본문). 전: 왼쪽 조 목차 칸 + 오른쪽 본문 카드 두 칸.
 *   본문 · 판 · 시행일 · 조 목록 이동(개발 기능)은 그대로 둡니다. 폭도 시안 wrap(1240)으로.
 */
export function TermsViewer({ list, doc, code, index = false }: { list: TermIndex[]; doc: TermDoc | null; code: string; index?: boolean }) {
  const tr = useTranslations('policy');
  const f = useFmt();
  const terms = sortTerms(list);
  const cur = terms.find((t) => t.code === code.toUpperCase());
  const items = doc?.body ? toc(doc.body) : [];
  return (
    <div className="w1 w1-wrap" data-screen={index ? 'SB-HOM-ETC-020' : 'SB-HOM-ETC-021'}>
      <BackBar href="/guide" label={tr('viewer.back')} wrap={false} />
      <div className="w1-aih" style={{ marginTop: 10 }}>
        <h1>{index ? tr('viewer.titleIndex') : tr('viewer.titleDoc')}</h1>
        <p>{index ? tr('viewer.leadIndex') : ''}{tr('viewer.lead')}</p>
      </div>
      <nav className="w1-tchips" aria-label={tr('viewer.chipsAria')}>
        {terms.map((t) => (
          <Link key={t.code} href={`/terms/${t.code}`} className={`${t.code === cur?.code ? 'on' : ''}${t.status === 'ARCHIVED' ? ' off' : ''}`.trim() || undefined}
            aria-current={t.code === cur?.code ? 'page' : undefined}
            {...(t.isNotice ? { 'data-notice-chip': '', title: tr('viewer.noticeChip') } : {})}>{t.title}{t.isNotice ? tr('viewer.noticeSuffix') : ''}</Link>
        ))}
      </nav>
      {!doc ? (
        <div className="w1-panel" style={{ padding: 20 }}>
          <b>{cur?.title ?? tr('viewer.fallbackTitle')}</b>
          <p className="w1-ls">{cur ? termState(cur, tr, f) : tr('viewer.notFound')}{cur?.status === 'ARCHIVED' ? tr('viewer.archivedNote') : ''}</p>
        </div>
      ) : (
        <section className="w1-tcard">
          <b>{doc.title}</b>
          <span className="doc-meta">{tr('viewer.version', { v: doc.version })}{doc.isRequired ? tr('viewer.required') : ''}{doc.isNotice ? <> · <span data-term-notice="">{tr('viewer.noticeMeta')}</span></> : ''}
            {doc.effectiveFrom ? tr(doc.scheduled ? 'viewer.scheduled' : 'viewer.effective', { date: f.ymd(doc.effectiveFrom, ymdKst(doc.effectiveFrom)) }) : ''}</span>
          {items.length > 0 && <ol className="w1-tjo">{items.map((x) => <li key={x.id}><a href={`#${x.id}`}>{x.text}</a></li>)}</ol>}
          {/* v10.102 — 약관 본문은 한국어만(서버 · 마크다운). 다른 언어 화면에는 「한국어판이 우선」 한 줄 */}
          {!f.ko && <p className="w1-ls" data-terms-lang="">{tr('viewer.koOnly')}</p>}
          <article className="doc-body" data-terms-body="1">
            {doc.body ? <Markdown text={doc.body} /> : <p className="w1-ls">{tr('viewer.empty')}</p>}
          </article>
        </section>
      )}
    </div>
  );
}

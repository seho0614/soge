/**
 * v10.31 — 시안 termsv 「약관 전문」: 약관 탭(칩) · 선택한 약관의 판 · 시행일 · 조항 목록 · 본문(마크다운을 그려서).
 *   목록은 GET /terms/index(유효 · 시행 예정 · 폐기), 본문은 GET /terms/doc/{code}. 폐기된 약관은 탭에서 흐리게 · 본문 대신 안내.
 */
import Link from 'next/link';
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
export function termState(t: TermIndex): string {
  if (t.status === 'ARCHIVED') return t.code === 'LOCATION' ? '폐기 · 단말기 위치 미수집' : '폐기';
  const when = t.effectiveFrom ? ymdKst(t.effectiveFrom) : '';
  if (t.scheduled) return `발행 · ${when} 시행 예정`;
  if (t.isNotice) return '발행 · 알림(동의 받지 않음)';
  if (t.code === 'HLT_SALE') return '발행 · 직판(통신판매업자)';
  return `발행 · ${when} 시행${t.isRequired ? '' : ' · 선택'}`;
}

/**
 * v10.32 (추가) — 시안 scTerms(terms · termsv 같은 그림): 제목은 /terms 이면 「약관 · 법정 고지」(SB-HOM-ETC-020), /terms/{코드} 이면 「약관 전문」(SB-HOM-ETC-021).
 *   배치는 시안처럼 칩 아래 **한 카드**(약관 이름 · 판 · 시행일 → 조 목록 → 본문). 전: 왼쪽 조 목차 칸 + 오른쪽 본문 카드 두 칸.
 *   본문 · 판 · 시행일 · 조 목록 이동(개발 기능)은 그대로 둡니다. 폭도 시안 wrap(1240)으로.
 */
export function TermsViewer({ list, doc, code, index = false }: { list: TermIndex[]; doc: TermDoc | null; code: string; index?: boolean }) {
  const terms = sortTerms(list);
  const cur = terms.find((t) => t.code === code.toUpperCase());
  const items = doc?.body ? toc(doc.body) : [];
  return (
    <div className="w1 w1-wrap" data-screen={index ? 'SB-HOM-ETC-020' : 'SB-HOM-ETC-021'}>
      <BackBar href="/guide" label="이용안내" wrap={false} />
      <div className="w1-aih" style={{ marginTop: 10 }}>
        <h1>{index ? '약관 · 법정 고지' : '약관 전문'}</h1>
        <p>{index ? '사업자 정보 · 통신판매중개자 고지는 화면 맨 아래 바닥줄에 있습니다. ' : ''}발행된 약관입니다. 판 번호 · 시행일이 함께 나옵니다.</p>
      </div>
      <nav className="w1-tchips" aria-label="약관 고르기">
        {terms.map((t) => (
          <Link key={t.code} href={`/terms/${t.code}`} className={`${t.code === cur?.code ? 'on' : ''}${t.status === 'ARCHIVED' ? ' off' : ''}`.trim() || undefined}
            aria-current={t.code === cur?.code ? 'page' : undefined}
            {...(t.isNotice ? { 'data-notice-chip': '', title: '알림 · 동의 받지 않음' } : {})}>{t.title}{t.isNotice ? ' (알림)' : ''}</Link>
        ))}
      </nav>
      {!doc ? (
        <div className="w1-panel" style={{ padding: 20 }}>
          <b>{cur?.title ?? '약관'}</b>
          <p className="w1-ls">{cur ? termState(cur) : '없는 약관입니다.'}{cur?.status === 'ARCHIVED' ? ' — 지금은 쓰지 않는 약관이라 전문을 싣지 않습니다.' : ''}</p>
        </div>
      ) : (
        <section className="w1-tcard">
          <b>{doc.title}</b>
          <span className="doc-meta">판 {doc.version}{doc.isRequired ? ' · 필수 동의' : ''}{doc.isNotice ? <> · <span data-term-notice="">알림(동의를 받지 않는 안내)</span></> : ''}
            {doc.effectiveFrom ? ` · ${ymdKst(doc.effectiveFrom)} ${doc.scheduled ? '시행 예정' : '시행'}` : ''}</span>
          {items.length > 0 && <ol className="w1-tjo">{items.map((x) => <li key={x.id}><a href={`#${x.id}`}>{x.text}</a></li>)}</ol>}
          <article className="doc-body" data-terms-body="1">
            {doc.body ? <Markdown text={doc.body} /> : <p className="w1-ls">아직 작성되지 않았습니다.</p>}
          </article>
        </section>
      )}
    </div>
  );
}

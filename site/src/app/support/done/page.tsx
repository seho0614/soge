import type { Metadata } from 'next';
import Link from 'next/link';
import { dtKst } from '@/lib/format';
import { getTranslations } from 'next-intl/server';
import '@/styles/proto-w1.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('deal.meta'))('supportDone') };
}

/**
 * SB-HOM-ETC-031 접수 완료 — v10.31 시안 scCsDone: 체크 · 「문의가 접수되었습니다」 · 접수번호 · 유형 · 답변 예정 시각 ·
 *   4단계(접수 · 담당 배정 · 답변 작성 · 발송) · 답변이 늦어지는 경우 · 문의 내역 보기 / 메인으로.
 *   값은 접수 응답(POST /inquiries — no · categoryLabel · dueAt)을 주소로 넘겨받습니다(문의 내용은 주소에 싣지 않음).
 */
export default async function DonePage({ searchParams }: { searchParams: Promise<{ no?: string; cat?: string; due?: string }> }) {
  const sp = await searchParams;
  const no = /^Q-\d{8}-[0-9A-F]{4}$/.test(sp.no ?? '') ? sp.no! : null;
  /* v10.32 (추가) — 시안 「2026년 8월 27일 14:00까지 답변드립니다」 글꼴(서버 dueAt = 접수 시각 + 영업일 1일). 값이 없으면(주소로 바로 연 경우) 전 문구 */
  const dk = sp.due && !Number.isNaN(Date.parse(sp.due)) ? dtKst(sp.due) : '';
  const due = dk ? `${Number(dk.slice(0, 4))}년 ${Number(dk.slice(5, 7))}월 ${Number(dk.slice(8, 10))}일 ${dk.slice(11)}` : null;
  const t = await getTranslations('deal.support');
  /* v10.101 — 단계 · 상태 이름은 사전 키(deal.support.steps.* · stepState.*) */
  const steps = [['received', 'done', 'dn'], ['assign', 'doing', 'on'], ['write', 'wait', ''], ['send', 'wait', '']] as const;
  return (
    <div className="w1 w1-wrap" data-screen="SB-HOM-ETC-031" style={{ maxWidth: 760 }}>
      <div className="w1-done" style={{ marginTop: 16 }}>
        <div className="dic" aria-hidden="true">✓</div>
        <h1>{t('doneTitle')}</h1>
        <p>{no ? <>{t('doneNo')} <b style={{ fontFamily: 'var(--mono, monospace)' }}>{no}</b>{sp.cat ? <> · {t('doneCat')} <b>{sp.cat.slice(0, 20)}</b></> : null}<br /></> : null}
          {due ? <>{t.rich('doneDue', { due, b: (x) => <b>{x}</b> })}</> : t('doneDueDefault')}{t('doneMail')}</p>
        <div className="w1-dst">
          {steps.map(([b, s, c]) => <div key={b} className={`w1-d1 ${c}`}><b>{t(`steps.${b}`)}</b><span>{t(`stepState.${s}`)}</span></div>)}
        </div>
        <div className="w1-nt" style={{ textAlign: 'left', marginTop: 18 }}>{t.rich('late', { b: (x) => <b>{x}</b>, br: () => <br /> })}</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 18 }}>
          <Link className="w1-bo" href="/support/history">{t('viewHistory')}</Link>
          <Link className="w1-bor" href="/" style={{ padding: '9px 16px', fontSize: 14 }}>{t('toMain')}</Link>{/* v10.32 — 시안 주황 */}
        </div>
      </div>
    </div>
  );
}

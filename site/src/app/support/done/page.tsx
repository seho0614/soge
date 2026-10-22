import type { Metadata } from 'next';
import Link from 'next/link';
import { dtKst } from '@/lib/format';
import '@/styles/proto-w1.css';

export const metadata: Metadata = { title: '문의 접수 완료' };

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
  const steps: Array<[string, string, string]> = [['접수', '완료', 'dn'], ['담당 배정', '진행 중', 'on'], ['답변 작성', '대기', ''], ['발송', '대기', '']];
  return (
    <div className="w1 w1-wrap" data-screen="SB-HOM-ETC-031" style={{ maxWidth: 760 }}>
      <div className="w1-done" style={{ marginTop: 16 }}>
        <div className="dic" aria-hidden="true">✓</div>
        <h1>문의가 접수되었습니다</h1>
        <p>{no ? <>접수번호 <b style={{ fontFamily: 'var(--mono, monospace)' }}>{no}</b>{sp.cat ? <> · 유형 <b>{sp.cat.slice(0, 20)}</b></> : null}<br /></> : null}
          {due ? <><b>{due}</b>까지 답변드립니다. </> : '영업일 기준 1일 이내에 답변드립니다. '}등록하신 이메일로 발송됩니다.</p>
        <div className="w1-dst">
          {steps.map(([b, s, c]) => <div key={b} className={`w1-d1 ${c}`}><b>{b}</b><span>{s}</span></div>)}
        </div>
        <div className="w1-nt" style={{ textAlign: 'left', marginTop: 18 }}><b>답변이 늦어지는 경우</b><br />
          사업자 인증 · 정산 관련 문의는 확인에 시간이 더 걸릴 수 있습니다. <b>분쟁 조정</b>은 이 창구가 아니라 분쟁 접수에서 해야 정산 보류가 걸립니다.</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 18 }}>
          <Link className="w1-bo" href="/support/history">문의 내역 보기</Link>
          <Link className="w1-bor" href="/" style={{ padding: '9px 16px', fontSize: 14 }}>메인으로</Link>{/* v10.32 — 시안 주황 */}
        </div>
      </div>
    </div>
  );
}

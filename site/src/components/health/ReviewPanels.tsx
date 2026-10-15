/** v10.28 (D036) — 상품 상세 「리뷰」 · 「문의」 탭. 시안 SB-HLT-PRD-010 의 탭 3개(상세 · 리뷰 · 문의) */
import Link from 'next/link';
import { apiGetPersonal } from '@/lib/api';
import { QnaForm } from './QnaForm';
import { ymdKst } from '@/lib/format';

interface ReviewList { count: number; avg: number | null; dist: Record<string, number>; items: Array<{ id: string; rating: number; body: string; createdAt: string; writer: string; mine: boolean; optionLabel: string | null }> }
interface QnaList { count: number; items: Array<{ id: string; isPrivate: boolean; createdAt: string; writer: string; mine: boolean; body: string | null; answer: string | null; answeredAt: string | null; answered: boolean }> }

const ymd = (s: string) => ymdKst(s);      /* G-201 규칙 — toLocale… 쓰지 않음 */
export const stars = (n: number) => '★★★★★'.slice(0, Math.round(n)) + '☆☆☆☆☆'.slice(0, 5 - Math.round(n));

export async function ReviewsPanel({ code, rating }: { code: string; rating?: number }) {
  const r = await apiGetPersonal<ReviewList>(`/health/products/${encodeURIComponent(code)}/reviews${rating ? `?rating=${rating}` : ''}`)
    .catch(() => ({ count: 0, avg: null, dist: {}, items: [] }) as ReviewList);
  const base = `/health/p/${encodeURIComponent(code)}?tab=reviews`;
  return (
    <div className="hlt-box" data-reviews id="reviews">
      {r.count === 0 && !rating ? <p className="hlt-mut" data-reviews-empty>아직 리뷰가 없습니다. 구매확정하신 분이 쓰실 수 있습니다.</p> : <>
        <div className="hlt-rvsum" data-review-avg={r.avg ?? ''}>
          <b className="hlt-rvavg">{r.avg?.toFixed(1) ?? '-'}</b> <span className="hlt-stars" aria-label={`별점 ${r.avg ?? 0}점`}>{stars(r.avg ?? 0)}</span>
          <span className="hlt-mut"> 리뷰 {r.count.toLocaleString('ko-KR')}개</span>
        </div>
        <div className="hlt-rvf" role="group" aria-label="별점 거르기">
          <Link href={base} className={!rating ? 'on' : undefined} data-rvfilter="ALL">전체</Link>
          {[5, 4, 3, 2, 1].map((k) => <Link key={k} href={`${base}&rating=${k}`} className={rating === k ? 'on' : undefined} data-rvfilter={k}>{k}점 {r.dist[String(k)] ?? 0}</Link>)}
        </div>
        {r.items.length === 0 ? <p className="hlt-mut">이 별점의 리뷰가 없습니다.</p> : (
          <ul className="hlt-rvlist">
            {r.items.map((x) => (
              <li key={x.id} data-review={x.id}>
                <div><span className="hlt-stars">{stars(x.rating)}</span> <b>{x.writer}</b> <span className="hlt-mut hlt-sm">{ymd(x.createdAt)}{x.optionLabel && x.optionLabel !== '단품' ? ` · ${x.optionLabel}` : ''}{x.mine ? ' · 내 리뷰' : ''}</span></div>
                <p>{x.body}</p>
              </li>))}
          </ul>)}
      </>}
      <p className="hlt-mut hlt-sm">리뷰는 구매확정한 분이 주문 상품마다 한 번 쓸 수 있습니다. 효능 · 효과를 단정하는 표현은 운영 확인 뒤 보입니다.</p>
    </div>
  );
}

export async function QnaPanel({ code, loggedIn }: { code: string; loggedIn: boolean }) {
  const q = await apiGetPersonal<QnaList>(`/health/products/${encodeURIComponent(code)}/qna`).catch(() => ({ count: 0, items: [] }) as QnaList);
  return (
    <div className="hlt-box" data-qna id="qna">
      {loggedIn ? <QnaForm code={code} /> : <p className="hlt-mut" data-qna-login><Link href={`/login?next=${encodeURIComponent(`/health/p/${code}?tab=qna`)}`}>로그인</Link>하시면 문의하실 수 있습니다(본인인증 회원).</p>}
      {q.items.length === 0 ? <p className="hlt-mut" data-qna-empty>아직 문의가 없습니다.</p> : (
        <ul className="hlt-qnalist">
          {q.items.map((x) => (
            <li key={x.id} data-qna-row={x.id}>
              <div><span className={`hlt-bdg ${x.answered ? 'st ok' : ''}`}>{x.answered ? '답변 완료' : '답변 대기'}</span> <b>{x.writer}</b> <span className="hlt-mut hlt-sm">{ymd(x.createdAt)}{x.isPrivate ? ' · 🔒 비공개' : ''}</span></div>
              <p>{x.body ?? '비공개 문의입니다.'}</p>
              {x.answer && <p className="hlt-ans" data-qna-answer><b>소개몰</b> {x.answer}</p>}
            </li>))}
        </ul>)}
    </div>
  );
}

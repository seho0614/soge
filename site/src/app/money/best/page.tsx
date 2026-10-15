import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { ago, won } from '@/lib/format';
import type { ListingListData } from '@/lib/types';
import type { BestStory } from '@/components/market/types';
import { QuickFrame } from '@/components/gwan/GwQuick';
import { GRADES, manwon, photoSrc } from '@/components/gwan/gw';

export const metadata: Metadata = { title: '베스트매칭' };

type Props = { searchParams: Promise<{ s?: string }> };

/**
 * SB-MNY-BST-010 퀵메뉴 ② — 시안 「베스트매칭」(scBest) 그대로.
 *
 * v10.31 (w2 · 10/10 「시안 기준」) — 서버의 베스트매칭 사례(GET /market/best)로 그립니다.
 *   사례 = **실제로 성사된 거래** 가운데 운영이 고르고(success_stories) **매도자 · 매수자 두 분이 공개에 동의**한 것.
 *   거래금액(계약 조건의 합의 금액) · 소개비(합의 소개비) · 성사기간 · 등록지역 · 매칭 과정 5단계(등록 → 문의 · 연결 → 조건 협의 · 계약 → 대금 지급 기록 → 성사 확정)는
 *   거래 기록 그대로이고, 저장하는 것은 운영이 고른 이유와 매도자 한마디뿐입니다. 숫자를 지어내지 않습니다.
 *   · 아래 사례 카드를 누르면 위 1위 상세가 그 사례로 바뀝니다(시안 data-best — 주소 ?s=번호).
 *   · 공개된 사례가 아직 없으면 빈 안내를 두고, 개발에 있던 「인기 상품/서비스」(GET /listings?sort=POPULAR)를 사례 카드 모양으로 남깁니다.
 *   · 시안 맨 위 빨간 경고(부동산 사례 · A-07)는 시안 견본에 붙은 작업 메모라 넣지 않습니다 — 부동산 건은 소개비가 0 이어서 소개비 칸이 「노출료」로 나옵니다.
 */
const BFEAT: [string, string, string][] = [
  ['🏆', '실제 성공 사례만 엄선', '검증된 거래만 베스트매칭으로 선정합니다.'],
  ['🤝', '누구나 성공할 수 있습니다', '당신의 소개가 최고의 매칭이 될 수 있습니다.'],
  ['📊', '더 큰 수익의 기회', '성공 사례를 참고하여 새로운 기회를 만들어 보세요.'],
  ['🛡', '신뢰할 수 있는 매칭', '소개뱅크가 안전한 거래를 함께합니다.'],
];
const STEP_IC: Record<string, string> = { REGISTERED: '📝', INQUIRY: '🔍', CONTRACT: '💬', PAYMENT: '🏗', CONFIRMED: '🤝' };
const STEP_DESC: Record<string, string> = {
  REGISTERED: '소개 등록 · 공개', INQUIRY: '1:1 문의로 연결', CONTRACT: '조건 합의 · 계약서', PAYMENT: '당사자 대금 지급 기록', CONFIRMED: '양측 확인 · 성사 확정',
};
const grade = (g: string) => GRADES.find((x) => x.code === g) ?? GRADES[2]!;
const feeText = (b: BestStory) => (b.fee > 0 ? manwon(b.fee) : '노출료 · 소개비 없음');

export default async function Page({ searchParams }: Props) {
  const q = await searchParams;
  const res = await apiGet<{ items: BestStory[] }>('/market/best?gwanCode=MNY', 30).catch(() => ({ items: [] as BestStory[] }));
  const items = res.items;
  const idx = Math.min(Math.max(0, Number(q.s) || 0), Math.max(0, items.length - 1));
  const B = items[idx];
  const pop = items.length ? null : await apiGet<ListingListData>('/listings?gwanCode=MNY&sort=POPULAR&limit=8', 30).catch(() => null);

  return (
    <><QuickFrame active="best" title="베스트매칭" sub="소개뱅크에서 실제로 성사된 최고의 매칭 성공 케이스를 만나보세요!" features={false}>
      {!B ? (
        <div className="gw-bhero gw-bempty" data-best-empty="">
          <span className="gw-bcrown">👑 베스트매칭</span>
          <div className="gw-bempty-b"><b>아직 공개된 베스트매칭 사례가 없습니다.</b>
            <p>실제로 성사된 거래 가운데 운영이 고르고, <b>매도자 · 매수자 두 분이 공개에 동의</b>한 사례만 이곳에 싣습니다. 금액 · 기간 · 과정은 거래 기록 그대로 나갑니다.</p>
            <div className="gw-winact"><Link className="gw-bo gw-sm" href="/money/new">성공현황 보기 ›</Link><Link className="gw-bo gw-sm" href="/money/best/mine">내 거래 사례 공개 동의 ›</Link></div></div>
        </div>
      ) : (
        <div className="gw-bhero" data-best={B.storyNo}>
          <span className="gw-bcrown">👑 베스트매칭 {idx + 1}위</span>
          <div className="gw-bgrid">
            <div className="gw-bimg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="gw-thp" src={photoSrc(B.categoryName, B.thumbUrl ? [B.thumbUrl] : null)} alt="" />
            </div>
            <div className="gw-bmid">
              <div className="gw-bchips"><span className={`gw-bchip gw-${grade(B.gradeCode).k}`}>{grade(B.gradeCode).nm}</span><span className="gw-bchip">{B.categoryName ?? '기타'}</span></div>
              <h3>{B.headline}</h3>
              <div className="gw-bd2">{B.summary ?? B.title}</div>
              <div className="gw-bstat">
                <div className="gw-bs"><span className="gw-k3">거래금액</span><span className="gw-v3">{B.tradeAmount != null ? manwon(B.tradeAmount) : '비공개'}</span></div>
                <div className="gw-bs"><span className="gw-k3">소개비</span><span className="gw-v3">{feeText(B)}</span></div>
                <div className="gw-bs"><span className="gw-k3">성사기간</span><span className="gw-v3">{B.days}일</span></div>
                <div className="gw-bs"><span className="gw-k3">등록지역</span><span className="gw-v3">{B.region ?? '—'}</span></div>
              </div>
            </div>
            <div>
              <div className="gw-brs"><b>베스트매칭 이유</b>
                <ul>{(B.reasons.length ? B.reasons : ['운영이 고른 이유가 아직 없습니다']).map((w) => <li key={w}><span className="gw-ck">✓</span>{w}</li>)}</ul></div>
              {B.sellerComment && (
                <div className="gw-bqt"><div className="gw-qq">“{B.sellerComment}”</div>
                  {B.sellerRating != null && <div className="gw-st5" aria-label={`별점 ${B.sellerRating}점`}>{'★'.repeat(B.sellerRating)}{'☆'.repeat(5 - B.sellerRating)}</div>}
                  <div className="gw-who2">– 매도자 한마디</div></div>
              )}
            </div>
          </div>
          <div className="gw-bflow"><b>매칭 과정</b><div className="gw-bsteps">
            {B.steps.map((f, i) => (
              <span key={f.code} style={{ display: 'contents' }}>
                {i > 0 && <span className="gw-barw">→</span>}
                <div className={`gw-bst2${f.at ? '' : ' gw-skip'}`}><span className="gw-bi">{STEP_IC[f.code] ?? '•'}</span>
                  <span><span className="gw-bt3"><i>0{i + 1}</i>{f.label}</span><span className="gw-bd3">{f.at ? `${f.at} · ${STEP_DESC[f.code] ?? ''}` : '기록 없음'}</span></span></div>
              </span>
            ))}
          </div></div>
        </div>
      )}

      {items.length > 0 ? (
        <div className="gw-bcase"><div className="gw-ch"><b>다른 베스트 매칭 사례</b><span>사례를 선택하면 상단의 상세 내용이 변경됩니다.</span></div>
          <div className="gw-bcl">
            {items.map((x, i) => (
              <Link key={x.id} className={`gw-bc${i === idx ? ' gw-on' : ''}`} href={i ? `/money/best?s=${i}` : '/money/best'} scroll={false} data-best={i}>
                <div className="gw-bcimg">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="gw-thp" src={photoSrc(x.categoryName, x.thumbUrl ? [x.thumbUrl] : null)} alt="" loading="lazy" />
                  <span className="gw-bcc"><span className={`gw-bchip gw-${grade(x.gradeCode).k}`}>{grade(x.gradeCode).nm}</span><span className="gw-bchip">{x.categoryName ?? '기타'}</span></span>
                </div>
                <div className="gw-bcb"><div className="gw-bct">{x.headline}</div>
                  <div className="gw-bcr"><span>· 거래금액</span><b>{x.tradeAmount != null ? manwon(x.tradeAmount) : '비공개'}</b></div>
                  <div className="gw-bcr"><span>· 소개비</span><b>{feeText(x)}</b></div>
                  <div className="gw-bcr"><span>· 성사기간</span><b>{x.days}일</b></div></div>
              </Link>
            ))}
          </div></div>
      ) : pop && pop.organic.length > 0 && (
        /* 개발에만 있던 「인기 상품/서비스」 — 사례가 쌓일 때까지 시안 사례 카드 모양 안에 남깁니다 */
        <div className="gw-bcase" data-best-popular=""><div className="gw-ch"><b>지금 인기 있는 상품/서비스</b><span>관심 담기가 많은 순서입니다 — 베스트매칭 사례가 아닙니다.</span></div>
          <div className="gw-bcl">
            {pop.organic.map((x) => (
              <Link key={x.id} className="gw-bc" href={`/money/${x.id}`} data-listing={x.id}>
                <div className="gw-bcimg">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="gw-thp" src={photoSrc(x.categoryName, x.thumbUrl ? [x.thumbUrl] : null)} alt="" loading="lazy" />
                  <span className="gw-bcc"><span className="gw-bchip">{x.categoryName}</span></span>
                </div>
                <div className="gw-bcb"><div className="gw-bct">{x.title}</div>
                  <div className="gw-bcr"><span>· 소개비</span><b>{won(x.desiredFee)}</b></div>
                  <div className="gw-bcr"><span>· 관심</span><b>{x.likeCount}</b></div>
                  <div className="gw-bcr"><span>· 등록</span><b suppressHydrationWarning>{ago(x.publishedAt)}</b></div></div>
              </Link>
            ))}
          </div></div>
      )}

      <div className="gw-bfeat">{BFEAT.map(([ic, t, d]) => (
        <div key={t} className="gw-bf"><span className="gw-bfi">{ic}</span><span><span className="gw-bft">{t}</span><span className="gw-bfd">{d}</span></span></div>
      ))}</div>
    </QuickFrame><i hidden data-root-end="" /></>
  );
}

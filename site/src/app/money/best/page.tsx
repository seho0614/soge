import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { ago } from '@/lib/format';
import type { ListingListData } from '@/lib/types';
import type { BestStory } from '@/components/market/types';
import { QuickFrame } from '@/components/gwan/GwQuick';
import { GRADES, manwon, photoSrc } from '@/components/gwan/gw';
import { getTranslations } from 'next-intl/server';
import { getFmt } from '@/lib/getFmt';
import type { Fmt } from '@/lib/fmtBind';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('gwan'))('qm.best') };
}

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
/* v10.101 2-5b — 글자는 사전 키(plaza.best.feat.*) */
const BFEAT = [
  ['🏆', 'f1'],
  ['🤝', 'f2'],
  ['📊', 'f3'],
  ['🛡', 'f4'],
] as const;
const STEP_IC: Record<string, string> = { REGISTERED: '📝', INQUIRY: '🔍', CONTRACT: '💬', PAYMENT: '🏗', CONFIRMED: '🤝' };
/* 단계 설명은 사전(plaza.best.step.*) — 모르는 단계는 빈칸 */
type PlazaT = Awaited<ReturnType<typeof getTranslations<'plaza'>>>;
const stepDesc = (t: PlazaT, code: string) => (t.has(`best.step.${code}` as never) ? t(`best.step.${code}` as never) : '');
const grade = (g: string) => GRADES.find((x) => x.code === g) ?? GRADES[2]!;
/* 금액 — 한국어는 억 · 만 줄임 그대로, 다른 언어는 전체 숫자 ₩ (v10.102 · 2-5c) */
const mw = (f: Fmt, n: number) => (f.ko ? manwon(n) : f.won(n));
const feeText = (b: BestStory, t: PlazaT, f: Fmt) => (b.fee > 0 ? mw(f, b.fee) : t('best.noFee'));

export default async function Page({ searchParams }: Props) {
  const q = await searchParams;
  const t = await getTranslations('plaza');
  const f = await getFmt();
  const g0 = await getTranslations('gwan');
  const gnm = (g: string) => g0(`grade.${grade(g).code}.nm`);
  const res = await apiGet<{ items: BestStory[] }>('/market/best?gwanCode=MNY', 30).catch(() => ({ items: [] as BestStory[] }));
  const items = res.items;
  const idx = Math.min(Math.max(0, Number(q.s) || 0), Math.max(0, items.length - 1));
  const B = items[idx];
  const pop = items.length ? null : await apiGet<ListingListData>('/listings?gwanCode=MNY&sort=POPULAR&limit=8', 30).catch(() => null);

  return (
    <><QuickFrame active="best" title={g0('qm.best')} sub={t('best.sub')} features={false}>
      {!B ? (
        <div className="gw-bhero gw-bempty" data-best-empty="">
          <span className="gw-bcrown">👑 {g0('qm.best')}</span>
          <div className="gw-bempty-b"><b>{t('best.emptyH')}</b>
            <p>{t.rich('best.emptyP', { b: (c) => <b>{c}</b> })}</p>
            <div className="gw-winact"><Link className="gw-bo gw-sm" href="/money/new">{t('best.toNew')}</Link><Link className="gw-bo gw-sm" href="/money/best/mine">{t('best.toMine')}</Link></div></div>
        </div>
      ) : (
        <div className="gw-bhero" data-best={B.storyNo}>
          <span className="gw-bcrown">👑 {t('best.rank', { n: String(idx + 1) })}</span>
          <div className="gw-bgrid">
            <div className="gw-bimg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="gw-thp" src={photoSrc(B.categoryName, B.thumbUrl ? [B.thumbUrl] : null)} alt="" />
            </div>
            <div className="gw-bmid">
              <div className="gw-bchips"><span className={`gw-bchip gw-${grade(B.gradeCode).k}`}>{gnm(B.gradeCode)}</span><span className="gw-bchip">{B.categoryName ?? g0('side.etc')}</span></div>
              <h3>{B.headline}</h3>
              <div className="gw-bd2">{B.summary ?? B.title}</div>
              <div className="gw-bstat">
                <div className="gw-bs"><span className="gw-k3">{t('best.amount')}</span><span className="gw-v3">{B.tradeAmount != null ? mw(f, B.tradeAmount) : t('best.private')}</span></div>
                <div className="gw-bs"><span className="gw-k3">{t('best.fee')}</span><span className="gw-v3">{feeText(B, t, f)}</span></div>
                <div className="gw-bs"><span className="gw-k3">{t('best.period')}</span><span className="gw-v3">{t('best.days', { n: String(B.days) })}</span></div>
                <div className="gw-bs"><span className="gw-k3">{t('best.region')}</span><span className="gw-v3">{B.region ?? '—'}</span></div>
              </div>
            </div>
            <div>
              <div className="gw-brs"><b>{t('best.reasons')}</b>
                <ul>{(B.reasons.length ? B.reasons : [t('best.noReason')]).map((w) => <li key={w}><span className="gw-ck">✓</span>{w}</li>)}</ul></div>
              {B.sellerComment && (
                <div className="gw-bqt"><div className="gw-qq">“{B.sellerComment}”</div>
                  {B.sellerRating != null && <div className="gw-st5" aria-label={t('best.rating', { n: String(B.sellerRating) })}>{'★'.repeat(B.sellerRating)}{'☆'.repeat(5 - B.sellerRating)}</div>}
                  <div className="gw-who2">{t('best.sellerSays')}</div></div>
              )}
            </div>
          </div>
          <div className="gw-bflow"><b>{t('best.flow')}</b><div className="gw-bsteps">
            {B.steps.map((f, i) => (
              <span key={f.code} style={{ display: 'contents' }}>
                {i > 0 && <span className="gw-barw">→</span>}
                <div className={`gw-bst2${f.at ? '' : ' gw-skip'}`}><span className="gw-bi">{STEP_IC[f.code] ?? '•'}</span>
                  <span><span className="gw-bt3"><i>0{i + 1}</i>{f.label}</span><span className="gw-bd3">{f.at ? `${f.at} · ${stepDesc(t, f.code)}` : t('best.noRecord')}</span></span></div>
              </span>
            ))}
          </div></div>
        </div>
      )}

      {items.length > 0 ? (
        <div className="gw-bcase"><div className="gw-ch"><b>{t('best.othersH')}</b><span>{t('best.othersSub')}</span></div>
          <div className="gw-bcl">
            {items.map((x, i) => (
              <Link key={x.id} className={`gw-bc${i === idx ? ' gw-on' : ''}`} href={i ? `/money/best?s=${i}` : '/money/best'} scroll={false} data-best={i}>
                <div className="gw-bcimg">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="gw-thp" src={photoSrc(x.categoryName, x.thumbUrl ? [x.thumbUrl] : null)} alt="" loading="lazy" />
                  <span className="gw-bcc"><span className={`gw-bchip gw-${grade(x.gradeCode).k}`}>{gnm(x.gradeCode)}</span><span className="gw-bchip">{x.categoryName ?? g0('side.etc')}</span></span>
                </div>
                <div className="gw-bcb"><div className="gw-bct">{x.headline}</div>
                  <div className="gw-bcr"><span>· {t('best.amount')}</span><b>{x.tradeAmount != null ? mw(f, x.tradeAmount) : t('best.private')}</b></div>
                  <div className="gw-bcr"><span>· {t('best.fee')}</span><b>{feeText(x, t, f)}</b></div>
                  <div className="gw-bcr"><span>· {t('best.period')}</span><b>{t('best.days', { n: String(x.days) })}</b></div></div>
              </Link>
            ))}
          </div></div>
      ) : pop && pop.organic.length > 0 && (
        /* 개발에만 있던 「인기 상품/서비스」 — 사례가 쌓일 때까지 시안 사례 카드 모양 안에 남깁니다 */
        <div className="gw-bcase" data-best-popular=""><div className="gw-ch"><b>{t('best.popH')}</b><span>{t('best.popSub')}</span></div>
          <div className="gw-bcl">
            {pop.organic.map((x) => (
              <Link key={x.id} className="gw-bc" href={`/money/${x.id}`} data-listing={x.id}>
                <div className="gw-bcimg">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="gw-thp" src={photoSrc(x.categoryName, x.thumbUrl ? [x.thumbUrl] : null)} alt="" loading="lazy" />
                  <span className="gw-bcc"><span className="gw-bchip">{x.categoryName}</span></span>
                </div>
                <div className="gw-bcb"><div className="gw-bct">{x.title}</div>
                  <div className="gw-bcr"><span>· {t('best.fee')}</span><b>{f.won(x.desiredFee)}</b></div>
                  <div className="gw-bcr"><span>· {t('best.likes')}</span><b>{x.likeCount}</b></div>
                  <div className="gw-bcr"><span>· {t('best.posted')}</span><b suppressHydrationWarning>{f.ago(x.publishedAt, ago(x.publishedAt))}</b></div></div>
              </Link>
            ))}
          </div></div>
      )}

      <div className="gw-bfeat">{BFEAT.map(([ic, k]) => (
        <div key={k} className="gw-bf"><span className="gw-bfi">{ic}</span><span><span className="gw-bft">{t(`best.feat.${k}.t`)}</span><span className="gw-bfd">{t(`best.feat.${k}.d`)}</span></span></div>
      ))}</div>
    </QuickFrame><i hidden data-root-end="" /></>
  );
}

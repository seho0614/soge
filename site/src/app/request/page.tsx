import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGet, apiGetPersonal } from '@/lib/api';
import { EarnPromo, RoleTabs } from '@/components/gwan/GwParts';
import { SearchBox } from '@/components/search/SearchBox';
import { ReqCard, type ReqRow } from '@/components/request/ReqCard';
import '@/styles/proto-w1.css';

export const metadata: Metadata = { title: '소개받기' };

const FILTERS: Array<{ k: string; g?: string; closing?: boolean }> = [
  { k: '전체' }, { k: '소개장터', g: 'MNY' }, { k: '안심소개', g: 'MAL' }, { k: '소개창업', g: 'BIZ' }, { k: '마감 임박', closing: true },
];
const SORTS: Array<[string, string]> = [['CLOSING', '마감 임박순'], ['RECENT', '최신순'], ['FEE', '소개비순']];

/**
 * SB-HOM-REQ-020 소개받기 목록 — v10.31 시안 scReqList 그대로.
 *   검색줄(search(true, true) — 파랑 + 오른쪽 「소개로 수익을…」) · 소개하기 3단추(roleTab · 소개받기 켜짐) ·
 *   노란 안내 띠(남의 회사 사정 · 공개 범위 · 비공개 옵션) · 관 필터 칩(전체 · 소개장터 · 안심소개 · 소개창업 · 마감 임박) + 정렬 ·
 *   큰 요청 카드(관 · 업종 · 🔒 · D-day · 설명 · 📍 지역 · 📦 규모 · 💰 예산 · 요청 번호 · 성사 시 예상 소개비 · 「소개 제안하기」) ·
 *   30일 자동 마감 안내.
 * 검색칸은 다른 화면과 같은 검색 팝업을 엽니다(SearchBox). 이 화면 안 거르기는 주소의 q · g · closing · sort.
 * 자료: GET /requests?gwanCode=&q=&closing=&sort= (v10.31 — 검색어 · 마감 임박 · 정렬 · 카드 칸 추가). 관 이름은 /gwans 정본.
 */
export default async function RequestList({ searchParams }: {
  searchParams: Promise<{ g?: string; q?: string; closing?: string; sort?: string }>;
}) {
  const sp = await searchParams;
  const g = ['MNY', 'MAL', 'BIZ'].includes(sp.g ?? '') ? sp.g : undefined;
  const closing = sp.closing === '1';
  const sort = SORTS.some(([k]) => k === sp.sort) ? sp.sort! : 'CLOSING';
  const q = (sp.q ?? '').trim().slice(0, 50);

  const qs = new URLSearchParams({ limit: '30', sort });
  if (g) qs.set('gwanCode', g);
  if (closing) qs.set('closing', '1');
  if (q) qs.set('q', q);
  const [rows, gwans] = await Promise.all([
    /* 공개 범위가 「회원」인 요청의 내용은 로그인한 사람에게만 옵니다 — 사람마다 달라 캐시하지 않습니다 */
    apiGetPersonal<ReqRow[]>(`/requests?${qs}`).catch(() => [] as ReqRow[]),
    apiGet<Array<{ code: string; name: string }>>('/gwans', 300).catch(() => []),
  ]);
  const GN: Record<string, string> = Object.fromEntries(gwans.map((x) => [x.code, x.name]));

  const href = (o: { g?: string; closing?: boolean; sort?: string }) => {
    const u = new URLSearchParams();
    if (q) u.set('q', q);
    if (o.g) u.set('g', o.g);
    if (o.closing) u.set('closing', '1');
    const s = o.sort ?? sort;
    if (s !== 'CLOSING') u.set('sort', s);
    const t = u.toString();
    return t ? `/request?${t}` : '/request';
  };
  const onF = (f: (typeof FILTERS)[number]) => (f.closing ? closing : !closing && (f.g ?? undefined) === g);

  return (
    <div className="w1 w1-wrap" data-screen="SB-HOM-REQ-020">
      <SearchBox variant="gwan" blue aside={<EarnPromo />} />
      <div style={{ marginTop: 14 }}>
        <RoleTabs on="get" note="필요한 물품 · 용역 · 부동산 · 장비 · 창업 공간을 등록하면 소개자가 찾아드립니다!" />
      </div>

      <div className="w1-wrn" style={{ marginTop: 14 }}>
        <span className="ic" aria-hidden="true">!</span>
        <span><b>여기 올라온 것은 남의 회사 사정입니다.</b> “재고를 넘기고 싶다”, “설비가 필요하다”는 경쟁사와 거래처가 보면 협상 카드가 됩니다.
          그래서 요청마다 <b>공개 범위</b>를 고르게 했고, 회사명을 가린 채 업종 · 규모만 보이는 <b>비공개 옵션</b>을 뒀습니다.</span>
      </div>

      <div className="w1-rqf" role="group" aria-label="소개받기 거르기">
        {FILTERS.map((f) => (
          <Link key={f.k} className={`fb2${onF(f) ? ' on' : ''}`} href={href({ g: f.g, closing: f.closing })}
            aria-current={onF(f) ? 'true' : undefined}>{f.k}</Link>
        ))}
        <span className="sp3" />
        <span className="srt" aria-label="정렬">
          {SORTS.map(([k, label]) => (
            <Link key={k} className={k === sort ? 'on' : undefined} href={href({ g, closing, sort: k })}>{label}{k === sort ? ' ⌄' : ''}</Link>
          ))}
        </span>
      </div>

      {q && <p className="w1-nt3" style={{ margin: '0 0 10px' }}>‘{q}’ 이(가) 든 요청 {rows.length}건 · <Link href={href({ g, closing })}>검색어 지우기</Link></p>}

      {rows.length === 0 ? (
        <div className="w1-empty">
          {q || g || closing ? '조건에 맞는 요청이 없습니다.' : '등록된 요청이 없습니다.'}
          <div style={{ marginTop: 12 }}><Link className="w1-bo" href="/request/new">필요한 것을 요청으로 올리기</Link></div>
        </div>
      ) : (
        <div className="w1-rql">
          {rows.map((r) => <ReqCard key={r.id} r={r} gwanName={GN[r.gwanCode] ?? r.gwanCode} />)}
        </div>
      )}

      <p className="w1-nt3" style={{ textAlign: 'center', margin: '16px 0 4px' }}>
        요청은 등록 후 <b>30일</b>이 지나면 자동으로 닫힙니다. 채워진 요청을 닫지 않으면 목록이 죽은 글로 채워집니다.
      </p>
      <p className="w1-nt3" style={{ textAlign: 'center' }}>예상 소개비는 요청자가 적은 희망 금액입니다 — 요율표로 산정한 값이 아닙니다(A-12).</p>
    </div>
  );
}

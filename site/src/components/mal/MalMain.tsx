import { apiGet, apiGetPersonal } from '@/lib/api';
import { me } from '@/lib/session';
import { getTranslations } from 'next-intl/server';
import { safeSort } from '@/lib/format';
import type { Gwan, ListingListData } from '@/lib/types';
import { ListingList } from '@/components/ListingList';
import { ConsultRows } from './ConsultRows';
import { AXIS, SAFE_CONSULT, SAFE_LISTING } from './copy';
import type { ConsultCat, MalCategory, PartnerDash, PublicSettings } from './types';

export interface MalQuery {
  sort?: string; cursor?: string; badge?: string; axis?: string; cat?: string; keyword?: string;
}

const BADGES = new Set(['URGENT', 'VERIFIED_DOC']);
const SORTS: Array<[string, string]> = [['RECENT', '최신'], ['POPULAR', '인기'], ['FEE_DESC', '소개비순']];

/** 빈 값은 빼고 /mall 주소를 만듭니다 — 정렬 · 필터를 주소에 남겨 그대로 공유할 수 있게 합니다. */
function href(gwan: string, p: Record<string, string | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v) qs.set(k, v);
  const s = qs.toString();
  return `/${gwan}${s ? `?${s}` : ''}`;
}

/**
 * SB-MAL-MAIN-010 안심소개 랜딩 · 목록 — 「상담 축 통합」 (시안 v10.8 `MAL` · D005)
 *
 * ── 시안과 같게 둔 것 ───────────────────────────────────────────────
 *  · 위쪽 버튼 줄(띠: 상담 신청하기 · 인증업체 등록 · 시연용 「보는 사람」 전환)은 **없습니다**(10/2 결정).
 *    상담 신청 · 인증업체 등록은 본문 카드의 버튼으로 갑니다.
 *  · 축 탭 → 축 설명 → 왼쪽(내 목록 · 소개합니다) · 오른쪽(급매 띠 · 찾기 · 분류 · 목록 · 먼저 확인할 것).
 *  · 「생활 · 금융 상담」 축은 업종 줄 + 「업체이신가요? 인증업체 등록」 카드.
 *
 * ── 시안과 다른 것(이유) ────────────────────────────────────────────
 *  · 「보는 사람」은 시연 전환 대신 **실제 로그인 · 입점 상태**(GET /partner/dashboard 의 status=ACTIVE)로 가릅니다.
 *  · 기계 · 설비(B) / 부동산(A) 축은 서버에 축 구분 API 가 없고 기계 · 설비 업종이 DB 에 없어 「매물」 하나로 묶었습니다.
 *  · 지역 설정 · 소개비율 정렬은 받쳐 줄 API 가 없어 뺐습니다. 「인증업체 N곳」은 GET /consult/categories 로 채웁니다(v10.11 · D018).
 */
export async function MalMain({ gwan, q }: { gwan: string; q: MalQuery }) {
  const tc = await getTranslations('consult');   // v10.98 — SAFE_CONSULT 는 사전 키
  const axis = q.axis === 'consult' ? 'consult' : 'listing';

  const [gwans, settings, consultCats, allCats, p] = await Promise.all([
    apiGet<Gwan[]>('/gwans', 300).catch(() => [] as Gwan[]),
    apiGet<PublicSettings>('/site-settings/public', 60).catch(() => ({} as PublicSettings)),
    apiGet<ConsultCat[]>('/consult/categories', 60).catch(() => [] as ConsultCat[]),
    apiGet<MalCategory[]>('/categories?gwanCode=MAL', 300).catch(() => [] as MalCategory[]),
    me().catch(() => null),
  ]);
  const g = gwans.find((x) => x.code === 'MAL');
  const dash = p ? await apiGetPersonal<PartnerDash>('/partner/dashboard').catch(() => null) : null;
  const partner = dash?.status === 'ACTIVE';

  /* 매물 분류 = 안심소개 업종 중 상담 업종이 아닌 것. 상담 업종 목록(API)으로 거릅니다. */
  const consultIds = new Set(consultCats.map((c) => c.id));
  const listingCats = allCats.filter((c) => !consultIds.has(c.id));
  const cat = listingCats.find((c) => c.id === q.cat);
  const badge = q.badge && BADGES.has(q.badge) ? q.badge : undefined;
  const sort = safeSort(q.sort);
  const keyword = (q.keyword ?? '').trim().slice(0, 50) || undefined;

  let data: ListingListData | null = null;
  if (axis === 'listing') {
    const qs = new URLSearchParams({ gwanCode: 'MAL', limit: '20' });
    if (sort) qs.set('sort', sort);
    if (q.cursor) qs.set('cursor', q.cursor);
    if (badge) qs.set('badge', badge);
    if (cat) qs.set('categoryId', cat.id);
    if (keyword) qs.set('keyword', keyword);
    data = await apiGet<ListingListData>(`/listings?${qs}`).catch(() => null);
  }

  const partnerOnly = settings['mal.partner_only'] === 'on';
  const keep = { sort, badge, cat: cat?.id, keyword };
  const ax = AXIS[axis];

  return (
    <div className="mal">
      <div className="page-head mal-head">
        <h1>{g?.name ?? '안심소개'}</h1>
        {g?.description && <p className="mal-desc">{g.description}</p>}
      </div>

      {/* 축 탭 — 주소(?axis=)로 바꿉니다. 스크립트 없이도 동작합니다. */}
      <nav className="mal-axbar" aria-label="자산 성격">
        {(['listing', 'consult'] as const).map((k) => (
          <a key={k} className={`mal-axt${axis === k ? ' on' : ''}`} aria-current={axis === k ? 'page' : undefined}
             href={k === 'consult' ? href(gwan, { axis: 'consult' }) : href(gwan, {})} data-axis={k}>
            <b>{AXIS[k].nm}</b><span>{AXIS[k].sub}</span>
          </a>
        ))}
      </nav>
      <div className="mal-axnote">
        <b>{ax.nm}</b> — {ax.judge} <span className="mal-ls">{ax.why}</span>
        {axis === 'listing' && (
          <span className="mal-axbrk">
            <b>공인중개사 매물</b>
            <span>중개사 매물은 소유 확인을 먼저 받습니다.</span>
            <a className="mal-btn ghost sm" href="/mal/brokers">중개사 매물 · 소유 확인 ›</a>
          </span>
        )}
      </div>

      {/* 인증업체만 게시 — 스위치(mal.partner_only) 값을 그대로 안내합니다 */}
      <p className={`mal-po${partnerOnly ? ' on' : ''}`} data-partner-only={partnerOnly ? 'on' : 'off'}>
        {partnerOnly ? (
          <><b>인증업체만 게시합니다.</b> 안심소개 매물은 입점 승인을 받은 인증업체만 올립니다.</>
        ) : (
          <><b>「인증업체만 게시」는 아직 켜지지 않았습니다.</b> 지금은 입점 승인 전 업체의 매물도 보일 수 있습니다 — 카드의 「사업자 인증」 표시를 확인하십시오.</>
        )}
      </p>

      <div className="mal-lay">
        <aside className="mal-side">
          {axis === 'consult' ? (
            <div className="mal-panel mal-axaside">
              <b>{AXIS.consult.nm}</b>
              <span>{AXIS.consult.judge}</span>
              <span className="mal-ls">업종은 관리자가 관리합니다 — 회원이 업종을 만들 수 없습니다.</span>
            </div>
          ) : (
            <div className="mal-panel">
              <div className="mal-sh">☰ 매물 분류</div>
              <ul className="mal-catlist">
                <li><a className={!cat ? 'on' : ''} href={href(gwan, { ...keep, cat: undefined })}>전체 매물 · 장비</a></li>
                {listingCats.map((c) => (
                  <li key={c.id}><a className={cat?.id === c.id ? 'on' : ''} href={href(gwan, { ...keep, cat: c.id })}>{c.name}</a></li>
                ))}
              </ul>
            </div>
          )}
          <a className="mal-mylist" href="/my/listings">🗂 내가 등록한 매물/장비</a>
          {partner ? (
            <>
              <a className="mal-mylist primary" href="/register" data-role="partner">✚ 매물 등록</a>
              <a className="mal-mylist" href="/partner/listings">내 매물 · 입점 상태</a>
              <a className="mal-mylist" href="/partner">안심소개 파트너센터</a>
            </>
          ) : (
            <a className="mal-mylist primary" href="/mall/give" data-role="member">✚ 소개합니다</a>
          )}
        </aside>

        <div className="mal-main">
          {axis === 'consult' ? (
            <section className="mal-panel" aria-labelledby="mal-csl-h">
              <div className="mal-sh2">
                <b id="mal-csl-h">🤝 생활 · 금융 상담</b>
                <span className="mal-ls">업종을 고르고 상담을 신청하면 인증된 업체 1곳이 연락드립니다</span>
              </div>
              <div className="mal-warn ok">
                <b>신청 정보는 동의하신 업체 1곳에만 전달됩니다 — 여러 곳에 넘기지 않습니다.</b>{' '}
                휴대폰 확인을 마친 신청만 전달되고, 로그인하지 않아도 신청할 수 있습니다.
                법률 · 세무는 상담 신청 대신 <b>사무소 정보(광고)</b>를 보고 직접 연락합니다.
              </div>
              <ConsultRows cats={consultCats} label="상담 신청" />
              <div className="mal-cta">
                {partner ? (
                  <>
                    <b>인증업체이십니다.</b>
                    <span>배정된 상담 신청은 파트너센터에서 확인하고 연락처를 열 수 있습니다</span>
                    <a className="mal-btn ghost sm" href="/partner/leads">받은 상담 신청</a>
                  </>
                ) : (
                  <>
                    <b>업체이신가요?</b>
                    <span>안심소개 파트너센터에서 입점 신청과 자격 서류를 내면 이 목록에 오릅니다</span>
                    <a className="mal-btn ghost sm" href="/partner/apply">인증업체 등록</a>
                    <a className="mal-btn ghost sm" href="/partner/listings">입점 상태 보기</a>
                  </>
                )}
              </div>
            </section>
          ) : (
            <>
              <div className="mal-urg">
                <b>🔥 급매 · 이전</b>
                <span>마감이 임박한 건만 모읍니다</span>
                <a className="mal-btn ghost sm" href={href(gwan, { badge: 'URGENT' })}>보러 가기 ›</a>
              </div>

              <form className="mal-panel mal-find" action={`/${gwan}`} method="get" role="search">
                <div className="mal-fh">소개매물 찾기</div>
                <div className="mal-fbar">
                  <label className="mal-fgrp"><span>매물 분류 선택</span>
                    <select name="cat" defaultValue={cat?.id ?? ''}>
                      <option value="">전체 매물 · 장비</option>
                      {listingCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </label>
                  <label className="mal-fgrp grow"><span>제목에 들어간 말</span>
                    <input name="keyword" defaultValue={keyword ?? ''} maxLength={50} placeholder="예: 사무실" />
                  </label>
                  {badge && <input type="hidden" name="badge" value={badge} />}
                  {sort && <input type="hidden" name="sort" value={sort} />}
                  <button className="mal-btn" type="submit">🔍 검색</button>
                </div>
                <div className="mal-fnote">
                  {cat || keyword
                    ? <><b>{[cat?.name, keyword && `「${keyword}」`].filter(Boolean).join(' · ')}</b> 조건으로 아래를 걸렀습니다.</>
                    : '선택하신 분류에 맞는 건이 아래에 표시됩니다.'}
                </div>
              </form>

              <section className="mal-panel" aria-labelledby="mal-list-h">
                <div className="mal-sh2">
                  <b id="mal-list-h">{cat ? `☰ ${cat.name}` : '🔥 지금 올라온 매물/장비'}</b>
                  <a href="/mall/list">더보기 ›</a>
                </div>
                <div className="mal-filters">
                  <div className="quick" aria-label="표시">
                    {([['', '전체'], ['URGENT', '급구'], ['VERIFIED_DOC', '서류 확인']] as const).map(([v, t]) => (
                      <a key={t} href={href(gwan, { ...keep, badge: v || undefined })} className={(badge ?? '') === v ? 'on' : ''}>{t}</a>
                    ))}
                  </div>
                  <div className="quick" aria-label="정렬">
                    {SORTS.map(([v, t]) => (
                      <a key={v} href={href(gwan, { ...keep, sort: v === 'RECENT' ? undefined : v })}
                         className={(sort ?? 'RECENT') === v ? 'on' : ''}>{t}</a>
                    ))}
                  </div>
                </div>
                {data ? (
                  <>
                    <ListingList data={data} />
                    {data.nextCursor && (
                      <a className="more" href={href(gwan, { ...keep, cursor: data.nextCursor })}>더 보기</a>
                    )}
                  </>
                ) : (
                  <p className="mal-empty">매물 목록을 불러오지 못했습니다. 조건을 바꾸거나 <a href={`/${gwan}`}>처음 화면</a>으로 가십시오.</p>
                )}
              </section>
            </>
          )}

          <section className="mal-panel mal-safe" aria-labelledby="mal-safe-h">
            <div className="mal-sh2"><b id="mal-safe-h">⚠ {axis === 'consult' ? ax.nm : `${ax.nm} 거래`}에서 먼저 확인할 것</b></div>
            {axis === 'consult' ? (
              <ul>{SAFE_CONSULT.map((x) => <li key={x}>{tc(x)}</li>)}</ul>
            ) : (
              SAFE_LISTING.map(([h, xs]) => (
                <div key={h}>
                  <div className="mal-safe-h">{h}</div>
                  <ul>{xs.map((x) => <li key={x}>{x}</li>)}</ul>
                </div>
              ))
            )}
            <div className="mal-ls">축마다 위험이 다릅니다 — 이 목록은 {ax.sub} 전용입니다. <a href="/safety/guide" data-sgd-link="">사기 예방 가이드 보기 ›</a></div>
          </section>
        </div>
      </div>
    </div>
  );
}

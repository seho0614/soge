/** SB-HLT-CAT-050 고민별 인덱스 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import type { HltConcern } from '@/components/health/types';
import { Crumb, HltEmpty, HltNav } from '@/components/health/HltParts';

export const metadata: Metadata = { title: '고민별 · 소개몰' };

/**
 * 고민별 인덱스 — GET /health/concerns
 *
 * 고민은 별도 분류가 아니라 **성분을 다시 묶은 것**입니다(시안). 묶음은 서버 표
 * (hlt_concerns · hlt_concern_ingredients)이고, 연결 성분이 없는 고민은 서버가 내보내지 않습니다.
 */
export default async function HltConcerns() {
  const list = await apiGet<HltConcern[]>('/health/concerns', 300).catch(() => null);

  return (
    <><div className="hlt">
      <HltNav on="concern" />
      <Crumb items={[{ label: '고민별' }]} />
      <div className="page-head"><h1>고민별</h1></div>
      <p className="hint">고민은 별도 분류가 아니라 <b>많이 찾는 성분을 다시 묶은 것</b>입니다. 같은 성분이 여러 고민에 들어갑니다.</p>

      {list === null ? (
        <p className="form-error" role="alert">고민 정보를 불러오지 못했습니다. 잠시 뒤 다시 열어 주십시오.</p>
      ) : list.length === 0 ? (
        <HltEmpty msg="아직 묶인 고민이 없습니다." href="/health/ingredients" label="성분별 보기" />
      ) : (
        <div className="hlt-igrid">
          {list.map((c) => (
            <Link key={c.code} href={`/health/w/${encodeURIComponent(c.code)}`} className="hlt-icard">
              <span className="nm">{c.icon} {c.name}</span>
              <span className="pr">
                성분 {c.ingredientCount}종
                {c.stockedIngredientCount < c.ingredientCount && <span className="hint"> (취급 {c.stockedIngredientCount})</span>}
              </span>
            </Link>
          ))}
        </div>
      )}

      {/* v10.31 (시안 「문구 규칙」 노란 안내 상자) — 검정(site_mall V-16): 내부 규칙 번호(INV-H4)는 이용자 화면에 내보내지 않음 */}
      <div className="hlt-note warn hlt-gap" data-wording-rule="">
        <b>문구 규칙</b><br />
        고민 이름은 <b>상태 표현</b>만 씁니다 — 혈당 · 혈압 · 수면. 질병명(당뇨 · 고혈압 · 불면증)은 쓰지 않습니다.<br />
        &ldquo;효과 있는 성분&rdquo;이 아니라 &ldquo;많이 찾는 성분&rdquo;이라고 씁니다. 고민 이름과 설명은 그 자체가 광고 문구로 읽히므로 자동 사전검사 대상입니다.
      </div>
      <div className="notice hlt-gap">
        고민별 분류는 이 고민으로 <b>많이 찾는 성분</b>을 모은 것입니다. 건강기능식품은 질병의 예방이나
        치료를 위한 의약품이 아니며, 표시된 기능성은 식품의약품안전처가 인정한 범위입니다.
      </div>
    </div><i hidden data-root-end="" /></>
  );
}

import { consultOpen, type ConsultCat } from './types';
import { CSL_DESC } from './copy';

/**
 * SB-MAL-MAIN-010 · SB-MAL-CSL-010 · 020 — 생활 · 금융 상담 업종 줄 (시안 axBodyLead · scCsl 업종 고르기)
 *
 * 업종 · 자격 확인 여부 · 받을 수 있는 인증업체 수는 GET /consult/categories 그대로입니다(D018).
 *  · 리드형(LEAD)        인증업체가 1곳 이상이면 「상담 신청」, 0곳이면 「받을 업체가 아직 없습니다」
 *  · 월 정액 노출형(LISTING_FEE · 법률 · 세무 — D019)  상담 신청을 받지 않고 「광고」 표시와 함께 사무소 목록으로 갑니다
 *  · 준비 중(PENDING)    감추지 않고 「준비 중」으로 보입니다
 *
 * v10.24 — 줄마다 **「상세 보기」**(업종 상세 /mal/consult/{code})를 두고, 「상담 신청」은 그 업종의 신청서(/mal/consult/{code}/apply)로 갑니다.
 *   받을 업체가 없는 업종도 상세는 볼 수 있습니다(단추만 막습니다 — 규칙은 그대로).
 *   pick 을 주면 전과 같은 「고르기」 한 단추입니다(/consult — 한 화면에서 업종을 고르고 바로 아래 신청서를 씁니다).
 */
export function ConsultRows({ cats, label, current, pick }: { cats: ConsultCat[]; label: string; current?: string; pick?: boolean }) {
  if (cats.length === 0) {
    return <p className="mal-empty">상담 업종을 불러오지 못했습니다. 잠시 뒤 다시 열어 주십시오.</p>;
  }
  /* v10.32 — 시안 순서: 지금 신청할 수 있는 업종(자격 확인 → 일반) → 받을 업체가 아직 없는 업종 → 준비 중 → 사무소 보기(법률 · 세무 — 맨 아래). 같은 묶음 안은 이름순 */
  const rank = (c: ConsultCat) => (consultOpen(c) ? (c.publishMode === 'GATED' ? 0 : 1)
    : c.status === 'APPROVED' && c.consultMode === 'LISTING_FEE' ? 5 : c.status === 'APPROVED' ? 2 : 3);
  const sorted = [...cats].sort((x, y) => rank(x) - rank(y) || x.name.localeCompare(y.name, 'ko'));
  return (
    <ul className="mal-rows">
      {sorted.map((c) => {
        const gated = c.publishMode === 'GATED';
        const dir = c.consultMode === 'LISTING_FEE';
        const open = consultOpen(c);
        const detail = `/mal/consult/${encodeURIComponent(c.code)}`;
        return (
          <li key={c.id} className={`mal-row${current === c.code ? ' on' : ''}`} data-csl={c.code}
              data-csl-mode={dir ? 'dir' : open ? 'open' : c.status === 'PENDING' ? 'hold' : 'none'}>
            <div className="mal-row-l">
              <span className={`mal-tag${gated ? ' gated' : ''}`}>{gated ? '자격 확인' : '일반'}</span>
              {pick ? <b>{c.name}</b> : <b><a className="mal-row-t" href={detail}>{c.name}</a></b>}
              <span className="mal-ls">
                {CSL_DESC[c.code] ? `${CSL_DESC[c.code]} · ` : ''}
                {c.status === 'PENDING' ? '준비 중' : dir ? `게재 ${c.partnerCount}곳` : `인증업체 ${c.partnerCount}곳`}
              </span>
            </div>
            <div className="mal-row-r">
              {c.status === 'APPROVED' && dir ? (
                <>
                  <span className="mal-ls">광고</span>
                  <a className="mal-btn ghost" href={detail}>사무소 보기</a>
                </>
              ) : pick ? (
                open ? (
                  <a className="mal-btn" href={`/consult?cat=${encodeURIComponent(c.code)}#csl-form`}>{label}</a>
                ) : (
                  <>
                    <span className="mal-ls">{c.status === 'PENDING' ? '준비 중입니다' : '받을 업체가 아직 없습니다'}</span>
                    <button className="mal-btn ghost" type="button" disabled>준비 중</button>
                  </>
                )
              ) : (
                <>
                  {!open && <span className="mal-ls">{c.status === 'PENDING' ? '준비 중입니다' : '받을 업체가 아직 없습니다'}</span>}
                  <a className="mal-btn ghost mal-row-b" href={detail}>상세 보기</a>
                  {open
                    ? <a className="mal-btn mal-row-b" href={`${detail}/apply`}>{label}</a>
                    : <button className="mal-btn ghost mal-row-b" type="button" disabled>준비 중</button>}
                </>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

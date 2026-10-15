import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { apiGet } from '@/lib/api';
import { BackBar } from '@/components/common/BackBar';
import { consultOpen, type ConsultCatDetail } from '@/components/mal/types';
import { CSL_DESC, SAFE_CONSULT } from '@/components/mal/copy';
import '@/styles/mal.css';

interface DirEntry { id: string; displayName: string; intro?: string | null; contactPhone: string; websiteUrl?: string | null; sido: string }
interface DirList { adLabel: string; note: string; entries: DirEntry[] }

type Props = { params: Promise<{ code: string }> };

export const metadata: Metadata = { title: '상담 업종' };

const LIST = '/mall?axis=consult';

/**
 * SB-MAL-CSL-025 — 상담 업종 상세 (v10.24 · 시안 #/mal/consult/{code})
 *                  법률 · 세무 사무소 보기 (월 정액 노출형 · D019 — 시안에서는 「CSL-050 제안」 화면, 같은 주소라 한 화면으로 등록)
 *
 * 10/7 지시 「생활금융 부분(리스트 및 상세 보기 · 상담하기)을 작동 가능하게」 · 답 「상세 보기 = 업종 상세」.
 * 목록의 줄 → **이 화면(상세)** → 맨 아래 줄의 「상담 신청」 → 신청서(/mal/consult/{code}/apply · SB-MAL-CSL-030).
 *
 *  · 숫자(인증업체 수 · 받는 지역 · 진행 규칙)는 전부 GET /consult/categories/{code} 그대로입니다 — 화면에 적어 둔 숫자가 없습니다.
 *  · 업체 이름 · 연락처는 보여 주지 않습니다. 어느 업체에 갈지는 서버가 1곳으로 정합니다(소비자가 고르는 화면이 아닙니다).
 *  · 받을 업체가 0곳이면 「상담 신청」을 막고 까닭을 적습니다 — 신청해도 아무도 받지 않습니다(규칙은 D018 그대로).
 *  · 법률 · 세무는 상담 신청을 받지 않습니다 — 같은 주소에서 「광고」 표시와 함께 사무소 목록을 보여 줍니다(전과 같음).
 */
export default async function ConsultDetailPage({ params }: Props) {
  const { code: raw } = await params;
  const code = decodeURIComponent(raw);
  /* 코드 모양이 아니면 서버에 묻지 않습니다(서버도 같은 규칙으로 404) */
  if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(code)) notFound();
  const c = await apiGet<ConsultCatDetail>(`/consult/categories/${encodeURIComponent(code)}`, 60).catch(() => null);
  if (!c) notFound();

  if (c.status === 'APPROVED' && c.consultMode === 'LISTING_FEE') {
    const dir = await apiGet<DirList>(`/consult/directory/${encodeURIComponent(c.code)}`, 60).catch(() => null);
    return (
      <><div className="mal mal-narrow mal-proto" data-consult-dir={c.code}>
        <BackBar href="/mal/consult" label="생활 · 금융 상담" wrap={false} />
        <div className="page-head mal-head">
          <h1>{c.name}</h1>
          <p className="mal-desc">사무소 정보를 보고 <strong>직접 연락</strong>하십시오. 소개뱅크는 상담 신청을 받거나 연결하지 않습니다.</p>
        </div>
        <div className="mal-warn ok">
          <b>소개뱅크는 사무소를 추천하거나 연결하지 않습니다.</b>{' '}
          아래는 월 정액으로 게재한 「{dir?.adLabel ?? '광고'}」이며, 순서는 날마다 바뀝니다. 자격(등록) 확인을 마친 곳만 보입니다.
        </div>
        <section className="mal-panel" aria-labelledby="dir-h">
          <div className="mal-sh2"><b id="dir-h">게재 중인 사무소 {dir ? dir.entries.length : 0}곳</b><span className="mal-ls">{dir?.adLabel ?? '광고'}</span></div>
          {!dir || dir.entries.length === 0 ? (
            <p className="mal-empty">지금 게재 중인 사무소가 없습니다.</p>
          ) : (
            <ul className="mal-rows">
              {dir.entries.map((e) => (
                <li key={e.id} className="mal-row" data-dir-entry={e.id}>
                  <div className="mal-row-l">
                    <span className="mal-tag">{dir.adLabel}</span>
                    <b>{e.displayName}</b>
                    <span className="mal-ls">{[e.intro, e.sido].filter(Boolean).join(' · ')}</span>
                  </div>
                  <div className="mal-row-r">
                    {e.websiteUrl && <a className="mal-btn ghost" href={e.websiteUrl} target="_blank" rel="noopener noreferrer nofollow sponsored">홈페이지</a>}
                    <a className="mal-btn" href={`tel:${e.contactPhone.replace(/[^0-9]/g, '')}`}>{e.contactPhone}</a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <p className="mal-ls">자격(변호사 · 법무사 / 세무사 · 공인회계사 등록)을 확인한 사무소만 노출합니다. 상담 · 수임 조건과 결과는 사무소와 직접 정하십시오.</p>
        <div className="mal-act">
          <a className="mal-btn ghost" href={LIST}>다른 업종 보기</a>
          <a className="mal-btn ghost" href="/partner/listings">사무소 게재 신청</a>
        </div>
      </div><i hidden data-root-end="" /></>
    );
  }

  const open = consultOpen(c);
  const gated = c.publishMode === 'GATED';
  const ru = c.rules;
  const why = c.status === 'PENDING' ? '준비 중인 업종입니다.'
    : gated ? '자격 심사를 통과한 업체가 아직 없습니다.' : '받을 수 있는 인증업체가 아직 없습니다.';
  return (
    <><div className="mal mal-narrow mal-cd mal-proto" data-consult-detail={c.code} data-consult-mode={open ? 'open' : c.status === 'PENDING' ? 'hold' : 'none'}>
      <BackBar href="/mal/consult" label="생활 · 금융 상담" wrap={false} />
      <section className="mal-panel mal-cd-panel" aria-labelledby="cd-h">
        <header className="mal-cd-head">
          <div className="mal-cd-tags">
            <span className={`mal-tag${gated ? ' gated' : ''}`}>{gated ? '자격 확인' : '일반'}</span>
            <span className="mal-tag">상담신청형</span>
          </div>
          <h1 id="cd-h">{c.name}</h1>
          {CSL_DESC[c.code] && <p className="mal-cd-desc">{CSL_DESC[c.code]}</p>}
          <p className="mal-ls">
            {gated ? '등록 · 허가가 필요한 업종입니다 — 자격 심사를 통과한 업체에만 연결합니다.' : '입점 승인을 받은 파트너(사업자 · 본인인증 개인)에게 연결합니다.'}
          </p>
        </header>

        <div className="mal-cd-stats" role="group" aria-label="한눈에 보기">
          <div className="cell"><div className="k">받을 수 있는 인증업체</div><div className="v">{c.partnerCount}곳</div></div>
          <div className="cell"><div className="k">받는 지역</div><div className="v">{c.regions.length}곳</div></div>
          <div className="cell"><div className="k">신청 정보 전달</div><div className="v">{ru ? `${ru.deliverTo}곳에만` : '—'}</div></div>
        </div>

        <section className="mal-cd-sec" aria-labelledby="cd-reg-h">
          <h2 id="cd-reg-h">받는 지역</h2>
          {c.regions.length === 0 ? (
            <p className="mal-empty">아직 받는 지역이 없습니다.</p>
          ) : (
            <>
              <ul className="mal-cd-regions">
                {c.regions.map((r) => <li key={r.sido}><b>{r.sido}</b><span>{r.partnerCount}곳</span></li>)}
              </ul>
              <p className="mal-ls">여기에 없는 시 · 도로 신청하면 업체에 전달하지 않고 「받을 업체 없음」으로 알려 드립니다.</p>
            </>
          )}
        </section>

        {ru && (
          <section className="mal-cd-sec" aria-labelledby="cd-step-h">
            <h2 id="cd-step-h">이렇게 진행됩니다</h2>
            <ol className="mal-steps mal-cd-steps">
              <li className="on"><span className="n">1</span><div><b>상담 신청</b><p>이름 · 휴대폰 · 이메일 · 지역을 적습니다. 로그인하지 않아도 됩니다.</p></div></li>
              <li><span className="n">2</span><div><b>휴대폰 확인</b><p>인증번호 6자리를 {ru.otpMinutes}분 안에 넣습니다. 확인 전에는 업체에 아무것도 가지 않습니다.</p></div></li>
              <li><span className="n">3</span><div><b>인증업체 {ru.deliverTo}곳이 연락</b><p>상담 요약이 그 업체에 가고, 이름 · 휴대폰 · 이메일은 그 업체가 연락처를 열 때 전달됩니다.</p></div></li>
            </ol>
          </section>
        )}

        <section className="mal-cd-sec" aria-labelledby="cd-note-h">
          <h2 id="cd-note-h">알아 두실 것</h2>
          <ul className="mal-cd-notes">
            <li>신청 정보는 동의하신 업체 <b>1곳에만 전달</b>됩니다 — 여러 곳에 넘기지 않습니다</li>
            {SAFE_CONSULT.slice(1).map((x) => <li key={x}>{x}</li>)}
            {ru && <li>같은 번호로 하루 {ru.dailyLimit}번까지 신청할 수 있고, 같은 업종은 24시간 안에 다시 신청할 수 없습니다</li>}
            {ru && <li>업체가 {ru.viewTtlHours}시간 안에 확인하지 않으면 다른 인증업체 1곳으로 넘깁니다</li>}
          </ul>
        </section>

        <div className="mal-cd-bar">
          <a className="mal-btn ghost" href={LIST}>목록으로</a>
          <span className="sp" />
          {open ? (
            <a className="mal-btn mal-cd-go" href={`/mal/consult/${encodeURIComponent(c.code)}/apply`}>
              <span>상담 신청</span><small>인증업체 1곳이 연락드립니다</small>
            </a>
          ) : (
            <>
              <span className="mal-ls">{why}</span>
              <button className="mal-btn mal-cd-go" type="button" disabled><span>준비 중</span><small>아직 받지 않습니다</small></button>
            </>
          )}
        </div>
      </section>
    </div><i hidden data-root-end="" /></>
  );
}

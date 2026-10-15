import type { Metadata } from 'next';
import { apiGet } from '@/lib/api';
import { ConsultRows } from '@/components/mal/ConsultRows';
import type { ConsultCat } from '@/components/mal/types';
import '@/styles/mal.css';
import { BackBar } from '@/components/common/BackBar';

export const metadata: Metadata = { title: '생활 · 금융 상담' };

/**
 * SB-MAL-CSL-020 — 안심소개 「생활 · 금융 상담」 업종 목록 (시안 #/mal/consult · 서버 D005 · D016 · D017 · D018)
 *
 * 준비 중 업종도 감추지 않고 보여 줍니다 — 감추면 "왜 없냐" 문의가 옵니다.
 * 받을 인증업체가 0곳이면 신청 버튼을 막습니다 — 신청해도 아무도 받지 않습니다.
 * 법률 · 세무(월 정액 노출형 · D019)는 「사무소 보기」로 갑니다.
 * v10.31 (w2 · 시안 기준) — 「← 안심소개(으)로 돌아가기」(시안 돌아가기 줄) · 단추 색 시안 보라(.mal-proto). 안내 띠 · 입점 신청 줄(개발에만 있던 것)은 남깁니다.
 */
export default async function ConsultListPage() {
  const cats = await apiGet<ConsultCat[]>('/consult/categories', 60).catch(() => [] as ConsultCat[]);
  return (
    <><div className="mal mal-narrow mal-proto mal-csl32">{/* v10.32 — 시안 폭 · 단추 색(상담 신청 보라 · 상세 보기 회색 테두리) */}
      <BackBar href="/mall?axis=consult" label="안심소개" wrap={false} />
      <div className="page-head mal-head">
        <h1>생활 · 금융 상담</h1>
        <p className="mal-desc">업종을 고르고 상담을 신청하면 <strong>인증된 업체 1곳</strong>이 연락드립니다.</p>
      </div>
      <div className="mal-warn ok">
        신청 정보는 동의하신 업체 1곳에만 전달되고, 휴대폰 확인을 마친 신청만 전달됩니다.
      </div>
      <section className="mal-panel" aria-labelledby="csl-list-h">
        <div className="mal-sh2">
          <b id="csl-list-h">업종 {cats.length > 0 ? `${cats.length}종` : ''}</b>
          <span className="mal-ls">자격 확인 업종은 자격 심사를 통과한 업체에만 연결합니다</span>
        </div>
        <ConsultRows cats={cats} label="상담 신청" />
      </section>
      <div className="mal-cta">
        <b>업체이신가요?</b>
        <span>안심소개 파트너센터에서 입점 신청을 하시면 이 목록에 오릅니다</span>
        <a className="mal-btn ghost sm" href="/partner/apply">입점 신청</a>
      </div>
    </div><i hidden data-root-end="" /></>
  );
}

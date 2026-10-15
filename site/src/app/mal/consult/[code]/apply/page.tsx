import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { apiGet } from '@/lib/api';
import { BackBar } from '@/components/common/BackBar';
import { ConsultForm } from '@/app/consult/ConsultForm';
import { consultOpen, type ConsultCat } from '@/components/mal/types';
import '@/styles/mal.css';

type Props = { params: Promise<{ code: string }> };

export const metadata: Metadata = { title: '상담 신청' };

/**
 * SB-MAL-CSL-030 — 상담 신청 · 휴대폰 확인 · 접수 (시안 #/mal/consult/{code}/apply · D018)
 *
 * v10.24 — 주소가 /mal/consult/{code} 에서 여기로 옮겨졌습니다(앞 주소는 업종 상세 SB-MAL-CSL-025). 신청서 자체는 전과 같습니다.
 *  · 리드형 업종     신청서(이름 · 휴대폰 · 지역 → 인증번호 → 인증업체 1곳 전달)
 *  · 받을 업체 0곳   신청서를 내지 않고 까닭을 알립니다 — 신청해도 아무도 받지 않습니다(규칙은 D018 그대로)
 *  · 법률 · 세무     신청서가 없습니다(월 정액 노출형 · D019) — 사무소 목록(업종 상세 주소)으로 보냅니다
 */
export default async function ConsultApplyPage({ params }: Props) {
  const { code: raw } = await params;
  const code = decodeURIComponent(raw);
  const cats = await apiGet<ConsultCat[]>('/consult/categories', 60).catch(() => [] as ConsultCat[]);
  const c = cats.find((x) => x.code === code);
  if (!c) notFound();
  const detail = `/mal/consult/${encodeURIComponent(c.code)}`;
  if (c.status === 'APPROVED' && c.consultMode === 'LISTING_FEE') redirect(detail);

  const open = consultOpen(c);
  return (
    <><div className="mal mal-proto mal-csl33" data-consult-code={c.code}>{/* v10.32 (추가) — 시안 malcsl: 넓은 카드(1140) · 반폭 입력칸(560) · 제목 아래 설명 · 「상담 신청」 보라 왼쪽 */}
      <BackBar href={detail} label={c.name} wrap={false} />
      <div className="page-head mal-head">
        <h1>{c.name} 상담 신청</h1>
        <p className="mal-desc">상담을 신청하면 인증된 업체 1곳이 연락드립니다. 신청 정보는 그 업체에만 전달됩니다.</p>
      </div>
      {c.publishMode === 'GATED' && open && (
        <div className="mal-warn ok"><b>자격 확인 업종입니다.</b> 자격 심사를 통과한 업체에만 연결합니다.</div>
      )}
      {open ? (
        <section className="mal-panel" id="csl-form" aria-labelledby="csl-form-h">
          <div className="mal-sh2">
            <b id="csl-form-h">{c.name} 상담 신청서</b>
            <span className="mal-ls">휴대폰 확인을 마친 뒤 인증업체 1곳에만 전달됩니다</span>
          </div>
          <ConsultForm categories={cats} initialId={c.id} fixed />
        </section>
      ) : (
        <>
          <div className="mal-warn" role="status">
            <b>{c.name} 상담은 아직 받지 않습니다.</b>{' '}
            {c.status === 'PENDING' ? '준비 중인 업종입니다.'
              : c.publishMode === 'GATED' ? '자격 심사를 통과한 업체가 아직 없습니다.' : '받을 수 있는 인증업체가 아직 없습니다.'}
          </div>
          <div className="mal-act">
            <a className="mal-btn ghost" href={detail}>업종 상세</a>
            <a className="mal-btn ghost" href="/mall?axis=consult">다른 업종 보기</a>
          </div>
        </>
      )}
    </div><i hidden data-root-end="" /></>
  );
}

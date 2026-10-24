import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { apiGet } from '@/lib/api';
import { BackBar } from '@/components/common/BackBar';
import { ConsultForm } from '@/app/consult/ConsultForm';
import { consultOpen, type ConsultCat } from '@/components/mal/types';
import '@/styles/mal.css';
import { getTranslations } from 'next-intl/server';

type Props = { params: Promise<{ code: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('consult'))('common.title') };
}

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
  const t = await getTranslations('consult');
  return (
    <><div className="mal mal-proto mal-csl33" data-consult-code={c.code}>{/* v10.32 (추가) — 시안 malcsl: 넓은 카드(1140) · 반폭 입력칸(560) · 제목 아래 설명 · 「상담 신청」 보라 왼쪽 */}
      <BackBar href={detail} label={c.name} wrap={false} />
      <div className="page-head mal-head">
        <h1>{t('common.headPicked', { name: c.name })}</h1>
        <p className="mal-desc">{t('apply.desc')}</p>
      </div>
      {c.publishMode === 'GATED' && open && (
        <div className="mal-warn ok">{t.rich('common.gatedBox', { b: (x) => <b>{x}</b> })}</div>
      )}
      {open ? (
        <section className="mal-panel" id="csl-form" aria-labelledby="csl-form-h">
          <div className="mal-sh2">
            <b id="csl-form-h">{t('common.formHeadPicked', { name: c.name })}</b>
            <span className="mal-ls">{t('apply.formNote')}</span>
          </div>
          <ConsultForm categories={cats} initialId={c.id} fixed />
        </section>
      ) : (
        <>
          <div className="mal-warn" role="status">
            <b>{t('common.notYet', { name: c.name })}</b>{' '}
            {c.status === 'PENDING' ? t('common.whyPending')
              : c.publishMode === 'GATED' ? t('common.whyGated') : t('common.whyNone')}
          </div>
          <div className="mal-act">
            <a className="mal-btn ghost" href={detail}>{t('apply.detail')}</a>
            <a className="mal-btn ghost" href="/mall?axis=consult">{t('common.otherCats')}</a>
          </div>
        </>
      )}
    </div><i hidden data-root-end="" /></>
  );
}

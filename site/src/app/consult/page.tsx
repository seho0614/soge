import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet, apiGetPersonal } from '@/lib/api';
import { ConsultForm, type ConsultCategory } from './ConsultForm';
import { ConsultRows } from '@/components/mal/ConsultRows';
import { consultOpen } from '@/components/mal/types';
import { BackBar } from '@/components/common/BackBar';
import '@/styles/mal.css';
import { getTranslations } from 'next-intl/server';

import { dtKst, ymdKst } from '@/lib/format';
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('consult'))('common.title') };
}

interface MyConsult {
  id: string; categoryName: string; summary: string; sido: string | null; sigungu: string | null;
  createdAt: string; assignState: string; target: number; sentTo: number; closeReason: string | null;
  providedTo: Array<{ company: string; viewedAt: string }>; contactPurged: boolean;
}

const ST = {
  OPEN: 'mine.st.open', ASSIGNED: 'mine.st.assigned', UNMATCHED: 'mine.st.unmatched', CLOSED: 'mine.st.closed',
  NO_PARTNER: 'mine.st.noPartner',
} as const;
const stKey = (s: string) => (ST as Record<string, (typeof ST)[keyof typeof ST] | undefined>)[s];

type Props = { searchParams: Promise<{ cat?: string }> };

/**
 * SB-MAL-CSL-010 상담 신청 — 안심소개 「생활·금융 상담」 (D008 · 시안 `malcsl`)
 *
 * 시안 순서대로 **업종 고르기 → 신청서 → 휴대폰 확인**입니다. 업종 줄의 「고르기」는 ?cat=CSL_… 로 신청서 업종을 미리 고릅니다.
 *
 * 20261002 (v10.11 · D018) — 올리신 kit(v10.4.7)의 상담 신청 흐름으로 바꿨습니다.
 *  · **로그인 없이 신청합니다.** 이름 · 휴대폰을 적고 인증번호 6자리를 확인하면 인증업체 **1곳**에 전달됩니다.
 *  · 확인 전에는 업체에 아무것도 가지 않습니다. 받을 업체가 없으면 전달하지 않고 그렇게 알려 줍니다.
 *  · 로그인한 채 신청하면 아래 「내 상담 신청」에 남고, 연락처를 받아 간 업체가 보입니다.
 *  · 법률 · 세무는 상담 신청을 받지 않는 월 정액 노출형(D019)이라 「사무소 보기」로 갑니다.
 *
 * v10.31 (w2 · 시안 malcsl 기준) — 「← 생활 · 금융 상담(으)로 돌아가기」 · 업종 줄마다 「상세 보기」 + 「상담 신청」(→ /mal/consult/{code}/apply) · 단추 색은 시안 보라(.mal-proto).
 *   개발에 있던 한 쪽 신청서 · 「내 상담 신청」은 시안 업종 목록 아래에 그대로 남깁니다(?cat= 로 업종을 미리 고르는 주소도 그대로).
 */
export default async function ConsultPage({ searchParams }: Props) {
  const { cat } = await searchParams;
  const p = await me();
  const t = await getTranslations('consult');

  const cats = await apiGet<ConsultCategory[]>('/consult/categories', 60).catch(() => [] as ConsultCategory[]);
  const mine = p ? await apiGetPersonal<MyConsult[]>('/me/consult-requests').catch(() => [] as MyConsult[]) : [];
  const picked = cats.find((c) => c.code === cat);
  /* 법률 · 세무(월 정액 노출형)는 신청서가 없습니다 — 사무소 목록으로 보냅니다 */
  if (picked && picked.status === 'APPROVED' && picked.consultMode === 'LISTING_FEE') {
    redirect(`/mal/consult/${encodeURIComponent(picked.code)}`);
  }
  const pickedOpen = picked ? consultOpen(picked) : false;

  return (
    <><div className="mal mal-narrow mal-proto mal-csl32">{/* v10.32 — 시안 폭 · 단추 색(상담 신청 보라 · 상세 보기 회색 테두리) */}
      <BackBar href="/mal/consult" label={t('common.consultName')} wrap={false} />
      <div className="page-head mal-head">
        <h1>{picked ? t('common.headPicked', { name: picked.name }) : t('common.title')}</h1>
        <p className="mal-desc">
          {t('page.desc')}
        </p>
      </div>

      <section className="mal-panel" aria-labelledby="csl-pick-h">
        <div className="mal-sh2">
          <b id="csl-pick-h">{t('common.cats')} {cats.length > 0 ? t('common.catsCount', { n: String(cats.length) }) : ''}</b>
          <span className="mal-ls">{t('common.gatedNote')}</span>
        </div>
        <ConsultRows cats={cats} label={t('common.apply')} current={picked?.code} />
      </section>

      {picked && !pickedOpen && (
        <div className="mal-warn" role="status">
          <b>{t('common.notYet', { name: picked.name })}</b>{' '}
          {picked.status === 'PENDING' ? t('common.whyPending') : picked.publishMode === 'GATED'
            ? t('common.whyGated') : t('common.whyNone')}{' '}
          <a href="/consult">{t('common.otherCats')}</a>
        </div>
      )}

      <section className="mal-panel" id="csl-form" aria-labelledby="csl-form-h">
        <div className="mal-sh2">
          <b id="csl-form-h">{picked ? t('common.formHeadPicked', { name: picked.name }) : t('common.formHead')}</b>
          <span className="mal-ls">{t('page.formNote')}</span>
        </div>
        {picked?.publishMode === 'GATED' && pickedOpen && (
          <div className="mal-warn ok">{t.rich('common.gatedBox', { b: (c) => <b>{c}</b> })}</div>
        )}
        <ConsultForm key={picked?.id ?? 'any'} categories={cats} initialId={pickedOpen ? picked?.id : undefined} />
        {!p && (
          <p className="mal-ls" data-guest="1">
            {t.rich('page.guest', { a: (c) => <a href="/login">{c}</a> })}
          </p>
        )}
      </section>

      {p && (
        <>
          <h2 className="mal-h2">{t('mine.head')} <em>{mine.length}</em></h2>
          {mine.length === 0 && <p className="hint">{t('mine.empty')}</p>}
          <div className="mal-mine-list">
            {mine.map((m) => (
              <article key={m.id} className="mal-panel" data-consult={m.id}>
                <header className="card-top">
                  <b>{m.categoryName}</b> <span className="badge">{(() => { const k = stKey(m.assignState); return k ? t(k) : m.assignState; })()}</span>
                </header>
                <p>{m.summary}</p>
                <p className="hint">
                  {[m.sido, m.sigungu].filter(Boolean).join(' ')} · {t('mine.appliedOn', { dt: dtKst(m.createdAt) })} ·
                  {' '}{m.assignState === 'NO_PARTNER' ? t('mine.sentNone') : t('mine.sentTo', { n: String(m.sentTo) })}
                  {m.closeReason ? ` · ${t('mine.closed', { reason: m.closeReason })}` : ''}
                </p>
                <p className="hint">
                  {t('mine.provided')}{' '}
                  {m.providedTo.length
                    ? m.providedTo.map((x) => `${x.company}(${ymdKst(x.viewedAt)})`).join(' · ')
                    : t('mine.providedNone')}
                  {m.contactPurged ? ` · ${t('mine.purged')}` : ''}
                </p>
              </article>
            ))}
          </div>
        </>
      )}
    </div><i hidden data-root-end="" /></>
  );
}

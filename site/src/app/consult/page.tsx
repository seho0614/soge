import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet, apiGetPersonal } from '@/lib/api';
import { ConsultForm, type ConsultCategory } from './ConsultForm';
import { ConsultRows } from '@/components/mal/ConsultRows';
import { consultOpen } from '@/components/mal/types';
import { BackBar } from '@/components/common/BackBar';
import '@/styles/mal.css';

import { dtKst, ymdKst } from '@/lib/format';
export const metadata: Metadata = { title: '상담 신청' };

interface MyConsult {
  id: string; categoryName: string; summary: string; sido: string | null; sigungu: string | null;
  createdAt: string; assignState: string; target: number; sentTo: number; closeReason: string | null;
  providedTo: Array<{ company: string; viewedAt: string }>; contactPurged: boolean;
}

const ST: Record<string, string> = {
  OPEN: '업체 찾는 중', ASSIGNED: '업체에 보냄', UNMATCHED: '맞는 업체 없음 — 운영 확인 중', CLOSED: '종료',
  NO_PARTNER: '받을 업체 없음 — 전달하지 않았습니다',
};

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
      <BackBar href="/mal/consult" label="생활 · 금융 상담" wrap={false} />
      <div className="page-head mal-head">
        <h1>{picked ? `${picked.name} 상담 신청` : '상담 신청'}</h1>
        <p className="mal-desc">
          이사 · 청소 · 인테리어 · 렌탈 · 보험 같은 생활 · 금융 상담을 신청하면 인증된 업체 1곳이 연락드립니다.
        </p>
      </div>

      <section className="mal-panel" aria-labelledby="csl-pick-h">
        <div className="mal-sh2">
          <b id="csl-pick-h">업종 {cats.length > 0 ? `${cats.length}종` : ''}</b>
          <span className="mal-ls">자격 확인 업종은 자격 심사를 통과한 업체에만 연결합니다</span>
        </div>
        <ConsultRows cats={cats} label="상담 신청" current={picked?.code} />
      </section>

      {picked && !pickedOpen && (
        <div className="mal-warn" role="status">
          <b>{picked.name} 상담은 아직 받지 않습니다.</b>{' '}
          {picked.status === 'PENDING' ? '준비 중인 업종입니다.' : picked.publishMode === 'GATED'
            ? '자격 심사를 통과한 업체가 아직 없습니다.' : '받을 수 있는 인증업체가 아직 없습니다.'}{' '}
          <a href="/consult">다른 업종 보기</a>
        </div>
      )}

      <section className="mal-panel" id="csl-form" aria-labelledby="csl-form-h">
        <div className="mal-sh2">
          <b id="csl-form-h">{picked ? `${picked.name} 상담 신청서` : '상담 신청서'}</b>
          <span className="mal-ls">신청 정보는 휴대폰 확인을 마친 뒤 인증업체 1곳에만 전달됩니다</span>
        </div>
        {picked?.publishMode === 'GATED' && pickedOpen && (
          <div className="mal-warn ok"><b>자격 확인 업종입니다.</b> 자격 심사를 통과한 업체에만 연결합니다.</div>
        )}
        <ConsultForm key={picked?.id ?? 'any'} categories={cats} initialId={pickedOpen ? picked?.id : undefined} />
        {!p && (
          <p className="mal-ls" data-guest="1">
            로그인하지 않아도 신청할 수 있습니다. <a href="/login">로그인</a>한 채 신청하면 「내 상담 신청」에서 연락처를 받아 간 업체를 볼 수 있습니다.
          </p>
        )}
      </section>

      {p && (
        <>
          <h2 className="mal-h2">내 상담 신청 <em>{mine.length}</em></h2>
          {mine.length === 0 && <p className="hint">아직 신청한 상담이 없습니다.</p>}
          <div className="mal-mine-list">
            {mine.map((m) => (
              <article key={m.id} className="mal-panel" data-consult={m.id}>
                <header className="card-top">
                  <b>{m.categoryName}</b> <span className="badge">{ST[m.assignState] ?? m.assignState}</span>
                </header>
                <p>{m.summary}</p>
                <p className="hint">
                  {[m.sido, m.sigungu].filter(Boolean).join(' ')} · {dtKst(m.createdAt)} 신청 ·
                  {' '}{m.assignState === 'NO_PARTNER' ? '전달한 업체 없음' : `업체 ${m.sentTo}곳에 보냄`}
                  {m.closeReason ? ` · 종료: ${m.closeReason}` : ''}
                </p>
                <p className="hint">
                  연락처를 받아 간 업체:{' '}
                  {m.providedTo.length
                    ? m.providedTo.map((x) => `${x.company}(${ymdKst(x.viewedAt)})`).join(' · ')
                    : '아직 없음'}
                  {m.contactPurged ? ' · 보관 기한이 지나 연락처를 파기했습니다' : ''}
                </p>
              </article>
            ))}
          </div>
        </>
      )}
    </div><i hidden data-root-end="" /></>
  );
}

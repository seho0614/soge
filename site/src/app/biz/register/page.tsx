import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import type { Gwan } from '@/lib/types';
import { codeList, formCopy, uiMessages } from '@/lib/content';
import Link from 'next/link';
import { RegisterTabs } from '@/components/RegisterTabs';
import { BackBar } from '@/components/common/BackBar';

export const metadata: Metadata = { title: '소개창업 매물 등록' };

interface Category { id: string; name: string; gwanCode: string }

/**
 * SB-BIZ-REG-010 — 역할 탭. 관 상태를 노출 조건으로 씁니다
 * v10.29 — 시안 scRegBiz 배치(돌아가기 · 「사업 기회 등록」 제목 · 입력 판 · 검수 안내 · 등록 신청/등록 취소)로 그립니다.
 *   역할 탭(소개합니다 · 소개받기 — 개발에 있던 것 · 남김) · API 는 기존 부품(RegisterTabs → ListingForm) 그대로입니다.
 * v10.31 (w2 · 시안 기준) — 시안 두 판(1. 기본 정보 · 2. 거래 조건)과 「한줄 소개 · 희망 금액」 칸(서버 listings.summary · deal_amount 신설)으로 그립니다.
 *   검수 안내는 시안 문구(「영업일 기준 24시간 이내」 — 운영 문구 REVIEW_SLA_NOTE · 서버 검수 마감도 영업일 기준 fn_review_sla_due).
 */
export default async function BizRegisterPage() {
  const p = await me();
  if (!p) redirect('/login');
  if (!p.identityVerifiedAt) redirect('/verify');

  const [gwans, cats, copy, roles, messages] = await Promise.all([
    apiGet<Gwan[]>('/gwans', 300),
    apiGet<Category[]>('/categories?gwanCode=BIZ', 300).catch(() => [] as Category[]),
    formCopy('BIZ'),
    codeList('register.role'),
    uiMessages(),
  ]);
  const gwan = gwans.find((g) => g.code === 'BIZ');
  /* 시안 문구(운영 문구 REVIEW_SLA_NOTE) — 첫 문장을 굵게 */
  const slaMsg = (messages as Record<string, string>).REVIEW_SLA_NOTE;
  const slaM = slaMsg?.match(/^(.+?\.)\s+(.*)$/s);
  const sla: [string, string] | null = slaM ? [slaM[1] ?? '', slaM[2] ?? ''] : null;
  if (!gwan) notFound();

  return (
    <><div className="gw">
      <div className="gw-wrap gw-aiw gw-regfull">{/* v10.32 — 시안 폭 · 1·2 판을 따로 된 카드로 · 등록 신청 단추를 왼쪽 보통 크기로 */}
        <BackBar href="/biz" label={gwan.name} wrap={false} />
        <div className="gw-pgh"><div>
          <h1>사업 기회 등록</h1>
          {/* v10.27 (G-201) — 무엇을 올리는 곳인지, 사업자 인증은 어디서 하는지 첫 줄에 적습니다(주소는 바꾸지 않음 — 이미 쓰는 링크 보존). */}
          <p data-biz-reg-note>
            소개창업은 가맹 · 신규 출점 · 점포 양수도를 다룹니다. 고정자산이 넘어가는지가 관을 가르는 기준입니다 (A-01).
            {gwan.name}에 소개할 매물(창업 · 가맹 · 양도 등)을 올리는 곳입니다.
            사업자 인증은 여기가 아니라 <Link href="/my/business">나의공간 › 사업자 전환</Link>에서 합니다.
          </p>
        </div></div>
        <div className="gw-regwrap">
          <RegisterTabs
            gwan={gwan}
            categories={cats.map((c) => ({ id: c.id, name: c.name }))}
            copy={copy}
            roles={roles}
            messages={messages}
            sections
            /* v10.32 (추가) — 시안: 검수 안내 띠 아래 [등록 신청] [등록 취소] 나란히(전: 등록 신청이 띠 위 · 등록 취소가 띠 아래 따로) */
            note={<div className="gw-nt gw-info" data-msg="REVIEW_SLA_NOTE">{sla
              ? <><b>{sla[0]}</b> {sla[1]}</>
              : <><b>등록하면 검수를 거칩니다.</b> 영업일 기준 24시간 이내에 처리되고, 반려되면 사유와 수정 가이드가 함께 옵니다.</>}</div>}
            cancel={<Link className="gw-bo" href="/biz">등록 취소</Link>}
          />
        </div>
      </div>
    </div><i hidden data-root-end="" /></>
  );
}

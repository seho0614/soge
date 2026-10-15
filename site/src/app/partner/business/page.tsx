import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { ymdKst } from '@/lib/format';
import { Bg, bizNo, Empty, GRADE_KO, Note, PARTNER_ST, Pgh, Tabs, Tw, won } from '@/components/partner/ui';
import { BrandForm, ChangeRequestForm, InviteAccept, SiteForm, SiteRemove, StaffInviteForm, StaffRemove } from './BizForms';

export const metadata: Metadata = { title: '회사 · 계정' };

interface Dash {
  applied: boolean; company?: string; grade?: string; status?: string; bizRegNo?: string;
  regions?: number; services?: { approved: number; in_review: number }; unpaidCap?: number;
}
interface Company {
  info: { company: string; bizRegNo: string; ceoName: string | null; bizType: string | null; bizItem: string | null; addressShort: string;
    hasAddress: boolean; verifiedAt: string | null; ntsStatus: string | null; ntsEnv: string | null; createdAt: string; grade: string; status: string; approvedAt: string | null };
  isOwner: boolean;
  changes: Array<{ id: string; field: string; afterValue: string; reason: string; state: string; decisionReason: string | null; createdAt: string }>;
  staff: Array<{ role: string; accountId: string; email: string; name: string | null; joined: boolean; canSettle: boolean; invitedAt: string | null }>;
  terms: Array<{ code: string; title: string; required: boolean; status: string; agreed: boolean | null; agreedAt: string | null; version: string | null }>;
  brand: { brandName: string; logoFileId: string | null; intro: string | null } | null;
  sites: Array<{ id: string; name: string; sido: string; sigungu: string | null }>;
  notes: { info: string; staff: string; brand: string };
}
const FIELD: Record<string, string> = { ADDRESS: '주소 변경', COMPANY_NAME: '상호 변경', CEO_NAME: '대표자 변경', BIZ_TYPE: '업태 변경', BIZ_ITEM: '종목 변경' };
const CH: Record<string, ['ok' | 'wait' | 'no' | 'off', string]> = { REQUESTED: ['wait', '승인 대기'], APPROVED: ['ok', '반영됨'], REJECTED: ['no', '반려'], WITHDRAWN: ['off', '철회'] };
type Tab = 'info' | 'acct' | 'terms' | 'brand';

/**
 * SB-PTC-CTR-610 회사 · 계정 — v10.31 (W5 · 10/10 시안 기준 scPtnBiz) 탭 4개: 사업자 정보 · 계정 · 약관 · 동의 · 회사 관리
 *   사업자 정보: 항목 · 값 표(+ 개발에만 있던 본인인증 · 사업자 인증 · 등급 · 승인 업종 · 지역 줄 유지) + 변경 요청(실제 접수 · 승인은 본사)
 *   계정: 대표 · 직원(초대 → 받아들이면 합류 · 권한 상담/정산) — 직원에게는 다른 사람 이메일을 가립니다
 *   약관 · 동의: 내가 동의한 판(+ 파트너 이용약관 — 법무 검토 중이면 그렇게 표시)
 *   회사 관리: 브랜드명 · 로고 · 등록 소재
 *   주소는 시 · 군 · 구까지만 보입니다(시안 「서울 송파구 ***」).
 */
export default async function BusinessPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const p = await me();
  if (!p) redirect('/login');
  const sp = await searchParams;
  const tab: Tab = (['info', 'acct', 'terms', 'brand'] as const).includes(sp.tab as Tab) ? (sp.tab as Tab) : 'info';

  const [d, c, inv] = await Promise.all([
    apiGet<Dash>('/partner/dashboard', 0).catch(() => null),
    apiGet<Company>('/partner/company', 0).catch(() => null),
    apiGet<Array<{ businessId: string; company: string }>>('/partner/staff/invitations', 0).catch(() => []),
  ]);
  const st = PARTNER_ST[d?.status ?? ''] ?? [d?.status ?? '—', 'off'];
  const href = (t: Tab) => (t === 'info' ? '/partner/business' : `/partner/business?tab=${t}`);

  return (
    <><Pgh title="회사 · 계정" sub="사업자 정보 · 계정 · 약관 · 브랜드를 한 자리에서 봅니다." />
      {inv.map((x) => <InviteAccept key={x.businessId} businessId={x.businessId} company={x.company} />)}
      <Tabs cur={tab} items={[
        { key: 'info', label: '사업자 정보', href: href('info') },
        { key: 'acct', label: '계정', href: href('acct') },
        { key: 'terms', label: '약관 · 동의', href: href('terms') },
        { key: 'brand', label: '회사 관리', href: href('brand') },
      ]} />

      {tab === 'info' && (
        <>
          <Tw head={['항목', '값']}>
            {c ? (
              <>
                <tr><td><b>상호</b></td><td>{c.info.company}</td></tr>
                <tr><td><b>사업자등록번호</b></td><td>{c.info.bizRegNo ? bizNo(c.info.bizRegNo) : <>없음 — <b>개인으로 활동</b> <span className="pt-ls">(본인인증 · v10.38 P2P)</span></>}</td></tr>
                <tr><td><b>대표자</b></td><td>{c.info.ceoName ?? '—'}</td></tr>
                <tr><td><b>업태 · 종목</b></td><td>{[c.info.bizType, c.info.bizItem].filter(Boolean).join(' · ') || '—'}</td></tr>
                <tr><td><b>주소</b></td><td>{c.info.addressShort ? `${c.info.addressShort} ***` : c.info.hasAddress ? '등록됨 ***' : '—'}</td></tr>
                <tr><td><b>입점일</b></td><td>{c.info.approvedAt ? ymdKst(c.info.approvedAt) : '심사 중'}</td></tr>
              </>
            ) : null}
            <tr><td><b>본인인증</b></td><td><Bg tone={p.identityVerifiedAt ? 'ok' : 'no'}>{p.identityVerifiedAt ? '완료' : '필요'}</Bg></td></tr>
            <tr><td><b>사업자 인증</b></td><td>
              <Bg tone={p.businessVerifiedAt ? 'ok' : 'off'}>{p.businessVerifiedAt ? '완료' : '선택'}</Bg>
              {!p.businessVerifiedAt ? <> <span className="pt-ls">사업자로 받으실 때만 —</span> <Link href="/verify">인증하러 가기 →</Link></> : null}
              {c?.info.ntsEnv && c.info.ntsEnv !== 'LIVE' ? <span className="pt-ls"> · 국세청 조회 {c.info.ntsEnv}</span> : null}
            </td></tr>
            {d?.applied ? (
              <>
                <tr><td><b>등급 · 상태</b></td><td><b>{GRADE_KO[d.grade ?? ''] ?? d.grade ?? '—'}</b> <Bg tone={st[1]}>{st[0]}</Bg></td></tr>
                <tr><td><b>승인 업종</b></td><td>{d.services?.approved ?? 0}개{d.services?.in_review ? <span className="pt-ls"> · 검수 중 {d.services.in_review}</span> : null}</td></tr>
                <tr><td><b>지역</b></td><td>{d.regions ?? 0}곳 <Link className="pt-bo sm" href="/partner/regions">바꾸기</Link></td></tr>
                <tr><td><b>이전 후불 미납 한도</b></td><td>{won(d.unpaidCap)}원<span className="pt-ls"> · 전환 전 미청구분에만 씁니다(리드 이용료는 선불)</span></td></tr>
              </>
            ) : null}
          </Tw>
          {c?.changes.map((x) => (
            <div className="pt-crow" key={x.id} style={{ marginTop: 10 }}>
              <div><b>변경 요청 — {FIELD[x.field] ?? x.field}: {x.afterValue}</b><span className="pt-ls">{ymdKst(x.createdAt)} · {x.reason}{x.decisionReason ? ` · 본사: ${x.decisionReason}` : ''}</span></div>
              <Bg tone={CH[x.state]?.[0] ?? 'off'}>{CH[x.state]?.[1] ?? x.state}</Bg>
            </div>
          ))}
          {c?.isOwner ? <ChangeRequestForm /> : null}
          <Note kind="warn"><b>{c?.notes.info ?? '국세청 조회 결과를 판단 근거로 쓰지 마십시오.'}</b></Note>
          {!d?.applied ? (
            <div style={{ marginTop: 14 }}>
              <Empty>아직 입점 신청을 하지 않으셨습니다.<div style={{ marginTop: 12 }}><Link className="pt-bp" href="/partner/apply">입점 신청하기</Link></div></Empty>
            </div>
          ) : null}
        </>
      )}

      {tab === 'acct' && (c ? (
        <>
          <Tw head={['구분', '아이디', '권한', '상태', '']}>
            {c.staff.map((s) => (
              <tr key={s.accountId}>
                <td><b>{s.role === 'OWNER' ? '대표 계정' : '직원 계정'}</b>{s.name ? <div className="pt-ls">{s.name}</div> : null}</td>
                <td>{s.email}</td>
                <td>{s.role === 'OWNER' ? '대표' : s.canSettle ? '상담 · 정산' : '상담'}</td>
                <td>{s.joined ? <Bg tone="ok">활성</Bg> : <Bg tone="wait">초대 대기</Bg>}</td>
                <td>{c.isOwner && s.role !== 'OWNER' ? <StaffRemove accountId={s.accountId} /> : null}</td>
              </tr>
            ))}
          </Tw>
          {c.isOwner ? <StaffInviteForm /> : null}
          <Note kind="warn"><b>{c.notes.staff}</b></Note>
        </>
      ) : <Empty>파트너가 아닙니다.</Empty>)}

      {tab === 'terms' && (c ? (
        <>
          <Tw head={['문서', '동의', '일자']}>
            {c.terms.map((t) => (
              <tr key={t.code}>
                <td><b>{t.title}</b>{t.status !== 'PUBLISHED' ? <span className="pt-ls"> · 법무 검토 중(아직 시행 전)</span> : null}</td>
                <td>{t.status !== 'PUBLISHED' ? <Bg tone="off">시행 전</Bg> : t.agreed ? <Bg tone="ok">동의</Bg> : <Bg tone="off">미동의</Bg>}</td>
                <td>{t.agreedAt ? `${ymdKst(t.agreedAt)}${t.version ? ` · ${t.version}판` : ''}` : '—'}</td>
              </tr>
            ))}
          </Tw>
          <Note kind="info">동의하신 약관은 <Link href="/terms">약관 페이지</Link>에서 판본별로 보실 수 있습니다. <b>개정되면 다시 동의를 받습니다.</b></Note>
        </>
      ) : <Empty>약관을 불러오지 못했습니다.</Empty>)}

      {tab === 'brand' && (c ? (
        <>
          <div className="pt-dsum">
            <div className="dr"><span>브랜드명</span><b>{c.brand?.brandName ?? '—'}</b></div>
            <div className="dr"><span>로고</span><b>{c.brand?.logoFileId ? '등록됨' : '없음'}</b></div>
            <div className="dr"><span>등록 소재</span><b>{c.sites.length}곳</b></div>
          </div>
          {c.sites.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <Tw head={['소재', '지역', '']}>
                {c.sites.map((s) => <tr key={s.id}><td><b>{s.name}</b></td><td>{s.sido} {s.sigungu ?? ''}</td><td>{c.isOwner ? <SiteRemove id={s.id} /> : null}</td></tr>)}
              </Tw>
            </div>
          )}
          <Note kind="info"><b>{c.notes.brand}</b></Note>
          {c.isOwner ? <><BrandForm brandName={c.brand?.brandName ?? null} intro={c.brand?.intro ?? null} hasLogo={!!c.brand?.logoFileId} /><SiteForm /></> : <p className="pt-ls">회사 관리는 대표 계정이 합니다.</p>}
        </>
      ) : <Empty>파트너가 아닙니다.</Empty>)}
    <i hidden data-root-end="" /></>
  );
}

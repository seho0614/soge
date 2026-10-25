import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { ymdKst } from '@/lib/format';
import { Bg, bizNo, Empty, GRADE_KO, Note, PARTNER_ST, Pgh, ptCode, Tabs, Tw, won } from '@/components/partner/ui';
import { getFmt } from '@/lib/getFmt';
import { getTranslations } from 'next-intl/server';
import { BrandForm, ChangeRequestForm, InviteAccept, SiteForm, SiteRemove, StaffInviteForm, StaffRemove } from './BizForms';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('partner.meta'))('business') };
}

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
/* v10.100 (다국어 2-5a) — 변경 항목 · 상태 글자는 사전 partner.biz.field.<코드> · partner.biz.ch.<코드> */
const CH: Record<string, 'ok' | 'wait' | 'no' | 'off'> = { REQUESTED: 'wait', APPROVED: 'ok', REJECTED: 'no', WITHDRAWN: 'off' };
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
  const t = await getTranslations('partner.biz');
  const f = await getFmt();
  const tp = await getTranslations('partner');
  const B = (c: React.ReactNode) => <b>{c}</b>;
  const sp = await searchParams;
  const tab: Tab = (['info', 'acct', 'terms', 'brand'] as const).includes(sp.tab as Tab) ? (sp.tab as Tab) : 'info';

  const [d, c, inv] = await Promise.all([
    apiGet<Dash>('/partner/dashboard', 0).catch(() => null),
    apiGet<Company>('/partner/company', 0).catch(() => null),
    apiGet<Array<{ businessId: string; company: string }>>('/partner/staff/invitations', 0).catch(() => []),
  ]);
  const st0 = PARTNER_ST[d?.status ?? ''] ?? [d?.status ?? '—', 'off'];
  const st = [ptCode(tp, 'partnerSt', d?.status, st0[0]), st0[1]] as const;
  const href = (t: Tab) => (t === 'info' ? '/partner/business' : `/partner/business?tab=${t}`);

  return (
    <><Pgh title={t('title')} sub={t('sub')} />
      {inv.map((x) => <InviteAccept key={x.businessId} businessId={x.businessId} company={x.company} />)}
      <Tabs cur={tab} items={[
        { key: 'info', label: t('tabInfo'), href: href('info') },
        { key: 'acct', label: t('tabAcct'), href: href('acct') },
        { key: 'terms', label: t('tabTerms'), href: href('terms') },
        { key: 'brand', label: t('tabBrand'), href: href('brand') },
      ]} />

      {tab === 'info' && (
        <>
          <Tw head={[t('thItem'), t('thValue')]}>
            {c ? (
              <>
                <tr><td><b>{t('company')}</b></td><td>{c.info.company}</td></tr>
                <tr><td><b>{t('bizNo')}</b></td><td>{c.info.bizRegNo ? bizNo(c.info.bizRegNo) : <>{t.rich('noBizNo', { b: B, ls: (x) => <span className="pt-ls">{x}</span> })}</>}</td></tr>
                <tr><td><b>{t('ceo')}</b></td><td>{c.info.ceoName ?? '—'}</td></tr>
                <tr><td><b>{t('bizType')}</b></td><td>{[c.info.bizType, c.info.bizItem].filter(Boolean).join(' · ') || '—'}</td></tr>
                <tr><td><b>{t('address')}</b></td><td>{c.info.addressShort ? `${c.info.addressShort} ***` : c.info.hasAddress ? t('addrRegistered') : '—'}</td></tr>
                <tr><td><b>{t('since')}</b></td><td>{c.info.approvedAt ? ymdKst(c.info.approvedAt) : t('inReview')}</td></tr>
              </>
            ) : null}
            <tr><td><b>{t('identity')}</b></td><td><Bg tone={p.identityVerifiedAt ? 'ok' : 'no'}>{p.identityVerifiedAt ? t('done') : t('need')}</Bg></td></tr>
            <tr><td><b>{t('bizVerify')}</b></td><td>
              <Bg tone={p.businessVerifiedAt ? 'ok' : 'off'}>{p.businessVerifiedAt ? t('done') : t('optional')}</Bg>
              {!p.businessVerifiedAt ? <> <span className="pt-ls">{t('bizOnly')}</span> <Link href="/verify">{t('goVerify')}</Link></> : null}
              {c?.info.ntsEnv && c.info.ntsEnv !== 'LIVE' ? <span className="pt-ls">{t('ntsEnv', { env: c.info.ntsEnv })}</span> : null}
            </td></tr>
            {d?.applied ? (
              <>
                <tr><td><b>{t('gradeSt')}</b></td><td><b>{ptCode(tp, 'grade', d.grade, GRADE_KO[d.grade ?? ''] ?? d.grade ?? '—')}</b> <Bg tone={st[1]}>{st[0]}</Bg></td></tr>
                <tr><td><b>{t('svcApproved')}</b></td><td>{t('countEa', { n: String(d.services?.approved ?? 0) })}{d.services?.in_review ? <span className="pt-ls">{t('inReviewN', { n: String(d.services.in_review) })}</span> : null}</td></tr>
                <tr><td><b>{t('region')}</b></td><td>{t('countPlace', { n: String(d.regions ?? 0) })} <Link className="pt-bo sm" href="/partner/regions">{t('change')}</Link></td></tr>
                <tr><td><b>{t('unpaidCap')}</b></td><td>{f.wonOf(won(d.unpaidCap))}<span className="pt-ls">{t('unpaidCapNote')}</span></td></tr>
              </>
            ) : null}
          </Tw>
          {c?.changes.map((x) => (
            <div className="pt-crow" key={x.id} style={{ marginTop: 10 }}>
              <div><b>{t('changeReq', { field: ptCode(t, 'field', x.field, x.field), value: x.afterValue })}</b><span className="pt-ls">{ymdKst(x.createdAt)} · {x.reason}{x.decisionReason ? t('hqDecision', { reason: x.decisionReason }) : ''}</span></div>
              <Bg tone={CH[x.state] ?? 'off'}>{ptCode(t, 'ch', x.state, x.state)}</Bg>
            </div>
          ))}
          {c?.isOwner ? <ChangeRequestForm /> : null}
          <Note kind="warn"><b>{c?.notes.info ?? t('ntsWarn')}</b></Note>
          {!d?.applied ? (
            <div style={{ marginTop: 14 }}>
              <Empty>{t('notApplied')}<div style={{ marginTop: 12 }}><Link className="pt-bp" href="/partner/apply">{t('applyNow')}</Link></div></Empty>
            </div>
          ) : null}
        </>
      )}

      {tab === 'acct' && (c ? (
        <>
          <Tw head={[t('thKind'), t('thId'), t('thRole'), t('thState'), '']}>
            {c.staff.map((s) => (
              <tr key={s.accountId}>
                <td><b>{s.role === 'OWNER' ? t('owner') : t('staff')}</b>{s.name ? <div className="pt-ls">{s.name}</div> : null}</td>
                <td>{s.email}</td>
                <td>{s.role === 'OWNER' ? t('roleOwner') : s.canSettle ? t('roleSettle') : t('roleConsult')}</td>
                <td>{s.joined ? <Bg tone="ok">{t('active')}</Bg> : <Bg tone="wait">{t('invited')}</Bg>}</td>
                <td>{c.isOwner && s.role !== 'OWNER' ? <StaffRemove accountId={s.accountId} /> : null}</td>
              </tr>
            ))}
          </Tw>
          {c.isOwner ? <StaffInviteForm /> : null}
          <Note kind="warn"><b>{c.notes.staff}</b></Note>
        </>
      ) : <Empty>{tp('common.notPartner')}</Empty>)}

      {tab === 'terms' && (c ? (
        <>
          <Tw head={[t('thDoc'), t('thAgree'), t('thDate')]}>
            {c.terms.map((tm) => (
              <tr key={tm.code}>
                <td><b>{tm.title}</b>{tm.status !== 'PUBLISHED' ? <span className="pt-ls">{t('legalReview')}</span> : null}</td>
                <td>{tm.status !== 'PUBLISHED' ? <Bg tone="off">{t('notYet')}</Bg> : tm.agreed ? <Bg tone="ok">{t('agreed')}</Bg> : <Bg tone="off">{t('notAgreed')}</Bg>}</td>
                <td>{tm.agreedAt ? `${ymdKst(tm.agreedAt)}${tm.version ? t('version', { v: tm.version }) : ''}` : '—'}</td>
              </tr>
            ))}
          </Tw>
          <Note kind="info">{t.rich('termsNote', { b: B, terms: (x) => <Link href="/terms">{x}</Link> })}</Note>
        </>
      ) : <Empty>{t('termsFail')}</Empty>)}

      {tab === 'brand' && (c ? (
        <>
          <div className="pt-dsum">
            <div className="dr"><span>{t('brandName')}</span><b>{c.brand?.brandName ?? '—'}</b></div>
            <div className="dr"><span>{t('logo')}</span><b>{c.brand?.logoFileId ? t('registered') : t('none')}</b></div>
            <div className="dr"><span>{t('sites')}</span><b>{t('countPlace', { n: String(c.sites.length) })}</b></div>
          </div>
          {c.sites.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <Tw head={[t('thSite'), t('thRegion'), '']}>
                {c.sites.map((s) => <tr key={s.id}><td><b>{s.name}</b></td><td>{s.sido} {s.sigungu ?? ''}</td><td>{c.isOwner ? <SiteRemove id={s.id} /> : null}</td></tr>)}
              </Tw>
            </div>
          )}
          <Note kind="info"><b>{c.notes.brand}</b></Note>
          {c.isOwner ? <><BrandForm brandName={c.brand?.brandName ?? null} intro={c.brand?.intro ?? null} hasLogo={!!c.brand?.logoFileId} /><SiteForm /></> : <p className="pt-ls">{t('ownerOnly')}</p>}
        </>
      ) : <Empty>{tp('common.notPartner')}</Empty>)}
    <i hidden data-root-end="" /></>
  );
}

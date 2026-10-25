import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { AxisApply } from '@/components/AxisApply';
import { DirectoryApply } from '@/components/DirectoryApply';
import { Empty, Note, Pgh, S2, Tw } from '@/components/partner/ui';
import { getTranslations } from 'next-intl/server';
import { isGwanKey } from '@/i18n/keys';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('partnerOps.listings'))('metaTitle') };
}

interface Dash { applied: boolean; status?: string }
interface MyListing { id: string; title: string; status: string; statusLabel: string | null; gwanCode?: string; rejectReasonLabel: string | null }

/* 관 이름(고정 글자)은 사전 header.gwan.<코드> (v10.100 · 2-5a) */

/**
 * SB-PTC-LST-010 — 안심소개 파트너센터 내 매물 · 입점 상태 (D018 · D019)
 * v10.29 — 시안 scPtnLst 배치: 「축별 입점 상태」 → 「매물 N건」 표 → 안내 → 단추 줄(매물 등록 · 다른 축 입점 신청).
 *
 * 안심소개 매물 등록은 여기서 시작합니다. 축 입점 승인이 있어야 게시됩니다(서버 mal_partner_axes ·
 * 스위치 mal.partner_only — 오픈 전에는 꺼져 있어 안내로만 동작).
 * 법률 · 세무 사무소는 아래에서 월 정액 노출을 신청합니다 — 상담 신청(리드)은 받지 않습니다.
 * 순서가 있습니다 — 본인인증(사업자는 사업자 인증 · v10.38 P2P) → 축별 입점 신청 → (법률 · 세무) 입점 승인 뒤 정액 노출 신청.
 */
export default async function PartnerListingsPage() {
  const p = await me();
  if (!p) redirect('/login');
  /* v10.38 (D096 · P2P) — 본인인증 개인도 축 입점 · 정액 노출을 신청합니다 */
  const actorOk = !!(p.identityVerifiedAt || p.businessVerifiedAt);
  const [d, mine] = await Promise.all([
    actorOk ? apiGetPersonal<Dash>('/partner/dashboard').catch(() => null) : Promise.resolve(null),
    apiGetPersonal<MyListing[]>('/me/listings').catch(() => [] as MyListing[]),
  ]);
  const partner = d?.status === 'ACTIVE';
  const t = await getTranslations('partnerOps.listings');
  const th = await getTranslations('header.gwan');
  return (
    <><Pgh title={t('title')} sub={t('sub')} />

      <S2>{t('axisH')}</S2>
      {actorOk ? (
        <AxisApply />
      ) : (
        <Note kind="info" data-need="business">
          {t.rich('needId', { b: (c) => <b>{c}</b> })}{' '}
          <Link href="/verify">{t('goVerify')}</Link>
        </Note>
      )}

      <S2>{t('countH', { n: String(mine.length) })}</S2>
      {mine.length === 0 ? (
        <Empty>{t('empty')}</Empty>
      ) : (
        <Tw head={[t('th.no'), t('th.listing'), t('th.gwan'), t('th.state')]}>
          {mine.slice(0, 20).map((r) => (
            <tr key={r.id}>
              <td><span className="pt-code">{r.id.slice(0, 8)}</span></td>
              <td><b>{r.title}</b>{r.rejectReasonLabel ? <div className="pt-wn">{r.rejectReasonLabel}</div> : null}</td>
              <td>{r.gwanCode ? (isGwanKey(r.gwanCode) ? th(r.gwanCode) : r.gwanCode) : '—'}</td>
              <td>{r.statusLabel ?? r.status}</td>
            </tr>
          ))}
        </Tw>
      )}

      <Note kind="info">
        {t.rich('formNote', { b: (c) => <b>{c}</b> })}
      </Note>
      {/* v10.32 — 시안의 노란 띠 자리. 시안 문구(오픈 전 게시 제한 스위치가 꺼짐)는 개발 현황 메모라, 지금 실제로 켜져 있는 규칙을 적습니다 */}
      <Note kind="warn" data-listing-gate="">
        {t.rich('gateNote', { b: (c) => <b>{c}</b> })}
      </Note>

      {partner ? (
        <DirectoryApply />
      ) : actorOk ? (
        <Note kind="plain" data-need="partner">
          {t.rich('dirNote', { b: (c) => <b>{c}</b> })}{' '}
          <Link href="/partner/apply">{t('apply')}</Link>
        </Note>
      ) : null}

      <div className="pt-dact actions">
        <Link className="pt-bp" href="/register">{t('register')}</Link>
        <Link className="pt-bo" href="/partner/apply">{t('otherAxis')}</Link>
        <Link className="pt-bo" href="/my/listings">{t('myListings')}</Link>
        <Link className="pt-bo" href="/partner">{t('toCenter')}</Link>
      </div>
    <i hidden data-root-end="" /></>
  );
}

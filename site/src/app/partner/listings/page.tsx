import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { AxisApply } from '@/components/AxisApply';
import { DirectoryApply } from '@/components/DirectoryApply';
import { Empty, Note, Pgh, S2, Tw } from '@/components/partner/ui';

export const metadata: Metadata = { title: '내 매물 · 입점 상태' };

interface Dash { applied: boolean; status?: string }
interface MyListing { id: string; title: string; status: string; statusLabel: string | null; gwanCode?: string; rejectReasonLabel: string | null }

const GWAN: Record<string, string> = { MNY: '소개장터', MAL: '안심소개', BIZ: '소개창업', HLT: '소개몰' };

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
  return (
    <><Pgh title="내 매물" sub="안심소개에 올리는 매물은 여기서 등록하고 관리합니다. 축마다 입점 승인을 받아야 게시됩니다." />

      <S2>축별 입점 상태</S2>
      {actorOk ? (
        <AxisApply />
      ) : (
        <Note kind="info" data-need="business">
          <b>본인인증이 먼저입니다.</b> 인증을 마치면 여기서 입점할 축을 고를 수 있습니다(사업자 인증은 선택).{' '}
          <Link href="/verify">인증하러 가기 →</Link>
        </Note>
      )}

      <S2>매물 {mine.length}건</S2>
      {mine.length === 0 ? (
        <Empty>등록한 매물이 없습니다. 아래 「매물 등록」으로 시작하십시오.</Empty>
      ) : (
        <Tw head={['번호', '매물', '분류', '상태']}>
          {mine.slice(0, 20).map((r) => (
            <tr key={r.id}>
              <td><span className="pt-code">{r.id.slice(0, 8)}</span></td>
              <td><b>{r.title}</b>{r.rejectReasonLabel ? <div className="pt-wn">{r.rejectReasonLabel}</div> : null}</td>
              <td>{r.gwanCode ? GWAN[r.gwanCode] ?? r.gwanCode : '—'}</td>
              <td>{r.statusLabel ?? r.status}</td>
            </tr>
          ))}
        </Tw>
      )}

      <Note kind="info">
        <b>등록 폼은 사용자 화면의 소개 등록 폼을 그대로 엽니다.</b> 승인되지 않은 축의 분류는 고를 수 없게 막는 것이 서버 규칙입니다.
      </Note>
      {/* v10.32 — 시안의 노란 띠 자리. 시안 문구(오픈 전 게시 제한 스위치가 꺼짐)는 개발 현황 메모라, 지금 실제로 켜져 있는 규칙을 적습니다 */}
      <Note kind="warn" data-listing-gate="">
        <b>입점 승인 전에는 게시되지 않습니다.</b> 안심소개 매물은 그 축의 입점 승인을 받은 업체만 게시할 수 있습니다 — 승인 전에 올리면 서버가 막습니다(MAL_PARTNER_ONLY).
      </Note>

      {partner ? (
        <DirectoryApply />
      ) : actorOk ? (
        <Note kind="plain" data-need="partner">
          <b>법률 · 세무 사무소 노출(월 정액)</b>은 입점 신청이 승인된 뒤에 신청할 수 있습니다.{' '}
          <Link href="/partner/apply">입점 신청 →</Link>
        </Note>
      ) : null}

      <div className="pt-dact actions">
        <Link className="pt-bp" href="/register">매물 등록</Link>
        <Link className="pt-bo" href="/partner/apply">다른 축 입점 신청</Link>
        <Link className="pt-bo" href="/my/listings">등록한 매물 보기</Link>
        <Link className="pt-bo" href="/partner">파트너센터로</Link>
      </div>
    <i hidden data-root-end="" /></>
  );
}

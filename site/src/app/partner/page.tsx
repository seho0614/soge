import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { Bg, bizNo, GRADE_KO, Note, PARTNER_ST, Pgh, S2, Tile, Tw, won } from '@/components/partner/ui';
import { ymdKst } from '@/lib/format';

export const metadata: Metadata = { title: '파트너센터' };

interface Dash {
  applied: boolean; note?: string;
  company?: string; grade?: string; status?: string; bizRegNo?: string;
  services?: { approved: number; in_review: number };
  regions?: number; unpaid?: number; unpaidItems?: number; unpaidCap?: number;
  canReceive?: boolean;
  blocked?: Array<{ what: string; why: string }>;
  /* v10.31 (W5) — 시안 숫자 4칸 · 업체 카드의 실제 값 */
  approvedAt?: string | null; balance?: number; bonus?: number;
  today?: { leads: number; unviewed: number };
  month?: { fee: number; bonus: number };
  settlement?: { due: number; count: number; payoutDay: number };
  card?: { manager: string | null; mainCategory: string | null; categoryCount: number; form: string | null; regionNames: string[] };
}
const FORM_KO: Record<string, string> = { MATRIX: '매트릭스 견적', CONTRACT: '계약 성사형', CONSULT: '상담형', RENTAL: '약정 월요금형', PAYMENT: '결제형', MEDICAL: '의료 심의 트랙' };

const SUB = '매물과 서비스를 등록하고, 상담 신청을 받고, 정산을 받는 자리입니다. 제휴 파트너센터와는 별도입니다.';

/**
 * SB-PTC-DSH-010 — 시안 scPtn 배치: 업체 카드 → 숫자 4칸 → 바로가기 단추 → 「막혀 있는 것」 표.
 *
 * v10.31 (W5 · 10/10 시안 기준) — 숫자 4칸을 시안 그대로(모두 실제 값 · GET /partner/dashboard):
 *   오늘 들어온 상담(확인 전) · 이번 달 이용료(보너스 포함 · 선불 차감액) · 노출 중 서비스(검수중) · 이번 달 정산 예정(지급일 익월 N일).
 *   업체 카드: 사업자등록번호 · 담당 · 입점일 / 카테고리 · 등록 방식 · 영업지역.
 * 시안의 「막혀 있는 것 6건」 표는 본사 개발 현황(설명용)이라 옮기지 않고, 그 자리에 **이 업체의 리드가 막힌 이유**(blocked)를 같은 표 모양으로 둡니다.
 * 「워크스루 84화면 상태」도 설명용이라 옮기지 않았습니다(diffs).
 */
export default async function PartnerHome() {
  const p = await me();
  if (!p) redirect('/login');

  const d = await apiGet<Dash>('/partner/dashboard', 0).catch(() => null);

  if (!d || !d.applied) {
    return (
      <><Pgh title="안심소개 파트너센터" sub={SUB} />
        <Note kind="info">{d?.note ?? '파트너 신청을 먼저 해주십시오.'}</Note>
        {/* v10.27 (G-192) — 인증을 마쳤으면 다음 단계인 「입점 신청」으로. v10.38 (D096 · P2P) — 본인인증 개인도 사업자 정보 없이 신청합니다 */}
        {p.identityVerifiedAt || p.businessVerifiedAt ? (
          <>
            <Note kind="ok"><b>{p.businessVerifiedAt ? '사업자 인증을 마치셨습니다.' : '본인인증을 마치셨습니다 — 개인으로 신청합니다.'}</b> 입점을 신청하시면 운영 심사 뒤 서비스를 등록하고 리드를 받으실 수 있습니다.</Note>
            <div className="pt-dact"><Link className="pt-bp" href="/partner/apply" data-ptn-apply>입점 신청</Link></div>
          </>
        ) : (
          <>
            <Note kind="warn"><b>본인인증이 먼저입니다.</b> 본인인증을 하면 개인으로 입점 신청을 하실 수 있습니다(사업자 인증은 선택).</Note>
            <div className="pt-dact"><Link className="pt-bp" href="/verify">본인인증하기</Link></div>
          </>
        )}
      <i hidden data-root-end="" /></>
    );
  }

  const st = PARTNER_ST[d.status ?? ''] ?? [d.status ?? '—', 'off'];
  const corp = d.company ?? '—';
  const initial = corp.replace(/^\(주\)|^주식회사\s*/, '').slice(0, 1) || '파';
  const blocked = d.blocked ?? [];
  const c = d.card;
  const since = d.approvedAt ? ymdKst(d.approvedAt) : null;

  return (
    <><Pgh title="안심소개 파트너센터" sub={SUB} />

      {/* 업체 카드 (시안 .prof) */}
      <div className="pt-prof" data-ptn-prof>
        <div className="av" aria-hidden>{initial}</div>
        <div className="pi">
          <b>{corp}</b> <Bg tone={st[1]}>{st[0]}</Bg>
          <div className="ps">사업자등록번호 {bizNo(d.bizRegNo)}{c?.manager ? ` · 담당 ${c.manager}` : ''}{since ? ` · ${since} 입점` : ' · 입점 심사 중'} · 등급 {GRADE_KO[d.grade ?? ''] ?? d.grade ?? '—'}</div>
          <div className="ps" data-ptn-card2>
            카테고리 {c?.mainCategory ?? '—'}{(c?.categoryCount ?? 0) > 1 ? ` 외 ${(c?.categoryCount ?? 1) - 1}` : ''}
            {' · '}등록 방식 {c?.form ? FORM_KO[c.form] ?? c.form : '—'}
            {' · '}영업지역 {c?.regionNames?.length ? c.regionNames.join(' · ') : '없음'} · 리드 수신 {d.canReceive ? '정상' : '중지'}
          </div>
        </div>
        <Link className="pt-bo" href="/partner/services">내 서비스</Link>
      </div>

      {/* 숫자 4칸 (시안 .tiles) — 시안 그대로 · 실제 값 */}
      <div className="pt-tiles" data-ptn-tiles>
        <Tile label="오늘 들어온 상담" value={(d.today?.leads ?? 0).toLocaleString('ko-KR')} unit="건" sub={`확인 전 ${d.today?.unviewed ?? 0}`} href="/partner/leads" />
        <Tile label="이번 달 이용료" value={won(d.month?.fee)} unit="원" sub={`보너스 ${won(d.month?.bonus)} 포함 · 잔액 ${won(d.balance)}원`} href="/partner/cash" />
        <Tile label="노출 중 서비스" value={d.services?.approved ?? 0} unit="개" sub={`검수중 ${d.services?.in_review ?? 0}`} href="/partner/services" />
        <Tile label="이번 달 정산 예정" value={won(d.settlement?.due)} unit="원" sub={`지급일 익월 ${d.settlement?.payoutDay ?? 10}일`} href="/partner/settlement" />
      </div>

      {/* 시안 .pact — 「신뢰지표 보기 · 성과 관리」. 개발에 있던 바로가기(서비스 등록 · 활동 지역)는 없애지 않고 같은 줄에 둡니다(diffs) */}
      <div className="pt-pact">
        <Link className="pt-bo" href="/partner/trust">신뢰지표 보기</Link>
        <Link className="pt-bo" href="/partner/performance">성과 관리</Link>
        <Link className="pt-bo" href="/partner/services/new">서비스 등록</Link>
        <Link className="pt-bo" href="/partner/regions">활동 지역</Link>
      </div>

      <S2>막혀 있는 것 {blocked.length}건</S2>
      {blocked.length ? (
        <>
          <Note kind="warn"><b>리드가 오지 않습니다 — {blocked.length}가지가 막혀 있습니다.</b> 아래를 풀면 바로 다시 받습니다.</Note>
          <Tw head={['항목', '현재 상태']}>
            {blocked.map((b) => (
              <tr key={b.what}><td><b>{b.what}</b></td><td>{b.why}</td></tr>
            ))}
          </Tw>
        </>
      ) : (
        <Note kind="ok" data-ptn-ok><b>막혀 있는 것이 없습니다.</b> 리드를 받을 수 있는 상태입니다.</Note>
      )}

      <Note kind="info">
        <b>리드 이용료는 정보 이용료입니다.</b> 연락처를 여는 순간 충전 잔액에서 빠지며,
        상담이 성사되든 안 되든 같습니다. 소개비와는 다른 것이고, 소개비는 당사자끼리 직접 주고받습니다.
      </Note>
    <i hidden data-root-end="" /></>
  );
}

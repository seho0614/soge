import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { Bg, bizNo, GRADE_KO, Note, PARTNER_ST, Pgh, ptCode, S2, Tile, Tw, won } from '@/components/partner/ui';
import { ymdKst } from '@/lib/format';
import { getFmt } from '@/lib/getFmt';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('partner.meta'))('home') };
}

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
  const t = await getTranslations('partner.home');
  const f = await getFmt();
  const tp = await getTranslations('partner');
  const B = (c: React.ReactNode) => <b>{c}</b>;
  const SUB = t('sub');

  const d = await apiGet<Dash>('/partner/dashboard', 0).catch(() => null);

  if (!d || !d.applied) {
    return (
      <><Pgh title={t('title')} sub={SUB} />
        <Note kind="info">{t('applyFirst')}</Note>
        {/* v10.27 (G-192) — 인증을 마쳤으면 다음 단계인 「입점 신청」으로. v10.38 (D096 · P2P) — 본인인증 개인도 사업자 정보 없이 신청합니다 */}
        {p.identityVerifiedAt || p.businessVerifiedAt ? (
          <>
            <Note kind="ok"><b>{p.businessVerifiedAt ? t('bizDone') : t('idDone')}</b> {t('afterVerify')}</Note>
            <div className="pt-dact"><Link className="pt-bp" href="/partner/apply" data-ptn-apply>{t('apply')}</Link></div>
          </>
        ) : (
          <>
            <Note kind="warn">{t.rich('idFirst', { b: B })}</Note>
            <div className="pt-dact"><Link className="pt-bp" href="/verify">{t('verify')}</Link></div>
          </>
        )}
      <i hidden data-root-end="" /></>
    );
  }

  const st0 = PARTNER_ST[d.status ?? ''] ?? [d.status ?? '—', 'off'];
  const st = [ptCode(tp, 'partnerSt', d.status, st0[0]), st0[1]] as const;
  const corp = d.company ?? '—';
  const initial = corp.replace(/^\(주\)|^주식회사\s*/, '').slice(0, 1) || t('avatarFallback');
  const blocked = d.blocked ?? [];
  const c = d.card;
  const since = d.approvedAt ? ymdKst(d.approvedAt) : null;

  return (
    <><Pgh title={t('title')} sub={SUB} />

      {/* 업체 카드 (시안 .prof) */}
      <div className="pt-prof" data-ptn-prof>
        <div className="av" aria-hidden>{initial}</div>
        <div className="pi">
          <b>{corp}</b> <Bg tone={st[1]}>{st[0]}</Bg>
          <div className="ps">{t('psBiz', { no: bizNo(d.bizRegNo) })}{c?.manager ? t('psManager', { name: c.manager }) : ''}{since ? t('psSince', { date: since }) : t('psReview')}{t('psGrade', { grade: ptCode(tp, 'grade', d.grade, GRADE_KO[d.grade ?? ''] ?? d.grade ?? '—') })}</div>
          <div className="ps" data-ptn-card2>
            {t('cat', { cat: c?.mainCategory ?? '—' })}{(c?.categoryCount ?? 0) > 1 ? tp('common.more', { n: String((c?.categoryCount ?? 1) - 1) }) : ''}
            {t('form', { form: c?.form ? ptCode(t, 'formKind', c.form, c.form) : '—' })}
            {t('regionRecv', { regions: c?.regionNames?.length ? c.regionNames.join(' · ') : t('none'), state: d.canReceive ? t('recvOk') : t('recvStop') })}
          </div>
        </div>
        <Link className="pt-bo" href="/partner/services">{t('myServices')}</Link>
      </div>

      {/* 숫자 4칸 (시안 .tiles) — 시안 그대로 · 실제 값 */}
      <div className="pt-tiles" data-ptn-tiles>
        <Tile label={t('tLeads')} value={(d.today?.leads ?? 0).toLocaleString('ko-KR')} unit={tp('common.unit.case')} sub={t('tLeadsSub', { n: String(d.today?.unviewed ?? 0) })} href="/partner/leads" />
        <Tile label={t('tFee')} value={f.ko ? won(d.month?.fee) : f.wonOf(won(d.month?.fee))} unit={f.ko ? tp('common.unit.won') : undefined} sub={t('tFeeSub', { bonus: f.ko ? won(d.month?.bonus) : f.wonOf(won(d.month?.bonus)), balance: f.wonOf(won(d.balance)) })} href="/partner/cash" />
        <Tile label={t('tSvc')} value={d.services?.approved ?? 0} unit={tp('common.unit.ea')} sub={t('tSvcSub', { n: String(d.services?.in_review ?? 0) })} href="/partner/services" />
        <Tile label={t('tSettle')} value={f.ko ? won(d.settlement?.due) : f.wonOf(won(d.settlement?.due))} unit={f.ko ? tp('common.unit.won') : undefined} sub={t('tSettleSub', { day: String(d.settlement?.payoutDay ?? 10) })} href="/partner/settlement" />
      </div>

      {/* 시안 .pact — 「신뢰지표 보기 · 성과 관리」. 개발에 있던 바로가기(서비스 등록 · 활동 지역)는 없애지 않고 같은 줄에 둡니다(diffs) */}
      <div className="pt-pact">
        <Link className="pt-bo" href="/partner/trust">{t('trust')}</Link>
        <Link className="pt-bo" href="/partner/performance">{t('perf')}</Link>
        <Link className="pt-bo" href="/partner/services/new">{t('newSvc')}</Link>
        <Link className="pt-bo" href="/partner/regions">{t('regions')}</Link>
      </div>

      <S2>{t('blockedN', { n: String(blocked.length) })}</S2>
      {blocked.length ? (
        <>
          <Note kind="warn">{t.rich('blockedNote', { b: B, n: String(blocked.length) })}</Note>
          <Tw head={[t('thItem'), t('thState')]}>
            {blocked.map((b) => (
              <tr key={b.what}><td><b>{b.what}</b></td><td>{b.why}</td></tr>
            ))}
          </Tw>
        </>
      ) : (
        <Note kind="ok" data-ptn-ok>{t.rich('noBlock', { b: B })}</Note>
      )}

      <Note kind="info">
        {t.rich('feeNote', { b: B })}
      </Note>
    <i hidden data-root-end="" /></>
  );
}

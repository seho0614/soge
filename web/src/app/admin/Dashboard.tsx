import { useEffect, useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { won } from '../../lib/format';
import { ErrorView } from '../../components/ErrorView';

/* v10.29 — 서버(/admin/summary)가 보내는 이름은 slaBreached · settlementPending 입니다.
 * 화면은 reviewSlaBreached · settlementRequested 를 읽어 두 칸이 늘 빈칸이었습니다(10/9 비교 그림). 둘 다 받습니다. */
interface Summary {
  reviewPending: number; slaBreached?: number; reviewSlaBreached?: number;
  autoRatePct: number | null; openBlockers: number; criticalAlerts: number;
  settlementPending?: number; settlementRequested?: number; disputesOpen: number;
  /* v10.31 — 서버가 세어 보내는 시안 칸 · 검수 처리 한계(설정 review.daily_capacity) */
  settlementPendingSum?: number; bizPending?: number; bizToday?: number;
  reviewCapacity?: number; decidedToday?: number; slaSoon?: number;
}
interface Runway {
  breakEven: { month: number | null; kind: string; label: string };
  needPaid: { count: number | null; pricePerMember: number | null; basis: string };
  minCash: { amount: number; monthIndex: number | null; month: string | null; hasOpening: boolean };
  maxDeficit: number; notes: string[]; basis: string; months: { month: string }[];
}
interface Settlement { amount: number; status: string }
interface Biz { verifiedAt: string | null; createdAt: string }
interface Cat { status: string }
interface Partner { status: string }
interface Throughput { day: string; decided: number }

/** 검수 처리 한계 — v10.31: 서버 설정 review.daily_capacity(운영이 법정 고지 › 그 밖의 설정에서 바꿈 · 기본 50 · B-09R).
 *  설정을 못 받으면 50 으로 그립니다. */
const REVIEW_CAP = 50;

/**
 * SB-ADM-DSH-010 관리자 대시보드
 *
 * 지표를 나열하지 않고 "지금 사람이 손대야 하는 것"만 보여 줍니다.
 * 자동 처리가 기본이므로, 여기 숫자가 0 이면 할 일이 없다는 뜻이어야 합니다.
 *
 * v10.29 — 시안(scAdm)대로: 숫자 5칸(검수 · 정산 · 가입 · 업종 · 파트너) → 검수 처리 여력 막대 →
 * 「확인이 필요한 것」 → 다른 운영 화면. 모든 숫자는 서버 값입니다.
 * v10.31 (10/10 시안 기준) — 시안 칸 이름(정산 승인 대기 · 신규 가입 승인)과 「활주로」 4칸.
 * 활주로는 가정치가 아니라 실제 매출 · 운영이 넣은 월 비용으로 서버가 계산합니다(GET /admin/finance/runway).
 */
export function Dashboard({ onGo, canGo }: { onGo: (tab: string) => void; canGo?: (tab: string) => boolean }) {
  /* 2026-10-02 — 요약 API 는 ADMIN · SUPER 전용입니다. 지급 담당(PAYOUT) · 검수자(REVIEWER)는
   * 대시보드가 늘 403 오류였습니다. 그 역할에게는 할 일로 가는 안내만 보여 줍니다. */
  const roles = tokenRoles();
  if (!roles.includes('ADMIN') && !roles.includes('SUPER')) {
    const payout = roles.includes('PAYOUT');
    return (
      <>
        <div className="ad-nt info">
          {payout
            ? <><b>지급 담당 계정입니다.</b> 확정된 지급과 광고비 입금을 기록합니다.</>
            : <><b>검수 담당 계정입니다.</b> 검수 큐 · 배지 신청 · 표본 감사를 처리합니다.</>}
        </div>
        <button className="btn-ok" onClick={() => onGo(payout ? 'payouts' : 'queue')}>
          {payout ? '지급 데스크로' : '검수 큐로'}
        </button>
      </>
    );
  }
  return <SummaryView onGo={onGo} canGo={canGo ?? (() => true)} />;
}

type Extra = {
  stlSum: number | null; bizPending: number | null; bizToday: number | null;
  catPending: number | null; ptnApplied: number | null; svcPending: number | null; decidedToday: number | null;
};

function SummaryView({ onGo, canGo }: { onGo: (tab: string) => void; canGo: (tab: string) => boolean }) {
  const isSuper = tokenRoles().includes('SUPER');
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [x, setX] = useState<Extra | null>(null);
  const [rw, setRw] = useState<Runway | null>(null);

  useEffect(() => {
    api<Summary>('/admin/summary').then(setData).catch(setError);
    api<Runway>('/admin/finance/runway').then(setRw).catch(() => setRw(null));
    /* 칸 아래 작은 글(합계 · 오늘 · 대기)은 각 화면이 쓰는 목록 API 에서 셉니다. 하나가 실패해도 나머지는 보입니다 */
    const today = new Date().toDateString();
    const n = <T,>(r: PromiseSettledResult<T>) => (r.status === 'fulfilled' ? r.value : null);
    Promise.allSettled([
      api<Settlement[]>('/admin/settlements'),
      api<Biz[]>('/admin/businesses'),
      api<Cat[]>('/admin/categories'),
      api<Partner[]>('/admin/partners'),
      api<unknown[]>('/admin/partners/services/pending'),
      api<Throughput[]>('/admin/reviews/throughput'),
    ]).then(([s, b, c, p, sv, t]) => {
      const S = n(s), B = n(b), C = n(c), P = n(p), SV = n(sv), T = n(t);
      const isToday = (iso: string) => new Date(iso).toDateString() === today;
      setX({
        stlSum: S ? S.filter((r) => r.status === 'REQUESTED').reduce((a, r) => a + Number(r.amount || 0), 0) : null,
        bizPending: B ? B.filter((r) => !r.verifiedAt).length : null,
        bizToday: B ? B.filter((r) => !r.verifiedAt && isToday(r.createdAt)).length : null,
        catPending: C ? C.filter((r) => r.status === 'PENDING').length : null,
        ptnApplied: P ? P.filter((r) => r.status === 'APPLIED').length : null,
        svcPending: SV ? SV.length : null,
        decidedToday: T ? (T.find((r) => new Date(r.day).toDateString() === today)?.decided ?? 0) : null,
      });
    });
  }, []);

  if (error) return <ErrorView error={error} />;
  if (!data) return <p className="muted">불러오는 중…</p>;

  const sla = data.slaBreached ?? data.reviewSlaBreached ?? 0;
  const stl = data.settlementPending ?? data.settlementRequested ?? 0;
  const ptn = x && x.ptnApplied != null && x.svcPending != null ? x.ptnApplied + x.svcPending : null;
  const dash = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('ko-KR'));

  /* 시안 tiles: [이름, 숫자, 단위, 갈 탭, 작은 글] */
  const tiles: { k: string; label: string; v: string; sub: string; warn?: boolean }[] = [
    { k: 'queue', label: '검수 대기', v: dash(data.reviewPending),
      sub: sla > 0 ? `SLA 초과 ${sla}` : `SLA 임박 ${data.slaSoon ?? 0}`, warn: sla > 0 || (data.slaSoon ?? 0) > 0 },
    { k: 'settlement', label: '정산 승인 대기', v: dash(stl),
      sub: `합계 ${won(data.settlementPendingSum ?? x?.stlSum ?? 0)}`, warn: stl > 0 },
    { k: 'users', label: '신규 가입 승인', v: dash(data.bizPending ?? x?.bizPending),
      sub: `오늘 ${data.bizToday ?? x?.bizToday ?? 0}`, warn: (data.bizPending ?? 0) > 0 },
    { k: 'category', label: '업종 신청', v: dash(x?.catPending),
      sub: x?.catPending != null ? `대기 ${x.catPending}` : '대기 —' },
    { k: 'partners', label: '파트너 입점 · 검수', v: dash(ptn),
      sub: x && x.ptnApplied != null && x.svcPending != null ? `입점 신청 ${x.ptnApplied} · 서비스 검수 ${x.svcPending}` : '—' },
  ];

  const cap = data.reviewCapacity || REVIEW_CAP;
  const pct = Math.min(100, Math.round((data.reviewPending / cap) * 100));
  const spare = cap - data.reviewPending;

  /* 확인이 필요한 것 — 서버 값으로만 만듭니다. 없으면 「없음」 한 줄 */
  const alerts: { tone: 'warn' | 'info'; title: string; text: string; go?: string }[] = [];
  if (data.criticalAlerts > 0) alerts.push({ tone: 'warn', title: `확인하지 않은 CRITICAL 경보 ${data.criticalAlerts}건`, text: '배포가 막힙니다. 경보를 확인하십시오.', go: 'risk' });
  if (sla > 0) alerts.push({ tone: 'warn', title: `SLA 24시간 초과 ${sla}건`, text: '검수 큐에서 24시간을 넘긴 건이 있습니다.', go: 'queue' });
  if (data.openBlockers > 0) alerts.push({ tone: 'warn', title: `오픈 차단 ${data.openBlockers}건`, text: '오픈을 막는 항목(외부 연동 · 고정 IP 등)이 남아 있습니다.', go: 'checklist' });
  if (data.disputesOpen > 0) alerts.push({ tone: 'warn', title: `진행 중인 분쟁 ${data.disputesOpen}건`, text: '분쟁이 걸린 거래는 정산이 보류됩니다.', go: 'disputes' });
  if (ptn) alerts.push({ tone: 'info', title: `파트너 입점 · 서비스 검수 대기 ${ptn}건`, text: '승인해야 파트너센터 온보딩과 서비스 노출이 열립니다.', go: 'partners' });
  if (data.autoRatePct != null) alerts.push({ tone: 'info', title: `최근 7일 자동검수율 ${data.autoRatePct}%`, text: '이 값이 높을수록 사람이 볼 건이 줄어듭니다.' });

  /* 다른 운영 화면 — 시안 「다른 운영 화면」 목록을 개발 탭에 맞춘 것(권한이 없는 탭은 빼고) */
  /* 다른 운영 화면 — 시안 「다른 운영 화면」 14장 그대로(메인 운영 네 화면은 각 하위 탭으로 바로). 경영 지표는 개발에만 — 맨 뒤에 둡니다 */
  const more: [string, string][] = ([
    ['mainops/banner', '메인 운영 · 배너 · 광고'], ['mainops/gwan', '메인 운영 · 관 노출'],
    ['mainops/layout', '메인 운영 · 화면 구성'], ['mainops/content', '메인 운영 · 콘텐츠'],
    ['rules', '자동검수 규칙'], ['audit', '표본 감사'], ['integrations', '외부 연동 관리'], ['codes', '코드 라벨'],
    ['badges', '배지 신청 검수'], ['billing', '청구 현황'], ['hlt-orders', '소개몰 주문 · 발송'],
    ['hlt-reviews', '소개몰 리뷰 · 문의'], ['hlt-settle', '소개몰 정산'], ['hlt-products', '소개몰 상품'],
    ['reports', '경영 지표'],
  ] as [string, string][]).filter(([k]) => canGo(k.split('/')[0]!) && (!k.startsWith('mainops/') || k === 'mainops/banner' || isSuper));
  const wonN = (v: number) => `${v.toLocaleString('ko-KR')}원`;

  return (
    <>
      <div className="ad-tiles" data-dash-tiles>
        {tiles.map((t) => (
          <button key={t.label} className={`ad-tile${t.warn ? ' warn' : ''}`} onClick={() => onGo(t.k)}
                  disabled={!canGo(t.k)} data-tile={t.k}>
            <span className="tl">{t.label}</span>
            <b>{t.v}</b>
            <span className="tu">건</span>
            <span className={`ts${t.warn ? '' : ' ok'}`}>{t.sub}</span>
          </button>
        ))}
      </div>

      <h2 className="ad-s2">검수 처리 여력</h2>
      <div className="ad-cap" data-dash-cap>
        <div className="cb"><div className={`cf${pct >= 100 ? ' over' : ''}`} style={{ width: `${pct}%` }} /></div>
        <div className="cl"><b>{data.reviewPending} / {cap}건</b><span>{pct}%</span></div>
      </div>
      <div className={`ad-nt ${pct >= 100 ? 'warn' : 'info'}`}>
        검수 인력 1명 · 일 처리 {cap}건 기준입니다 (B-09R). 지금 대기 {data.reviewPending}건이면{' '}
        {spare >= 0 ? <>여유 {spare}건입니다.</> : <><b>{-spare}건 넘쳤습니다.</b></>}
        {(data.decidedToday ?? x?.decidedToday) != null && <> 오늘 처리 {data.decidedToday ?? x?.decidedToday}건.</>}
        {' '}하루 {cap}건을 넘기기 시작하면 증원 시점입니다 (J-06).
      </div>

      <h2 className="ad-s2">확인이 필요한 것</h2>
      {alerts.length === 0
        ? <div className="ad-nt info"><b>지금 손댈 것이 없습니다</b> — 검수 · 경보 · 분쟁 · 오픈 차단이 모두 0 입니다.</div>
        : alerts.map((a) => (
          <div key={a.title} className={`ad-nt ${a.tone}`} data-dash-alert>
            <b>{a.title}</b> — {a.text}
            {a.go && canGo(a.go) && <> <button className="linkbtn" onClick={() => onGo(a.go!)}>보러 가기</button></>}
          </div>
        ))}

      {/* v10.31 — 시안 「활주로」 4칸 + 안내. 실제 매출 · 입력한 월 비용으로 서버가 계산(가정치 아님) */}
      <h2 className="ad-s2">활주로</h2>
      {rw ? (
        <>
          <div className="ad-rw" data-runway>
            <div className="ad-rc"><span>손익분기</span><b>{rw.breakEven.label}</b>
              <small>{rw.breakEven.kind === 'ACTUAL' ? '실적 — 매출이 비용을 넘은 첫 달' : rw.breakEven.kind === 'TREND' ? '최근 3개월 매출 추세로 추정' : ' '}</small></div>
            <div className="ad-rc"><span>필요 유료회원</span><b>{rw.needPaid.count != null ? `${rw.needPaid.count.toLocaleString('ko-KR')}명` : '—'}</b>
              <small>{rw.needPaid.pricePerMember ? `1명 월 ${wonN(Math.round(rw.needPaid.pricePerMember))} · ${rw.needPaid.basis}` : rw.needPaid.basis}</small></div>
            <div className={`ad-rc${rw.minCash.amount < 0 ? ' no' : ''}`}><span>{rw.minCash.hasOpening ? '최저 현금' : '누적 손익 최저점'}</span><b>{wonN(rw.minCash.amount)}</b>
              <small>{rw.minCash.monthIndex ? `${rw.minCash.monthIndex}개월차 (${rw.minCash.month})` : ' '}</small></div>
            <div className={`ad-rc${rw.maxDeficit > 0 ? ' warn' : ''}`}><span>누적 최대 적자</span><b>{wonN(rw.maxDeficit)}</b>
              <small>{rw.months.length ? `${rw.months[0]!.month} 부터 ${rw.months.length}개월` : ' '}</small></div>
          </div>
          <div className={`ad-nt ${rw.notes.length ? 'warn' : 'info'}`} data-runway-note>
            <b>{rw.notes.length ? '이 숫자는 아직 덜 채워졌습니다.' : '이 숫자는 실적입니다.'}</b> {rw.notes.join(' ')} {rw.basis}
            {canGo('reports') && <> <button className="linkbtn" onClick={() => { onGo('reports'); setTimeout(() => document.getElementById('finance-costs')?.scrollIntoView(), 600); }}>월 비용 넣기</button></>}
          </div>
        </>
      ) : <div className="ad-nt info">활주로를 계산하지 못했습니다(경영 지표 권한이 없거나 서버 오류).</div>}

      {/* v10.27 (G-198) 시안 — 위 메뉴 줄에서 한 번 더 들어가야 하는 운영 화면 */}
      {more.length > 0 && (
        <>
          <h2 className="ad-s2">다른 운영 화면</h2>
          <div className="ad-mgrid" data-adm-more>
            {more.map(([k, t]) => (
              <button key={k} className="ad-mcard" onClick={() => onGo(k)} data-go={k}>
                <b>{t}</b>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

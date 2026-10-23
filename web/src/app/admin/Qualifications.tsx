import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';
import { SubTabs, type SubTab } from '../../components/SubTabs';
import { useHashSub } from '../../lib/hashSub';
import type { Broker } from './quals/shared';
import { type BrokerList, BrokerQueue } from './quals/BrokerQueue';
import { BrokerDetail } from './quals/BrokerDetail';
import { Categories } from './quals/Categories';
import { MedicalView } from './quals/MedicalView';

interface Review {
  id: string; company: string; categoryCode: string; categoryName: string;
  docNo: string | null; lookupDone: boolean;
  requiredDoc: string; legalBasis: string; createdAt?: string;
}

type View = 'pending' | 'broker' | 'detail' | 'cats' | 'medical';

/**
 * SB-ADM-PTN-070 규제 카테고리 자격 심사 (T-21)
 * SB-ADM-BRK-010 중개사 인증 심사
 * SB-ADM-BRK-011 중개사 인증 상세
 * SB-ADM-PTN-060 카테고리 마스터 (T-05 · T-06) — 규제 분야 기준 · 매물 심사
 * SB-ADM-PTN-040 의료 심의 본사 확인 (T-03)
 *
 * 자격 없이 등록되면 **플랫폼도 책임을 집니다.**
 * 중개자 면책은 "고지하고 확인한 범위"에서만 성립하고,
 * 자격 확인이 그 '확인'입니다.
 *
 * 중개사 인증(BRK)은 2026-10-02 부터 자기 API(/admin/brokers)를 씁니다 —
 * 사이트 /my/broker 신청이 쌓이는 broker_verifications 를 판정하고, 승인하면
 * 부동산 매물 공개 게이트(fn_broker_gate)가 열립니다.
 * 규제 자격 심사(PTN-070, qualification_reviews)는 그대로입니다.
 *
 * v10.86 (리팩토링) — 하위 화면은 quals/ 폴더(화면 하나 = 파일 하나), 같이 쓰는 형식 · 표는 quals/shared.tsx. 이 파일은 탭 전환만 합니다.
 */
/* v10.31 (10/10 시안 · PTN-040/060/070) — 시안은 의료 심의 · 카테고리 마스터 · 자격 심사 화면 위에 파트너사 하위 탭 줄을 같이 보입니다.
 * 화면은 여기(인증 심사 › 자격 심사)에 하나만 두고, 파트너사 쪽 하위 화면으로 가는 줄을 둡니다. */
const PTN_LINKS: Array<[string, string]> = [
  ['partners/list', '파트너사 목록'], ['partners/apply', '입점 신청'], ['partners/services', '서비스 검수'],
  ['partners/rejects', '리드 반려'], ['partners/leads', '리드 배정'], ['partners/wallet', '리드 이용료 · 정산'],
];

export function Qualifications({ onGo }: { onGo?: (tab: string) => void } = {}) {
  /* v10.31 — 파트너사 하위 탭(의료 심의 · 카테고리 마스터 · 자격 심사)에서 주소(#/quals/medical)로 바로 들어옵니다 */
  const [view, setView] = useHashSub<View>('pending', ['pending', 'broker', 'detail', 'cats', 'medical']);
  const [pick, setPick] = useState<string | null>(null);
  const [bstate, setBstate] = useState('PENDING');
  /* v10.27 (G-207) — 전에는 오래된 것부터 200건까지만 와서 대기가 200건을 넘으면 새 신청이 보이지 않았습니다 */
  const [bq, setBq] = useState(''); const [border, setBorder] = useState(''); const [bpage, setBpage] = useState(1);
  const brokers = useApi<BrokerList>(`/admin/brokers?state=${bstate}&page=${bpage}&size=50${bq ? `&q=${encodeURIComponent(bq)}` : ''}${border ? `&order=${border}` : ''}`);
  const pending = useApi<Review[]>('/admin/qualifications');
  const a = useAct();

  const tabs: SubTab<View>[] = [
    { key: 'pending', label: '규제 자격 심사 (T-21)', screen: 'SB-ADM-PTN-070' },
    { key: 'broker', label: '중개사 인증 심사', screen: 'SB-ADM-BRK-010' },
    { key: 'detail', label: '인증 상세', screen: 'SB-ADM-BRK-011' },
    { key: 'cats', label: '카테고리 마스터 (T-05·06)', screen: 'SB-ADM-PTN-060' },
    { key: 'medical', label: '의료 심의 (T-03)', screen: 'SB-ADM-PTN-040' },
  ];

  /* 발급처 조회 → 승인/반려. 목록과 상세가 같은 처리를 씁니다. */
  async function act(id: string, kind: 'lookup' | 'ok' | 'no') {
    if (kind === 'lookup') {
      await a.run(id, () => api(`/admin/qualifications/${id}/lookup`, { method: 'POST' }),
        pending.reload, '발급처 조회를 완료로 표시했습니다. 이제 승인할 수 있습니다.');
      return;
    }
    const reason = kind === 'no' ? prompt('반려 사유 — 무엇이 부족한지까지 적어 주십시오') ?? '' : undefined;
    if (kind === 'no' && !reason?.trim()) return;
    await a.run(id, () => api(`/admin/qualifications/${id}/decide`, {
      method: 'POST', body: JSON.stringify({ approve: kind === 'ok', reason }),
    }), pending.reload, kind === 'ok' ? '자격을 승인했습니다. 그 업종의 서비스 등록이 열립니다.' : '반려했습니다.');
  }

  const open = (id: string) => { setPick(id); setView('detail'); a.clear(); };
  const all = pending.data ?? [];

  /* 중개사 인증 판정. 승인은 국토부 대조 MATCH 가 아니면 DB 가 막습니다. */
  /* v10.32 — preset: 상세의 반려 사유 코드(BR03 · BR04 · BR06) 단추가 사유 글 앞부분을 채워 둡니다(고쳐 쓸 수 있음 · 서버 입력은 그대로 reason 글) */
  async function decideBroker(b: Broker, state: 'VERIFIED' | 'REJECTED', preset?: string) {
    const reason = state === 'REJECTED' ? prompt('반려 사유 — 무엇이 맞지 않았는지까지 적어 주십시오 (신청자에게 보입니다)', preset) ?? '' : undefined;
    if (state === 'REJECTED' && !reason?.trim()) return;
    if (state === 'VERIFIED' && !confirm(`${b.company} (${b.licenseNo}) 중개사 인증을 승인합니다.\n이 사업자의 부동산 매물 공개가 열립니다.`)) return;
    await a.run(b.id, () => api(`/admin/brokers/${b.id}/decide`, {
      method: 'POST', body: JSON.stringify({ state, reason }),
    }), brokers.reload);
  }

  /* D008 — 국토부 다시 조회. 조회 실패면 기존 결과를 지우지 않고 사유만 남깁니다(서버). */
  async function relookup(b: Broker) {
    await a.run(b.id, () => api(`/admin/brokers/${b.id}/lookup`, { method: 'POST' }), brokers.reload);
  }

  return (
    <section>
      <SubTabs tabs={tabs} value={view} onChange={(v) => { a.clear(); setView(v); }} />
      {onGo && (view === 'pending' || view === 'cats' || view === 'medical') && (
        <div className="ad-chk" data-ptn-links style={{ flexWrap: 'wrap', margin: '-4px 0 10px' }}>
          <span className="dim" style={{ fontSize: 12 }}>파트너사</span>
          {PTN_LINKS.map(([to, t]) => <button key={to} className="btn-plain btn-sm" data-go={to} onClick={() => onGo(to)}>{t}</button>)}
        </div>
      )}
      <Flash msg={a.msg} err={a.err} />
      {pending.error && view === 'pending'
        ? <ErrorView error={pending.error} onRetry={pending.reload} />
        : null}

      {view === 'pending' && !pending.error && (
        <>
          <h2>규제 카테고리 자격 심사 <em>{all.length}</em></h2>
          <p className="lead">자격이 승인돼야 그 업종의 서비스 등록이 열립니다 (T-21).</p>
          <p className="card warn">
            <b>서류만 보고 승인하지 마십시오.</b> 발급처에서 조회해야 합니다 — 위조된 자격증으로 등록되면
            그 피해는 요청자에게 갑니다. 조회 없이는 DB 가 승인을 막습니다.
          </p>
          {!pending.data && <p className="muted">불러오는 중…</p>}
          {pending.data && all.length === 0 && <p className="muted">자격 심사 대기 건이 없습니다.</p>}
          {all.map((r) => <QualCard key={r.id} r={r} busy={a.busy === r.id} onAct={act} />)}
          <p className="card warn">
            <b>제한업종은 자격이 있어도 등록되지 않습니다.</b> 자격 심사는 규제 업종(의료 · 보험 등)의 적법한 등록을
            여는 절차이지, 제한업종을 여는 절차가 아닙니다.
          </p>
        </>
      )}

      {view === 'broker' && (
        <BrokerQueue list={brokers} state={bstate} onState={(s) => { setBstate(s); setBpage(1); }} busy={a.busy}
                     q={bq} onQ={(v) => { setBq(v); setBpage(1); }} order={border} onOrder={(v) => { setBorder(v); setBpage(1); }} onPage={setBpage}
                     onDecide={decideBroker} onOpen={open} />
      )}

      {view === 'detail' && (
        <BrokerDetail id={pick} busy={!!pick && a.busy === pick} version={brokers.data}
                      configured={!!brokers.data?.lookupConfigured} onLookup={relookup}
                      onDecide={decideBroker} onBack={() => setView('broker')} />
      )}

      {view === 'cats' && <Categories />}
      {view === 'medical' && <MedicalView onGo={onGo} />}
    </section>
  );
}

function QualCard({ r, busy, onAct }: {
  r: Review; busy: boolean; onAct: (id: string, k: 'lookup' | 'ok' | 'no') => void;
}) {
  return (
    <div className="card pad">
      <b>{r.company}</b> <span className="muted">{r.categoryName}</span>
      <p className="muted">필요 서류: {r.requiredDoc} · 근거: {r.legalBasis}</p>
      <p>제출 번호: {r.docNo ?? <span className="warn-text">미제출</span>} · 발급처 조회:{' '}
        {r.lookupDone ? <span className="badge badge-verified">완료</span> : <span className="badge badge-urgent">미완료</span>}</p>
      <div className="acts">
        {!r.lookupDone && <button className="btn-sm" disabled={busy} onClick={() => onAct(r.id, 'lookup')}>발급처 조회 완료</button>}
        <button className="btn-sm" disabled={!r.lookupDone || busy} onClick={() => onAct(r.id, 'ok')}>승인</button>
        <button className="btn-no" disabled={busy} onClick={() => onAct(r.id, 'no')}>반려</button>
      </div>
    </div>
  );
}

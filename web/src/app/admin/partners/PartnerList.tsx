import { useState } from 'react';
import { useApi } from '../../../lib/useApi';
import { n } from '../../../lib/act';
import { ErrorView } from '../../../components/ErrorView';
import { bizNo, type Partner, type PendingService, type VoidList, type Tab2, type PartnerCard, PST, ymd, partnerWarn } from './shared';

/* ── SB-ADM-PTN-010 목록 ─────────────────────────────────────────── */
/* v10.32 — 시안 표 칸(ID · 막힌 업무 · 현재 상태 · 관련 화면 · 열기). 관련 화면은 그 일을 처리하는 운영 화면 ID */
const BLOCKED: Array<[string, string, string, Tab2, string]> = [
  ['T-01', '입점 신청 승인', '신청은 pending 으로 저장되나 승인 처리 수단이 없었습니다 — 이제 입점 신청에서 처리합니다', 'apply', 'PTN-020'],
  ['T-02', '서비스 검수 승인', '검수중 → 노출중 전환이 불가능했습니다 — 이제 서비스 검수에서 처리합니다', 'services', 'PTN-030'],
  ['T-03', '의료 심의 본사 확인', '심의필 등록 후 본사 확인에서 멈췄습니다 — 이제 의료 심의에서 처리합니다', 'medical', 'PTN-040'],
  ['T-04', '리드 반려 인정/기각', '파트너 반려 신청을 받는 자리가 없었습니다 — 이제 신청 목록에서 처리합니다', 'rejects', 'PTN-050'],
  ['T-05', '카테고리 단가 폼 축', '폼 유형 미지정 카테고리는 단가 입력이 막힙니다', 'cats', 'PTN-060'],
  ['T-06', '매트릭스 축 마스터', '견적 축이 데이터(category_matrix_axes)로 옮겨졌습니다', 'cats', 'PTN-060'],
  ['T-21', '규제 카테고리 자격 심사', '자격 제출 후 심사중에서 대기합니다', 'quals', 'PTN-070'],
];

const PAGE_SIZE = 20;

export function PartnerList({ onGo, onOpen }: { onGo: (v: Tab2) => void; onOpen: (id: string) => void }) {
  const list = useApi<Partner[]>('/admin/partners');
  /* v10.31 — 시안 칸 「의료 심의」 건수(자격 심사 › 의료 심의가 쓰는 API 그대로) */
  const medical = useApi<unknown[]>('/admin/qualifications/medical');
  /* v10.29 — 시안 숫자 칸(입점 신청 · 서비스 검수 · 리드 반려 신청)의 건수. 각 하위 탭이 쓰는 API 그대로 */
  const svc = useApi<PendingService[]>('/admin/partners/services/pending');
  const voids = useApi<VoidList>('/admin/partners/fees/void-requests?state=REQUESTED');
  const cards = useApi<PartnerCard[]>('/admin/partners/cards');
  const [more, setMore] = useState(PAGE_SIZE);
  if (list.error) return <ErrorView error={list.error} onRetry={list.reload} />;
  if (!list.data) return <p className="muted">불러오는 중…</p>;
  const rows = list.data;
  const waiting = rows.filter((p) => p.status === 'APPLIED');
  const stopped = rows.filter((p) => Number(p.unpaid) >= Number(p.unpaidCap));
  const card = (id: string) => (cards.data ?? []).find((c) => c.id === id);

  const tiles: [string, number | null, string, Tab2][] = [
    ['입점 신청', waiting.length, 'T-01 · 승인 전에는 리드가 가지 않음', 'apply'],
    ['서비스 검수', svc.data ? svc.data.length : null, 'T-02 · 검수중 → 노출중', 'services'],
    ['의료 심의', medical.data ? medical.data.length : null, 'T-03 · 심의필 본사 확인', 'medical'],
    ['리드 반려 신청', voids.data ? voids.data.items.length : null, 'T-04 · 인정 / 기각', 'rejects'],
  ];
  return (
    <>
      <div className="ad-tiles" data-ptn-tiles>
        {tiles.map(([t, v, sub, go]) => (
          <button key={t} className="ad-tile" onClick={() => onGo(go)}>
            <span className="tl">{t}</span><b>{v == null ? '—' : n(v)}</b><span className="tu">건</span>
            <span className="ts">{sub}</span>
          </button>
        ))}
      </div>
      {/* v10.32 — 시안 노란 띠(전: 파란 띠) · 표에 「관련 화면」 칸 */}
      <div className="ad-nt warn"><b>아래 7건은 화면이 없어서 멈췄던 업무입니다.</b> 지금은 모두 처리할 자리가 있습니다 — 「열기」로 그 화면에 갑니다.</div>
      <div className="ad-tw"><table className="tbl" data-ptn-blocked>
        <thead><tr><th>ID</th><th>막힌 업무</th><th>현재 상태</th><th>관련 화면</th><th></th></tr></thead>
        <tbody>
          {BLOCKED.map(([t, name, why, v, scr]) => (
            <tr key={t}>
              <td className="mono">{t}</td><td><b>{name}</b></td><td className="muted">{why}</td><td className="mono">SB-ADM-{scr}</td>
              <td><button className="btn-sm" onClick={() => onGo(v)}>열기</button></td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {/* v10.32 — 시안 「입점 파트너사 N곳」 카드 줄(전: 118줄 표). 20곳씩 더 봅니다 */}
      <h2 className="ad-s2">입점 파트너사 {rows.length}곳</h2>
      {/* v10.32 — 개발에만 있던 모아 보기 띠 두 줄은 그대로 둡니다(「그대로 둠」 · v10.31 과 같은 글자) */}
      {waiting.length > 0 && (
        <div className="ad-nt warn" data-ptn-waiting={waiting.length}><b>입점 심사 대기 {waiting.length}건.</b> 승인 전에는 리드가 가지 않습니다.{' '}
          <button className="linkbtn" onClick={() => onGo('apply')}>입점 신청으로</button></div>
      )}
      {stopped.length > 0 && (
        <div className="ad-nt warn" data-ptn-stopped={stopped.length}>
          <b>미납 한도 초과 {stopped.length}개사 — 리드 수신이 멈췄습니다.</b> 청구분이 결제되면 자동으로 재개됩니다.
        </div>
      )}
      {rows.length === 0 && <p className="ad-empty">등록된 파트너가 없습니다.</p>}
      {rows.slice(0, more).map((p) => {
        const c = card(p.id);
        const warn = partnerWarn(p, c);
        const [stc, stl] = PST[p.status] ?? ['', p.status];
        return (
          <div key={p.id} className={`ad-mrow${warn ? ' warn' : ''}`} data-ptn-row={p.id}>
            <div className="mt">
              <b>{p.company}</b>
              <span className="ls">{p.id.slice(0, 8)} · {bizNo(p.bizRegNo)}{c?.category ? ` · ${c.category}` : ''}{c?.formLabel ? ` · ${c.formLabel}` : ''} · {ymd(p.appliedAt)} 입점 · 등급 {p.grade}</span>
              {warn && <div className="wn">{warn}</div>}
            </div>
            <div className="mm">
              <span className={`ad-bg ${stc}`}>{stl}</span>
              <span className="ls">서비스 {n(p.services)} · 리드 {c ? n(c.leads) : '—'} · 리드 이용료 {c ? `${n(c.cash)}원` : '—'}</span>
            </div>
            <div className="mact"><button className="btn-sm" data-ptn-open={p.id} onClick={() => onOpen(p.id)}>상세</button></div>
          </div>
        );
      })}
      {rows.length > more && (
        <div className="ad-dact"><button className="btn-plain" onClick={() => setMore(more + PAGE_SIZE)} data-ptn-more>더 보기 (남은 {rows.length - more}곳)</button></div>
      )}
    </>
  );
}

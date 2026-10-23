import { useApi } from '../../../lib/useApi';
import { n } from '../../../lib/act';
import { ErrorView } from '../../../components/ErrorView';
import { bizNo, type Partner, type Tab2, type PartnerCard, PST, NTS, ymd, partnerWarn } from './shared';

interface PartnerDetailRes extends Omit<Partner, 'services'> {
  ceoName: string | null; ntsStatus: string | null; approvedAt: string | null; suspendedReason: string | null; stopped: boolean;
  services: Array<{ id: string; title: string; category: string; gwanCode: string; status: string; rejectReason: string | null; createdAt: string }>;
  regions: Array<{ sido: string; sigungu: string | null }>;
  fees: Array<{ state: string; count: number; amount: number }>;
}

const FEE_STATE: Record<string, string> = { PENDING: '미청구', BILLED: '청구됨', PAID: '결제됨', VOID: '무효' };

interface PartnerDocs {
  status: string;
  terms: Array<{ code: string; version: string; title: string; agreedAt: string | null }>;
  nts: { status: string | null; checkedAt: string | null; env: string | null; verifiedAt: string | null };
  qualifications: Array<{ code: string; name: string; state: string; decidedAt: string | null }>;
}

/* ── SB-ADM-PTN-011 파트너사 상세 · v10.27 (G-130) — 목록의 「상세」가 엽니다 ─────────── */
/* v10.32 — 시안(scAdmPtnD) 배치: 업체 머리 → (경고) → 숫자 4칸 → 계약 · 서류 → 서비스 → 처리 바로가기. 따로 열리는 화면(#/partners/detail/<id>) */
export function PartnerDetail({ id, onClose, onGo }: { id: string; onClose: () => void; onGo: (v: Tab2) => void }) {
  const d = useApi<PartnerDetailRes>(`/admin/partners/${id}`);
  const docs = useApi<PartnerDocs>(`/admin/partners/${id}/docs`);
  const cards = useApi<PartnerCard[]>('/admin/partners/cards');
  if (d.error) return <ErrorView error={d.error} onRetry={d.reload} />;
  if (!d.data) return <p className="muted">불러오는 중…</p>;
  const p = d.data;
  const c = (cards.data ?? []).find((x) => x.id === p.id);
  const [stc, stl] = PST[p.status] ?? ['', p.status];
  const warn = partnerWarn({ ...p, services: p.services.length }, c);
  const leads = c ? c.leads : p.fees.reduce((a, f) => a + Number(f.count || 0), 0);
  const SVC: Record<string, [string, string]> = { APPROVED: ['ok', '노출'], ACTIVE: ['ok', '노출'], PUBLISHED: ['ok', '노출'], IN_REVIEW: ['wait', '검수 중'], REJECTED: ['no', '반려'], DRAFT: ['', '작성 중'] };
  const docRows: Array<[string, JSX.Element, string]> = docs.data ? [
    ...docs.data.terms.map((t): [string, JSX.Element, string] => [`${t.title} ${t.version}`,
      t.agreedAt ? <span className="ad-bg ok">동의 · {ymd(t.agreedAt)}</span> : <span className="ad-bg wait">{p.status === 'APPLIED' ? '입점 심사 뒤 동의' : '동의 기록 없음'}</span>,
      `${t.code} · 약관 동의 기록`]),
    ['사업자 상태 조회', docs.data.nts.status ? <span className={`ad-bg ${docs.data.nts.status === 'VALID' ? 'ok' : 'no'}`}>{NTS[docs.data.nts.status] ?? docs.data.nts.status}</span> : <span className="ad-bg">조회 전</span>,
      `국세청 조회${docs.data.nts.checkedAt ? ` · ${ymd(docs.data.nts.checkedAt)}` : ''}${docs.data.nts.env && docs.data.nts.env !== 'LIVE' ? ` · ${docs.data.nts.env === 'STUB' ? '스텁(T-07)' : '시험'}` : ''}`],
    ...(docs.data.qualifications.length
      ? docs.data.qualifications.map((q): [string, JSX.Element, string] => [`업종 자격 — ${q.name}`,
          <span className={`ad-bg ${q.state === 'APPROVED' ? 'ok' : q.state === 'PENDING' ? 'wait' : 'no'}`}>{q.state === 'APPROVED' ? '승인' : q.state === 'PENDING' ? '확인 대기' : '반려'}</span>, q.code])
      : [['업종 자격', <span className="ad-bg ok">해당 없음 · 확인</span>, c?.category ?? '—'] as [string, JSX.Element, string]]),
  ] : [];
  return (
    <section data-ptn-detail={p.id}>
      {/* 제목 · 설명은 위 제목 줄(SUB_PAGE 'partners/detail') */}
      <div className="ad-prof" data-ptn-prof="">
        <div className="av">{p.company.replace(/^\(주\)|^주식회사\s*/, '').slice(0, 1)}</div>
        <div className="pi">
          <b>{p.company}</b> <span className={`ad-bg ${stc}`}>{stl}</span>
          <div className="ps">{p.id.slice(0, 8)} · {bizNo(p.bizRegNo)} · {ymd(p.appliedAt)} 입점{p.approvedAt ? ` · 승인 ${ymd(p.approvedAt)}` : ''}</div>
          <div className="ps">{c?.category ?? '업종 없음'}{c?.formLabel ? ` · 단가 방식 ${c.formLabel}` : ''} · 대표 {p.ceoName ?? '—'} · 등급 {p.grade}</div>
          <div className="ps">서비스 지역 {p.regions.length ? p.regions.map((r) => `${r.sido}${r.sigungu ? ' ' + r.sigungu : ''}`).join(' · ') : '없음'}</div>
          {/* 개발에만 있던 「미청구 · 한도」 줄은 그대로 둡니다(v10.31 상세 표) */}
          <div className="ps" data-ptn-unpaid="">미청구 {n(p.unpaid)}원 / 한도 {n(p.unpaidCap)}원</div>
        </div>
      </div>
      {warn && <div className="ad-nt warn"><b>{warn}</b>{p.suspendedReason && p.status !== 'REJECTED' ? ` ${p.suspendedReason}` : ''}</div>}
      <div className="ad-kc4">
        <div><span className="kv">{p.services.length}</span><span className="kl">서비스</span></div>
        <div><span className="kv">{n(leads)}</span><span className="kl">받은 리드 <small>무효 포함</small></span></div>
        <div><span className="kv">{c ? `${n(c.cash)}원` : '—'}</span><span className="kl">리드 이용료 잔액</span></div>
        <div><span className={`kv${p.stopped ? ' bad' : ''}`}>{p.stopped ? '수신 멈춤' : '수신 중'}</span><span className="kl">리드 수신</span></div>
      </div>
      <h3 className="ad-s2">계약 · 서류</h3>
      {docs.error ? <ErrorView error={docs.error} onRetry={docs.reload} /> : !docs.data ? <p className="muted">불러오는 중…</p> : (
        <div className="ad-tw"><table className="tbl" data-ptn-docs>
          <thead><tr><th>항목</th><th>상태</th><th>근거</th></tr></thead>
          <tbody>{docRows.map(([k, v, why]) => <tr key={k}><td>{k}</td><td>{v}</td><td className="muted">{why}</td></tr>)}</tbody>
        </table></div>
      )}
      <h3 className="ad-s2">서비스 {p.services.length}개</h3>
      {p.services.length === 0 ? <div className="ad-nt info"><b>아직 등록한 서비스가 없습니다.</b> 입점 · 자격 심사를 마치면 서비스를 등록합니다.</div> : (
        <div className="ad-tw"><table className="tbl"><thead><tr><th>서비스</th><th>업종</th><th>상태</th><th>등록</th></tr></thead><tbody>
          {p.services.map((s) => { const [k, t] = SVC[s.status] ?? ['', s.status]; return (
            <tr key={s.id}><td>{s.title}</td><td>{s.category} <span className="muted">{s.gwanCode}</span></td>
              <td><span className={`ad-bg ${k}`}>{t}</span>{s.rejectReason ? <span className="muted"> {s.rejectReason}</span> : ''}</td><td className="muted">{ymd(s.createdAt)}</td></tr>); })}
        </tbody></table></div>)}
      {/* 개발에만 — 리드 이용료 상태별 건수 · 합계(10/10 답: 개발에만 있는 것은 남김) */}
      <h3 className="ad-s2">리드 이용료</h3>
      {p.fees.length === 0 ? <p className="ad-empty">아직 받은 리드가 없습니다.</p> : (
        <div className="ad-tw"><table className="tbl"><thead><tr><th>상태</th><th>건수</th><th>합계</th></tr></thead><tbody>
          {p.fees.map((f) => <tr key={f.state}><td>{FEE_STATE[f.state] ?? f.state}</td><td className="num-cell">{n(f.count)}</td><td className="num-cell">{n(f.amount)}원</td></tr>)}
        </tbody></table></div>)}
      <h3 className="ad-s2">처리 바로가기</h3>
      <div className="ad-dact" style={{ marginTop: 0 }}>
        <button className="btn-plain" onClick={() => onGo('apply')}>입점 신청</button>
        <button className="btn-plain" onClick={() => onGo('services')}>서비스 검수</button>
        <button className="btn-plain" onClick={() => onGo('wallet')}>리드 이용료</button>
        <button className="btn-plain" onClick={() => onGo('quals')}>자격 심사</button>
        <button className="btn-plain" onClick={onClose} data-ptn-close="">← 파트너사 목록</button>
      </div>
    </section>
  );
}

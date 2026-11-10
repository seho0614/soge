import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, n, ymd, ymdhm } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';

interface Seller {
  id: string; submerchantId?: string | null;
  code: string; name: string; type: string; status: string;
  commissionRate: number | string | null; payable: boolean;
  onSale: number | string; expiredLicenses: number | string;
  statusReason?: string | null; statusAt?: string | null; changePending?: number;
}
interface ChangeReq {
  id: string; sellerId: string; code: string; name: string; status: string; note: string | null; requestedAt: string;
  fields: Record<string, unknown>; current: Record<string, unknown>;
}
interface History {
  statusReason: string | null; statusAt: string | null; blockers: string[];
  rates: Array<{ from: string | null; to: string | null; reason: string; at: string; by: string | null }>;
  changes: Array<{ id: string; state: string; reason: string | null; requestedAt: string; decidedAt: string | null }>;
}

const TYPE: Record<string, string> = { DIRECT: '직판', BRAND: '입점(브랜드)', GENERAL: '입점(일반)', TENANT: '입점(일반)' };
const STATUS: Record<string, string> = { PENDING: '심사 대기', ACTIVE: '판매 중', PAUSED: '정지', BLOCKED: '이용 제한', REJECTED: '반려', CLOSED: '폐점' };
const LABEL: Record<string, string> = {
  name: '상호', ceoName: '대표자', bizRegNo: '사업자등록번호', ecomRegNo: '통신판매업', csTel: '전화', returnAddr: '반품지', addr: '주소', licenses: '서류',
};
const ACT = {
  PAUSE:  { label: '정지',       ask: '일시 정지 사유 — 판매자에게 그대로 보입니다. 판매 중 상품이 모두 내려갑니다.' },
  RESUME: { label: '다시 열기',   ask: '다시 여는 사유 — 정지 때 내린 상품 중 판매 조건이 맞는 것은 다시 판매합니다.' },
  BLOCK:  { label: '이용 제한',   ask: '이용 제한 사유 — 판매 중 상품이 모두 내려가고, 다시 신청할 수 없습니다.' },
  CLOSE:  { label: '폐점',       ask: '폐점 사유 — 진행 중 주문 · 취소 · 반품 · 정산이 남아 있으면 막힙니다. 판매자는 새로 신청할 수 있습니다.' },
} as const;
type Act = keyof typeof ACT;
const rate = (v: number | string | null | undefined) => (v === null || v === undefined ? '기본' : `${v}%`);
const show = (v: unknown) => (Array.isArray(v)
  ? v.map((l: any) => `${l.kind} ${l.licenseNo}${l.expiresAt ? ` (~${String(l.expiresAt).slice(0, 10)})` : ''}`).join(' · ') || '없음'
  : v === null || v === undefined || v === '' ? '—' : String(v));

/**
 * SB-ADM-HST-010 소개몰 「판매자」 — 판매자 목록 · 관리(v10.223 · D193 · docs/358) · 운영자 ADMIN · SUPER 만(서버도 막음)
 *
 *   정지 · 다시 열기 · 이용 제한 · 폐점(사유 필수 · 판매자에게 알림 · 감사 기록) — 상품은 DB 가 내림 · 되돌림.
 *   수수료율(이 판매자만 · 비우면 기본 · 사유 · 새 주문부터) · 하위가맹점 · 정보 변경 요청 승인 · 반려 · 관리 기록.
 *   v10.169 (D158) 하위가맹점 단추는 정산 화면에서 옮겨 옴.
 */
export function HealthSellers() {
  const sellers = useApi<Seller[]>('/admin/health/sellers');
  const changes = useApi<ChangeReq[]>('/admin/health/sellers/change-requests');
  const [hist, setHist] = useState<{ id: string; data: History } | null>(null);
  const a = useAct();

  const act = (x: Seller, k: Act) => {
    const reason = prompt(`${x.name} — ${ACT[k].ask}`) ?? '';
    if (reason.trim().length < 2) return;
    void a.run(`st:${x.id}`, () => api<{ note: string }>(`/admin/health/sellers/${x.id}/status`, { method: 'POST', body: JSON.stringify({ action: k, reason: reason.trim() }) }),
      sellers.reload, (r) => r.note);
  };
  const setRate = (x: Seller) => {
    const raw = prompt(`${x.name} 판매수수료율(%) — 0 ~ 50 · 비우면 갈래 기본값 · 새 주문부터 적용`, x.commissionRate === null ? '' : String(x.commissionRate));
    if (raw === null) return;
    const v = raw.trim() === '' ? null : Number(raw);
    if (v !== null && !(v >= 0 && v <= 50)) { alert('0 ~ 50 사이 숫자로 적어 주십시오.'); return; }
    const reason = prompt('바꾸는 사유 — 판매자에게 알림이 갑니다') ?? '';
    if (reason.trim().length < 2) return;
    void a.run(`rate:${x.id}`, () => api(`/admin/health/sellers/${x.id}/commission`, { method: 'POST', body: JSON.stringify({ rate: v, reason: reason.trim() }) }),
      sellers.reload, '수수료율을 바꿨습니다. 새 주문부터 적용합니다.');
  };
  const submerchant = (x: Seller) => {
    const id = prompt(`${x.name} — 결제대행사 화면에서 받은 하위가맹점 번호(비우면 결제대행사에 등록 · 연동 전이라 간주 모드에서만 시험 번호)`, x.submerchantId ?? '');
    if (id === null) return;
    void a.run(`sub:${x.id}`, () => api(`/admin/health/sellers/${x.id}/submerchant`, { method: 'POST', body: JSON.stringify(id.trim() ? { submerchantId: id.trim() } : {}) }), sellers.reload, '하위가맹점 번호를 저장했습니다.');
  };
  const openHist = (x: Seller) => {
    if (hist?.id === x.id) { setHist(null); return; }
    void a.run(`h:${x.id}`, () => api<History>(`/admin/health/sellers/${x.id}/history`), undefined, (d) => { setHist({ id: x.id, data: d }); return ''; });
  };
  const decide = (c: ChangeReq, approve: boolean) => {
    let reason: string | undefined;
    if (approve) { if (!confirm(`${c.name} 정보 변경을 승인합니다 — 적힌 값으로 바로 바뀝니다.`)) return; }
    else { reason = prompt(`${c.name} 정보 변경 반려 사유 — 판매자에게 그대로 보입니다`) ?? ''; if (reason.trim().length < 2) return; }
    void a.run(`c:${c.id}`, () => api(`/admin/health/sellers/change-requests/${c.id}/decide`, { method: 'POST', body: JSON.stringify(approve ? { approve } : { approve, reason }) }),
      () => { changes.reload(); sellers.reload(); }, approve ? '승인했습니다.' : '반려했습니다.');
  };

  if (sellers.error) return <ErrorView error={sellers.error} onRetry={sellers.reload} />;
  const list = sellers.data ?? [];
  const cr = changes.data ?? [];
  return (
    <>
      <h3 className="sec" data-hlt-sellers="">판매자 <em>{list.length}</em></h3>
      <Flash msg={a.msg} err={a.err} />
      {sellers.data && list.length === 0 && <p className="muted">등록된 판매자가 없습니다.</p>}
      {list.length > 0 && (
        <table className="tbl">
          <thead><tr><th>코드</th><th>이름</th><th>구분</th><th>상태</th><th>판매중</th><th>지급</th><th>수수료율</th><th>만료 인허가</th><th /></tr></thead>
          <tbody>
            {list.map((x) => {
              const tenant = x.type !== 'DIRECT';
              const busy = a.busy === `st:${x.id}` || a.busy === `rate:${x.id}`;
              return (
                <tr key={x.code} data-hlt-seller={x.code} data-hlt-seller-status={x.status}>
                  <td className="mono">{x.code}</td>
                  <td><b>{x.name}</b>{Number(x.changePending ?? 0) > 0 && <> <span className="st wait">변경 요청</span></>}</td>
                  <td>{TYPE[x.type] ?? x.type}</td>
                  <td>{STATUS[x.status] ?? x.status}{x.statusReason && ['PAUSED', 'BLOCKED', 'CLOSED'].includes(x.status) && <div className="dim">{x.statusReason}</div>}</td>
                  <td className="num-cell">{n(x.onSale)}</td>
                  <td>{!tenant ? <span className="dim">해당 없음</span> : x.payable ? <span className="st ok">가능</span> : <span className="st no">불가</span>}</td>
                  <td className="num-cell">{tenant ? rate(x.commissionRate) : '—'}</td>
                  <td className="num-cell">{Number(x.expiredLicenses) > 0 ? <b className="warn-text">{n(x.expiredLicenses)}</b> : 0}</td>
                  <td>
                    {tenant && x.status === 'ACTIVE' && (
                      <button className="btn-plain" disabled={a.busy === `sub:${x.id}`} onClick={() => submerchant(x)} data-submerchant={x.code}>{x.payable ? '하위가맹점 바꾸기' : '하위가맹점 등록'}</button>)}
                    {tenant && ['ACTIVE', 'PAUSED'].includes(x.status) && <> <button className="btn-plain" disabled={busy} onClick={() => setRate(x)} data-seller-rate={x.code}>수수료율</button></>}
                    {tenant && x.status === 'ACTIVE' && <> <button className="btn-plain" disabled={busy} onClick={() => act(x, 'PAUSE')} data-seller-act="PAUSE">정지</button></>}
                    {tenant && x.status === 'PAUSED' && <> <button className="btn-plain" disabled={busy} onClick={() => act(x, 'RESUME')} data-seller-act="RESUME">다시 열기</button></>}
                    {tenant && ['ACTIVE', 'PAUSED'].includes(x.status) && <> <button className="btn-plain" disabled={busy} onClick={() => act(x, 'BLOCK')} data-seller-act="BLOCK">이용 제한</button></>}
                    {tenant && ['ACTIVE', 'PAUSED', 'BLOCKED'].includes(x.status) && <> <button className="btn-plain" disabled={busy} onClick={() => act(x, 'CLOSE')} data-seller-act="CLOSE">폐점</button></>}
                    {tenant && x.status !== 'PENDING' && <> <button className="btn-plain" onClick={() => openHist(x)} data-seller-history={x.code}>{hist?.id === x.id ? '기록 닫기' : '기록'}</button></>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {hist && (
        <div className="card pad" data-seller-history-box="">
          <b>관리 기록</b> — 상태 사유 {hist.data.statusReason ?? '—'}{hist.data.statusAt ? ` (${ymdhm(hist.data.statusAt)})` : ''}
          {hist.data.blockers.length > 0 && <div className="dim">폐점을 막는 것: {hist.data.blockers.join(' · ')}</div>}
          <div>수수료율 바꾼 기록 {hist.data.rates.length === 0 ? '없음' : hist.data.rates.map((r) => `${ymd(r.at)} ${rate(r.from)} → ${rate(r.to)} (${r.reason} · ${r.by ?? '—'})`).join(' / ')}</div>
          <div>정보 변경 요청 {hist.data.changes.length === 0 ? '없음' : hist.data.changes.map((c) => `${ymd(c.requestedAt)} ${c.state}${c.reason ? ` (${c.reason})` : ''}`).join(' / ')}</div>
        </div>
      )}

      <h3 className="sec" data-seller-changes="">판매자 정보 변경 요청 <em>{cr.length}</em></h3>
      {changes.error && <ErrorView error={changes.error} onRetry={changes.reload} />}
      {changes.data && cr.length === 0 && <p className="muted">대기 중인 정보 변경 요청이 없습니다.</p>}
      {cr.map((c) => (
        <div key={c.id} className="card row" data-seller-change={c.id}>
          <div className="row-main">
            <strong>{c.name}</strong> <span className="dim">{c.code} · {STATUS[c.status] ?? c.status} · 요청 {ymdhm(c.requestedAt)}</span>
            {Object.keys(c.fields).map((k) => (
              <span key={k} className="dim">{LABEL[k] ?? k}: {show(c.current[k])} → <b>{show(c.fields[k])}</b></span>
            ))}
            {c.note && <span className="dim">판매자 메모: {c.note}</span>}
          </div>
          <div className="row-act">
            <button className="btn-ok" disabled={a.busy === `c:${c.id}`} onClick={() => decide(c, true)}>승인</button>{' '}
            <button className="btn-no" disabled={a.busy === `c:${c.id}`} onClick={() => decide(c, false)}>반려</button>
          </div>
        </div>
      ))}
    </>
  );
}

import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymd, ymdhm } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';

interface License { kind: string; licenseNo: string; issuedAt: string | null; expiresAt: string | null; verified: boolean }
interface Application {
  id: string; code: string; name: string; type: string; status: string; personal: boolean;
  bizRegNo: string | null; ceoName: string | null; ecomRegNo: string | null; csTel: string | null;
  returnAddr: string | null; appliedAt: string | null; reviewedAt: string | null; rejectReason: string | null;
  licenses: License[]; accountName?: string; accountEmail?: string; identityVerified?: boolean;
}

const KIND: Record<string, string> = {
  BIZ_REG: '사업자등록', ECOM_REG: '통신판매업', FOOD_SALE: '식품 판매', HEALTH_FUNC: '건강기능식품',
  MED_DEVICE: '의료기기', COSMETIC: '화장품책임판매업', BRAND_RIGHT: '브랜드 권리',
};

/**
 * SB-ADM-HST-010 소개몰 정산 › 「입점 신청」 심사 (v10.165 · D155 · docs/256)
 *
 * 개인 · 사업자 모두 신청합니다(P2P). 승인하면 판매자센터가 열리지만, **판매(결제)는 하위가맹점 ID 를 채운 뒤**입니다 —
 * 판매대금은 결제대행사가 판매자에게 직접 보냅니다(decisions/mall-return-refund #15).
 */
export function HealthTenantApply() {
  const list = useApi<Application[]>('/admin/health/sellers/applications');
  const a = useAct();
  if (list.error) return <ErrorView error={list.error} onRetry={list.reload} />;
  if (!list.data) return <p className="muted">불러오는 중…</p>;
  const rows = list.data.filter((x) => x.status === 'PENDING');
  const rejected = list.data.filter((x) => x.status === 'REJECTED');

  const approve = (x: Application) => {
    const raw = prompt(`${x.name} 입점 승인 — 이 판매자만의 수수료율(%)이 있으면 적고, 없으면 비워 두십시오(갈래 기본값).`, '');
    if (raw === null) return;
    const rate = raw.trim() === '' ? undefined : Number(raw);
    if (rate !== undefined && !(rate >= 0 && rate <= 50)) { alert('수수료율은 0 ~ 50 사이 숫자로 적어 주십시오.'); return; }
    void a.run(x.id, () => api(`/admin/health/sellers/${x.id}/approve`, { method: 'POST', body: JSON.stringify(rate === undefined ? {} : { commissionRate: rate }) }),
      list.reload, `${x.name} 승인했습니다. 판매는 하위가맹점 ID 를 채운 뒤 열립니다.`);
  };
  const reject = (x: Application) => {
    const reason = prompt(`${x.name} 입점 반려 사유 — 무엇을 갖춰야 다시 신청할 수 있는지까지 적어 주십시오`) ?? '';
    if (!reason.trim()) return;
    void a.run(x.id, () => api(`/admin/health/sellers/${x.id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }), list.reload);
  };

  return (
    <>
      <h3 className="sec" data-tenant-apply="">입점 신청 <em>{rows.length}</em></h3>
      <Flash msg={a.msg} err={a.err} />
      {rows.length === 0 && <p className="muted">대기 중인 입점 신청이 없습니다.</p>}
      {rows.map((x) => (
        <div key={x.id} className="card row" data-tenant={x.id}>
          <div className="row-main">
            <strong>{x.name}</strong> <span className="dim">{x.type === 'BRAND' ? '브랜드 직영관' : '일반 입점'} · {x.personal ? '개인' : `사업자 ${x.bizRegNo ?? ''}`}</span>
            <span className="dim">
              {x.accountName} ({x.accountEmail}) · {x.identityVerified ? '본인확인 완료' : '본인확인 전'} · 대표 {x.ceoName ?? '—'} · 전화 {x.csTel ?? '—'} · 신청 {ymdhm(x.appliedAt)}
            </span>
            <span className="dim">통신판매업 {x.ecomRegNo || '없음'} · 반품지 {x.returnAddr ?? '—'}</span>
            <span className="dim">
              서류 {x.licenses.length === 0 ? '없음' : x.licenses.map((l) => `${KIND[l.kind] ?? l.kind} ${l.licenseNo}${l.expiresAt ? ` (~${ymd(l.expiresAt)})` : ''}`).join(' · ')}
            </span>
          </div>
          <div className="row-act">
            <button className="btn-ok" disabled={a.busy === x.id} onClick={() => approve(x)}>승인</button>{' '}
            <button className="btn-no" disabled={a.busy === x.id} onClick={() => reject(x)}>반려</button>
          </div>
        </div>
      ))}
      <p className="card">
        <b>확인할 것</b> — 서류 번호와 유효기간 · 품목에 맞는 자격(건강기능식품 · 의료기기는 아직 팔지 않음) · 개인 판매자는 법령상 신고 대상인지.
        <b> 반려 사유는 신청자에게 그대로 보입니다.</b>
      </p>
      {rejected.length > 0 && (
        <>
          <h3 className="sec">반려한 입점 신청 <em>{rejected.length}</em> <small className="dim">최근 90일</small></h3>
          <table className="tbl">
            <thead><tr><th>판매자</th><th>사유</th><th>반려</th></tr></thead>
            <tbody>
              {rejected.map((x) => (
                <tr key={x.id}><td><b>{x.name}</b></td><td className="muted">{x.rejectReason ?? '—'}</td><td className="muted">{ymdhm(x.reviewedAt)}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

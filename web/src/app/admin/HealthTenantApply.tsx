import { api, tokenRoles } from '../../lib/api';
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
 *
 * v10.202 (docs/319) — 위에 「입점 신청 받기」 줄: 켜짐 / 꺼짐(설정 mall.tenant · v10.223 부터 mall.tenant_apply — 판매 열기 mall.tenant 는 아래 줄) · SUPER 켜기(확인 창 · 입점 약관 HLT_SELLER 게시 뒤에만 — 서버 422 TENANT_TERMS_FIRST) · 끄기.
 *   켜면 사용자 웹 머리줄에 「소개몰 입점」 아이콘이 나오고 신청을 받습니다. 판매 · 지급은 결제대행사 하위가맹점 계약 뒤.
 */
export function HealthTenantApply() {
  const list = useApi<Application[]>('/admin/health/sellers/applications');
  const cfg = useApi<{ enabled: boolean; saleOpen?: boolean }>('/health/tenant/config');
  const a = useAct();
  const isSuper = tokenRoles().includes('SUPER');
  const flipTenant = (on: boolean) => {
    if (!on && !confirm('소개몰 입점 신청을 켭니다.\n\n사용자 웹 머리줄에 「소개몰 입점」 아이콘이 나오고 본인확인을 마친 회원이 신청할 수 있습니다.\n판매 · 판매대금 지급은 결제대행사 하위가맹점 계약 뒤에 열립니다.')) return;
    void a.run('tenant', () => api('/admin/site-settings', { method: 'PATCH', body: JSON.stringify({ key: 'mall.tenant_apply', value: on ? 'off' : 'on' }) }),
      cfg.reload, on ? '소개몰 입점 신청을 껐습니다(이미 받은 신청 · 판매자는 그대로).' : '소개몰 입점 신청을 켰습니다.');
  };
  /* v10.223 (D193) — 입점 판매 열기(mall.tenant)는 신청 받기와 따로. 끄면 새로 「판매 시작」이 막힘(이미 판매 중인 상품은 그대로) */
  const flipSale = (on: boolean) => {
    if (!on && !confirm('소개몰 입점 판매를 엽니다.\n\n승인된 입점 판매자가 검수 통과 상품의 판매를 시작할 수 있습니다.\n결제대행사 하위가맹점 · 지급대행 계약을 마쳤는지 확인하십시오.')) return;
    void a.run('tenantSale', () => api('/admin/site-settings', { method: 'PATCH', body: JSON.stringify({ key: 'mall.tenant', value: on ? 'off' : 'on' }) }),
      cfg.reload, on ? '입점 판매를 닫았습니다(새 판매 시작이 막힘 · 판매 중 상품은 그대로).' : '입점 판매를 열었습니다.');
  };
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
      {cfg.data && (
        <p className="card pad" data-tenant-switch={cfg.data.enabled ? 'on' : 'off'}>
          <b>입점 신청 받기</b> {cfg.data.enabled ? <b>켜짐</b> : <b className="warn-text">꺼짐</b>}
          {(isSuper || cfg.data.enabled) && <>{' '}<button className="btn-sm" disabled={a.busy === 'tenant'} onClick={() => flipTenant(cfg.data!.enabled)} data-tenant-flip="">{cfg.data.enabled ? '끄기' : '켜기'}</button></>}
          <small className="dim"> 켜기는 최고 관리자 · 입점 약관(HLT_SELLER)을 게시한 뒤에만. 켜면 사용자 웹 머리줄에 「소개몰 입점」 아이콘. 판매 · 지급은 결제대행사 하위가맹점 계약 뒤</small>
        </p>
      )}
      {cfg.data && (
        <p className="card pad" data-tenant-sale={cfg.data.saleOpen ? 'on' : 'off'}>
          <b>입점 판매 열기</b> {cfg.data.saleOpen ? <b>열림</b> : <b className="warn-text">닫힘</b>}
          {(isSuper || cfg.data.saleOpen) && <>{' '}<button className="btn-sm" disabled={a.busy === 'tenantSale'} onClick={() => flipSale(!!cfg.data!.saleOpen)} data-tenant-sale-flip="">{cfg.data.saleOpen ? '닫기' : '열기'}</button></>}
          <small className="dim"> 신청 받기와 따로(v10.223). 열기는 최고 관리자 · 결제대행사 하위가맹점 · 지급대행 계약 뒤</small>
        </p>
      )}
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

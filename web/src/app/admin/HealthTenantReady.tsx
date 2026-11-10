import { useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';

interface Row { key: string; group: 'apply' | 'sale'; label: string; state: 'ok' | 'todo' | 'info'; now: string }
interface Ready { applyReady: boolean; saleReady: boolean; applyOn: boolean; saleOn: boolean; bizReport?: { reportNo: string | null; reportedAt: string | null }; rows: Row[] }

const MARK: Record<Row['state'], { cls: string; text: string }> = {
  ok: { cls: 'st ok', text: '준비됨' }, todo: { cls: 'st no', text: '막힘' }, info: { cls: 'st wait', text: '값' },
};
const GROUP: Array<{ g: Row['group']; title: string; ready: (d: Ready) => boolean }> = [
  { g: 'apply', title: '신청 받기', ready: (d) => d.applyReady },
  { g: 'sale', title: '판매 열기', ready: (d) => d.saleReady },
];

/**
 * SB-ADM-HSL-010 소개몰 판매자 › 입점 열기 준비 점검 (v10.229 · docs/367) — 읽기만
 *
 *   스위치를 켜기 전에 필요한 것을 한 곳에서 「준비됨 / 막힘」으로. 막힘은 대표 · 법무 · 외부 차례라 오픈 전에는 정상입니다.
 *   스위치를 막는 규칙은 그대로(입점 약관 먼저 — 서버 422 TENANT_TERMS_FIRST).
 *   v10.231 (D199 · docs/370) — 업종 정정신고 줄에 신고 날짜 · 접수번호 「적기」(SUPER · 감사 HLT_BIZ_REPORT) · 둘 다 있으면 준비됨
 */
export function HealthTenantReady() {
  const q = useApi<Ready>('/admin/health/tenant/readiness');
  const a = useAct();
  const isSuper = tokenRoles().includes('SUPER');
  const [edit, setEdit] = useState<{ no: string; at: string } | null>(null);
  if (q.error) return <ErrorView error={q.error} />;
  const d = q.data;
  if (!d) return null;
  const save = (no: string, at: string) =>
    void a.run('biz', () => api('/admin/health/tenant/biz-report', { method: 'POST', body: JSON.stringify({ reportNo: no.trim() || null, reportedAt: at.trim() || null }) }),
      () => { setEdit(null); q.reload(); }, no.trim() ? '업종 정정신고 기록을 적었습니다.' : '업종 정정신고 기록을 비웠습니다.');
  return (
    <div data-tenant-ready="">
      <h3 className="sec">입점 열기 준비</h3>
      <Flash msg={a.msg} err={a.err} />
      {GROUP.map(({ g, title, ready }) => (
        <div key={g} data-tenant-ready-group={g} data-ready={ready(d) ? '1' : '0'}>
          <p><b>{title}</b> — {ready(d) ? <span className="st ok">준비됨</span> : <span className="st no">아직</span>}
            <small className="dim"> 스위치 {(g === 'apply' ? d.applyOn : d.saleOn) ? '켜짐' : '꺼짐'}</small></p>
          <table className="tbl">
            <tbody>
              {d.rows.filter((r) => r.group === g).map((r) => (
                <tr key={r.key} data-tenant-ready-row={r.key} data-state={r.state}>
                  <th>{r.label}</th>
                  <td><span className={MARK[r.state].cls}>{MARK[r.state].text}</span></td>
                  <td>{r.now}
                    {r.key === 'biz-report' && isSuper && !edit && (
                      <> <button className="btn-sm" data-biz-report-edit="" onClick={() => setEdit({ no: d.bizReport?.reportNo ?? '', at: d.bizReport?.reportedAt ?? '' })}>적기</button></>
                    )}
                    {r.key === 'biz-report' && edit && (
                      <span data-biz-report-form="">
                        {' '}<input type="date" value={edit.at} onChange={(e) => setEdit({ ...edit, at: e.target.value })} aria-label="신고 날짜" />
                        {' '}<input value={edit.no} maxLength={40} placeholder="접수번호" onChange={(e) => setEdit({ ...edit, no: e.target.value })} aria-label="접수번호" />
                        {' '}<button className="btn-sm" disabled={a.busy === 'biz'} onClick={() => save(edit.no, edit.at)}>저장</button>
                        {(d.bizReport?.reportNo || d.bizReport?.reportedAt) && <>{' '}<button className="btn-sm" disabled={a.busy === 'biz'} onClick={() => save('', '')}>비우기</button></>}
                        {' '}<button className="btn-sm" onClick={() => setEdit(null)}>취소</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

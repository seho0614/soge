import { api, ApiFailure } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useState } from 'react';
import { ErrorView } from '../../components/ErrorView';

interface Axis {
  gwanCode: string; gwanName: string; axisCode: string; name: string; nature: string; judge: string;
  urgentLabel: string | null; regulation: string | null; isExposed: boolean; uiType: string; uiTypeLabel: string; uiFixed: boolean;
}
const UI: [string, string][] = [['LIST', '목록형'], ['MATCH', '매칭형'], ['SERVICE', '서비스형'], ['CONTENT', '콘텐츠형']];
const WHY: Record<string, string> = {
  MAL: '자산 성격 — 등기가 있는 자산과 실물로 넘기는 자산은 확인할 것도 법도 다릅니다.',
  BIZ: '창업 단계 — 창업은 사고파는 것만이 아닙니다 — 사람도, 자문도, 정보도 오갑니다.',
};

/**
 * SB-ADM-GWN-010 관 UI/UX 관리 (v10.31 — 시안 admgux. 전에는 관 목록 화면이 열렸고 축 · UI 유형 관리가 없었습니다)
 * 서버: gwan_axes(GET/PATCH /admin/gwan-axes). 축을 내리면 신규 노출만 멈춥니다 — 진행 중인 거래는 끝까지 갑니다.
 * 사용자 웹은 GET /site/gwan-axes 로 노출 중인 축만 읽습니다(소개창업 · 안심소개 화면 GwanLanding — v10.31 합침으로 연결).
 */
export function GwanUx({ onGo }: { onGo?: (tab: string) => void }) {
  const r = useApi<Axis[]>('/admin/gwan-axes');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<[boolean, string] | null>(null);
  const patch = async (x: Axis, body: Record<string, unknown>, ok: string) => {
    setBusy(`${x.gwanCode}/${x.axisCode}`); setMsg(null);
    try { await api(`/admin/gwan-axes/${x.gwanCode}/${x.axisCode}`, { method: 'PATCH', body: JSON.stringify(body) }); setMsg([true, ok]); r.reload(); }
    catch (e) { setMsg([false, e instanceof ApiFailure ? e.body.message : '바꾸지 못했습니다.']); }
    finally { setBusy(null); }
  };
  if (r.error) return <ErrorView error={r.error} onRetry={r.reload} />;
  if (!r.data) return <p className="muted">불러오는 중…</p>;
  const gw = [...new Set(r.data.map((x) => x.gwanCode))];
  return (
    <>
      <div className="ad-nt info">
        <b>바꾸는 것은 축과 UI 유형뿐입니다.</b> 골격(헤더 · 방향 탭 · 정렬 · 카드 틀)과 불변식(INV-9 소개비 무공제 · INV-2 귀속 90일)은 관이 달라도 그대로입니다.
        여기서 축을 내려도 진행 중인 거래는 끝까지 갑니다 — 신규 노출만 멈춥니다(E-01과 같은 방식).
      </div>
      {msg && <p className={msg[0] ? 'form-ok' : 'form-error'} role="status">{msg[1]}</p>}
      {/* v10.32 — 시안 .guxh: 관 이름 · 축 수 칩(단일 축 회색 · N축 초록) · 설명이 한 줄 */}
      <div className="ad-panel" data-gux="MNY">
        <div className="ad-guxh"><b>소개장터</b><span className="ad-bg">단일 축</span><span className="ls">품목만 나뉘고 축이 없습니다 — 이 화면에서 바꿀 것이 없습니다</span></div>
        <span className="ad-ls">소개장터는 물품 · 용역이 같은 성격(빠르고 작고 반복되는 거래)이라 내부를 쪼개지 않습니다. 구조를 바꾸려면 먼저 관 설정에서 소개 대상을 다시 정의해야 합니다.</span>
      </div>
      {gw.map((g) => {
        const rows = r.data!.filter((x) => x.gwanCode === g);
        return (
          <div key={g} className="ad-panel" data-gux={g}>
            <div className="ad-guxh"><b>{rows[0]!.gwanName}</b><span className="ad-bg ok" data-axis-n={rows.length}>{rows.length}축</span>{WHY[g] && <span className="ls">{WHY[g]}</span>}</div>
            <div className="ad-tw"><table className="tbl">
              <thead><tr><th>축</th><th>성격</th><th>판정 문장</th><th>급구 명칭</th><th>규제</th><th>노출</th><th>UI 유형</th></tr></thead>
              <tbody>{rows.map((x) => {
                const k = `${x.gwanCode}/${x.axisCode}`;
                return (
                  <tr key={k} className={!x.isExposed ? 'hl' : undefined} data-axis={k}>
                    <td><b>{x.name}</b></td><td>{x.nature}</td><td>{x.judge}</td><td>{x.urgentLabel ?? <span className="ad-ls">없음</span>}</td>
                    {/* v10.32 — 시안: 규제 있으면 빨강 칩 · 없으면 초록 「없음」 칩 */}
                    <td>{x.regulation ? <span className="ad-bg no">{x.regulation}</span> : <span className="ad-bg ok">없음</span>}</td>
                    <td><button className="btn-sm" disabled={busy === k}
                                onClick={() => patch(x, { isExposed: !x.isExposed }, x.isExposed ? `${x.name} 축을 내렸습니다 — 신규 노출만 멈춥니다.` : `${x.name} 축을 다시 노출합니다.`)}>
                      {x.isExposed ? '노출중 — 내리기' : '내려둠 — 올리기'}</button></td>
                    <td>{x.uiFixed
                      ? <><span className="ad-bg">{x.uiTypeLabel} 고정</span><span className="ad-ls">거래형 축이라 매물 카드 틀을 공유합니다 — 스펙 한 줄만 축별로 다릅니다.</span></>
                      /* v10.32 — 시안 .guxu: 고른 유형은 검정 채움 */
                      : <span className="ad-guxu">{UI.map(([c, t]) => (
                          <button key={c} className={x.uiType === c ? 'on' : ''} disabled={busy === k || x.uiType === c}
                                  onClick={() => patch(x, { uiType: c }, `${x.name} 축을 ${t}으로 바꿨습니다.`)}>{t}</button>))}</span>}
                    </td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          </div>
        );
      })}
      <div className="ad-nt warn">
        <b>규제가 걸린 축은 내려둔 채로 두십시오.</b> 안심소개 부동산은 A-07 공인중개사법 회신이, 소개창업 인력은 A-09 직업안정법 · 근로자파견법 회신이 선행되어야 전면 개방할 수 있습니다.
        지금 올리면 아직 열지 않은 축으로 사용자를 보내게 됩니다.
      </div>
      {onGo && <div className="ad-dact"><button className="btn-plain" onClick={() => onGo('gwans')}>관 관리로</button><button className="btn-plain" onClick={() => onGo('category')}>업종 관리로</button></div>}
    </>
  );
}

import { useEffect, useState } from 'react';
import { ymdKst } from '../../lib/format';
import { api } from '../../lib/api';
import { ErrorView } from '../../components/ErrorView';
import { codeList } from '../../lib/codes';
import { MapKeys } from './MapKeys';
import { WeatherKeys } from './WeatherKeys';
import { IntegrationKeys } from './IntegrationKeys';

interface Integration {
  code: string; name: string; purpose: string; provider: string | null;
  status: string; statusLabel: string; requiresIp: boolean;
  egressIp: string | null; ipRequestedAt: string | null; ipApprovedAt: string | null;
  secretKeyName: string | null; secretRegistered: boolean;
  leadTimeWeeks: number | null; blocksOpen: boolean; memo: string | null;
  estWeeksRemaining: number;
}


/**
 * SB-ADM-SIT-080 외부 연동 관리.
 * SB-ADM-ITG-010 외부 연동 상태 (같은 API 3종 — 한 화면으로 둡니다)
 *
 * ★ 레지스트리의 ITG-010 은 ADMIN · SUPER 인데 서버(`/admin/integrations*`)는
 *   SUPER 만 받습니다(2026-10-02 실측). 탭은 서버에 맞춰 SUPER 에게만 보입니다.
 *
 * 6종 중 5종이 발신 IP 화이트리스트를 요구하고 심사에 2~4주 걸립니다.
 * 코드보다 IP 가 먼저 필요하므로, 여기서 IP 등록 상태를 추적합니다.
 *
 * ★ v10.128(D128 · docs/192) — 키는 아래 「연동 키」 구역에서 넣습니다(암호화 저장 · 끝 4자리만 · 이 화면 키가 먼저, 없으면 .env).
 *   DB 에는 암호문만 — 열쇠(ENC_KEY)는 .env 에만 있어 백업 · 덤프에는 암호문만 남습니다.
 *   「키 등록 완료」 체크는 비공개 키를 넣으면 저절로 켜집니다(.env 로 넣은 경우는 전처럼 손으로).
 */
export function Integrations() {
  const [rows, setRows] = useState<Integration[]>([]);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ip, setIp] = useState('');
  const [ipMsg, setIpMsg] = useState<string | null>(null);

  const load = () => api<Integration[]>('/admin/integrations').then((r) => {
    setRows(r);
    setIp(r.find((x) => x.egressIp)?.egressIp ?? '');
  }).catch(setErr);
  useEffect(() => { void load(); }, []);

  async function patch(code: string, body: Record<string, unknown>) {
    setBusy(code);
    try {
      await api(`/admin/integrations/${code}`, { method: 'PATCH', body: JSON.stringify(body) });
      await load();
    } catch (e) { setErr(e); } finally { setBusy(null); }
  }

  async function applyIp() {
    /* v10.27 (G-187) — 빈칸이면 아무 일도 없던 것을 안내로 */
    if (!ip.trim()) { setIpMsg('발신 IP 를 적어 주십시오 — 예: 3.38.0.10 (서버의 고정 IP)'); return; }
    setIpMsg(null);
    setBusy('_ip');
    try {
      await api('/admin/integrations/egress-ip', {
        method: 'PATCH', body: JSON.stringify({ ip: ip.trim() }),
      });
      await load();
    } catch (e) { setErr(e); } finally { setBusy(null); }
  }

  if (err) return <ErrorView error={err} onRetry={() => { setErr(null); void load(); }} />;

  const blocking = rows.filter((r) => r.blocksOpen && r.status !== 'LIVE');
  const maxWeeks = rows.reduce((a, r) => Math.max(a, r.estWeeksRemaining), 0);

  return (
    <section>
      {/* v10.31 (시안 scAdmSit8) — 「차단 N / M」 · 경고 · 읽기용 요약 표(연동 · 상태 · 오픈 차단 · IP 등록 · 다음에 할 일)를 위에.
          연동마다 상태 · 사업자 · IP · 키를 바꾸는 카드(개발에만 있는 편집)는 아래 「연동별 설정」으로 둡니다 */}
      <div className="ad-chk"><b>차단 {blocking.length} / {rows.length}</b><span className={`ad-bg ${blocking.length ? 'no' : 'ok'}`}>{blocking.length ? '오픈 불가' : '오픈 가능'}</span></div>
      {blocking.length > 0 && (
        <div className="ad-nt warn">
          <b>오픈을 막는 연동 {blocking.length}건.</b> {blocking.map((r) => r.name).join(' · ')} — 이것들이 끝나야 오픈할 수 있습니다. 예상 최장 <b>{maxWeeks}주</b> 남았습니다.
        </div>
      )}
      <div className="ad-tw"><table className="tbl" data-int-summary>
        <thead><tr><th>연동</th><th>상태</th><th>오픈 차단</th><th>IP 등록</th><th>다음에 할 일</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.code} className={r.blocksOpen && r.status !== 'LIVE' ? 'bad' : undefined}>
            <td><b>{r.name}</b><span className="ad-ls">{r.purpose}</span></td>
            <td className="mono">{r.status}<span className="ad-ls">{r.statusLabel}</span></td>
            <td>{r.blocksOpen ? '예' : '아니오'}</td>
            <td>{!r.requiresIp ? '불필요' : r.ipApprovedAt ? '승인됨' : r.ipRequestedAt ? '심사중' : `필요${r.leadTimeWeeks ? ` · ${r.leadTimeWeeks}주` : ''}`}</td>
            <td className="dim">{r.status === 'LIVE' ? '—' : r.memo ?? (r.requiresIp && !r.ipApprovedAt ? '계약 · 발신 IP 등록' : !r.secretRegistered ? '키 발급 · 등록' : '실제 호출 확인 후 LIVE')}</td>
          </tr>
        ))}</tbody>
      </table></div>
      <div className="ad-nt info"><b>키는 아래 「연동 키」에서 넣습니다.</b> 암호화해 저장하고 끝 4자리만 보입니다 — DB 백업에는 암호문만 남습니다. 이 화면 키가 먼저, 없으면 .env. 카카오맵 · 날씨 키는 맨 아래 각 구역.</div>
      <div className="ad-nt info"><b>IP 등록 2~4주가 가장 긴 항목입니다.</b> 계약을 먼저 걸어 두시는 편이 낫습니다.</div>
      <h2 className="ad-s2">연동별 설정 <em>{rows.length}</em> <small className="dim">개발에만 — 상태 · 사업자 · IP · 키 등록</small></h2>

      <div className="ip-box">
        <label className="fld">
          <span>발신 IP (NAT Gateway 고정)</span>
          <div className="ip-row">
            <input value={ip} onChange={(e) => { setIp(e.target.value); setIpMsg(null); }} placeholder="0.0.0.0" aria-label="발신 IP" />
            <button className="btn-ok" disabled={busy === '_ip'} onClick={applyIp}>
              전 연동에 반영
            </button>
          </div>
          <em>
            연동마다 따로 넣으면 값이 갈립니다. 여기서 한 번에 반영하고 IP 심사중으로 바뀝니다.
          </em>
          {ipMsg && <span className="warn-text" role="alert" data-ip-msg>{ipMsg}</span>}
        </label>
      </div>

      <ul className="rows">
        {rows.map((r) => (
          <li key={r.code} className="row">
            <div className="row-head">
              <strong>{r.name}</strong>
              <span className="mono">{r.code}</span>
              {r.blocksOpen && <span className="pill pill-danger">오픈 차단</span>}
              <span className={`pill pill-${codeList('integration.status').find((c) => c.code === r.status)?.tone ?? 'muted'}`}>{r.statusLabel}</span>
            </div>

            <p className="legal">{r.purpose}</p>
            {r.memo && <p className="block-msg">{r.memo}</p>}

            <div className="int-grid">
              <label>
                <span>상태</span>
                <select
                  defaultValue={r.status} disabled={busy === r.code}
                  onChange={(e) => patch(r.code, { status: e.target.value })}
                >
                  {codeList('integration.status').map((c) => (
                    <option key={c.code} value={c.code}>{c.label}</option>
                  ))}
                </select>
              </label>

              <label>
                <span>사업자</span>
                <input
                  defaultValue={r.provider ?? ''} placeholder="미정"
                  onBlur={(e) => e.target.value !== (r.provider ?? '')
                    && patch(r.code, { provider: e.target.value })}
                />
              </label>

              {r.requiresIp && (
                <label>
                  <span>IP 승인일</span>
                  <input
                    type="date"
                    defaultValue={(ymdKst(r.ipApprovedAt) || '')}
                    onChange={(e) => e.target.value
                      && patch(r.code, { ipApprovedAt: e.target.value })}
                  />
                </label>
              )}

              <label className="chk">
                <input
                  type="checkbox" defaultChecked={r.secretRegistered}
                  onChange={(e) => patch(r.code, { secretRegistered: e.target.checked })}
                />
                <span>
                  키 등록 완료
                  {r.secretKeyName && <em className="mono"> {r.secretKeyName}</em>}
                </span>
              </label>
            </div>

            <p className="hint">
              {r.status === 'LIVE'
                ? '운영 중입니다.'
                : `예상 ${r.estWeeksRemaining}주 남음${r.requiresIp && !r.ipApprovedAt ? ' (IP 심사 포함)' : ''}`}
            </p>
          </li>
        ))}
      </ul>

      {/* v10.128 (D128 · docs/192) — 결제 · 계좌 · 국세청 · 중개사 · 세금계산서 · 메일 · 본인인증 · 전자계약 · 알림톡 · 안심번호 키(2026-10-27 대표 승인) */}
      <IntegrationKeys />

      {/* v10.46 (D099 · docs/96) — 카카오맵 키(이 두 키만 화면에서 넣음 · 2026-10-17 대표 결정) */}
      <MapKeys />

      {/* v10.49 (D103 · docs/101) — 메인 「오늘의 날씨」 기상청 키(카카오맵과 같은 방식 · 2026-10-20 계획 승인) */}
      <WeatherKeys />
    </section>
  );
}

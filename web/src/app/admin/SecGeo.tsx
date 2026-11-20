/* ===== v10.485 (D268 · docs/623) 운영자 해외 접속 경고 — web/src/app/admin/SecGeo.tsx 새 파일 =====
 * 위험감지 › 해외 접속 경고(SB-ADM-SCU-030)
 *   ADMIN · SUPER  설정 · 판별 준비 · 30일 셈 · 최근 운영 로그인 판정 50
 *   SUPER          켜기 · 방식(ASSUME · LIVE) · 간주 나라 · 허용 나라(KR 꼭) · 막기 · IP 하나 판별 시험
 * (adminMenu · App.tsx 연결 줄은 patches/1_wiring.md)
 */
import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';

interface View {
  settings: { watch: boolean; mode: string; assume: string; allow: string[]; block: boolean };
  ready: { mode: string; keySet: boolean; notReady: boolean; base: string };
  days30: { total: number; alert: number; blocked: number; unknown: number };
  recent: Array<{ id: string; email: string | null; ip: string | null; country: string | null; source: string; result: string; at: string }>;
  canEdit: boolean;
}
const RESULT: Record<string, string> = { OK: '허용 나라', ALERT: '경고', BLOCKED: '막음', UNKNOWN: '판별 못 함' };
const SOURCE: Record<string, string> = { ASSUME: '간주', LIVE: '업체', CACHE: '캐시', PRIVATE: '사설 IP', NOT_READY: '키 없음', ERROR: '업체 오류' };

export function SecGeo() {
  const q = useApi<View>('/admin/security/geo');
  const a = useAct();
  const [f, setF] = useState<{ allow: string; assume: string; mode: string; reason: string } | null>(null);
  const [ip, setIp] = useState('');
  const [out, setOut] = useState<string | null>(null);
  const d = q.data;
  if (!d) return <p className="muted">불러오는 중…</p>;
  const s = d.settings;
  const put = (body: Record<string, unknown>, after?: () => void) => void a.run('geo', () => api('/admin/security/geo', { method: 'PUT', body: JSON.stringify(body) }), () => { after?.(); q.reload(); });
  return (
    <section data-sec-geo="" data-sec-geo-on={s.watch ? 'on' : 'off'}>
      <Flash msg={a.msg} err={a.err} />
      <div className="kpis">
        <div className="kpi"><b>{d.days30.total}</b><span>30일 운영 로그인 판정</span></div>
        <div className="kpi"><b>{d.days30.alert}</b><span>해외 경고</span></div>
        <div className="kpi"><b>{d.days30.blocked}</b><span>막음</span></div>
        <div className="kpi"><b>{d.days30.unknown}</b><span>판별 못 함</span></div>
      </div>
      <table className="tbl"><tbody>
        <tr><th>경고</th><td>{s.watch ? '켜짐 — 운영 역할 로그인마다 나라를 봄' : '꺼짐(처음)'}</td></tr>
        <tr><th>판별 방식</th><td data-sec-geo-mode={s.mode}>{s.mode === 'LIVE' ? '업체(GEOIP)' : `간주 — 모든 접속을 ${s.assume} 로 봄(점검판)`}{d.ready.notReady && <span className="warn-text"> · 키 없음(NOT_READY) — 판별 못 함 · 막지 않음</span>}</td></tr>
        <tr><th>허용 나라</th><td className="mono">{s.allow.join(', ')}</td></tr>
        <tr><th>막기</th><td>{s.block ? <span className="warn-text">켜짐 — 허용 나라 밖 운영 로그인을 막음</span> : '꺼짐 — 운영 알림만(STAFF_LOGIN_ABROAD · 긴급)'}</td></tr>
        <tr><th>업체 키</th><td>{d.ready.keySet ? '있음' : '없음'} · 주소 틀 {d.ready.base} — 외부 연동 › 연동 키 「GEOIP_API_KEY」</td></tr>
      </tbody></table>
      {d.canEdit && (f == null ? (
        <p>
          <button className="btn-sm" onClick={() => { const why = prompt(s.watch ? '경고를 끄는 사유' : '경고를 켜는 사유') ?? ''; if (why.trim().length >= 2) put({ watch: !s.watch, reason: why }); }} data-sec-geo-toggle="">{s.watch ? '경고 끄기' : '경고 켜기'}</button>{' '}
          <button className="btn-sm" disabled={!s.watch && !s.block} onClick={() => {
            const why = prompt(s.block ? '막기를 끄는 사유' : '막기를 켜는 사유 — 켜면 허용 나라 밖 운영 로그인이 막힙니다(출장 전 허용 나라에 더하십시오)') ?? '';
            if (why.trim().length >= 2) put({ block: !s.block, reason: why });
          }} data-sec-geo-block="">{s.block ? '막기 끄기' : '막기 켜기'}</button>{' '}
          <button className="btn-sm btn-plain" onClick={() => setF({ allow: s.allow.join(','), assume: s.assume, mode: s.mode, reason: '' })} data-sec-geo-edit="">나라 · 방식 바꾸기</button>
        </p>
      ) : (
        <p data-sec-geo-form="">
          <label>허용 나라 <input className="inp" value={f.allow} onChange={(e) => setF({ ...f, allow: e.target.value.toUpperCase() })} placeholder="KR,JP" /></label>{' '}
          <label>방식 <select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}><option value="ASSUME">간주</option><option value="LIVE">업체(GEOIP)</option></select></label>{' '}
          <label>간주 나라 <input className="inp" value={f.assume} maxLength={2} onChange={(e) => setF({ ...f, assume: e.target.value.toUpperCase() })} /></label>{' '}
          <label>사유 <input className="inp" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="2 ~ 200자" /></label>{' '}
          <button className="btn-sm" disabled={!!a.busy} onClick={() => put({ allow: f.allow, mode: f.mode, assumeCountry: f.assume, reason: f.reason }, () => setF(null))} data-sec-geo-save="">저장</button>{' '}
          <button className="btn-sm btn-plain" onClick={() => setF(null)}>닫기</button>
        </p>
      ))}
      {d.canEdit && (
        <p data-sec-geo-test="">
          <input className="inp" value={ip} onChange={(e) => setIp(e.target.value.trim())} placeholder="IP(예 8.8.8.8)" />{' '}
          <button className="btn-sm" disabled={!ip || !!a.busy} onClick={() => void a.run('t', async () => {
            const r = await api<{ ip: string; country: string | null; source: string; allowed: boolean | null }>('/admin/security/geo/test', { method: 'POST', body: JSON.stringify({ ip }) });
            setOut(`${r.ip} → ${r.country ?? '판별 못 함'} (${SOURCE[r.source] ?? r.source})${r.allowed === false ? ' · 허용 나라 밖' : ''}`);
            return r;
          })}>판별 시험</button>{out && <span className="mono"> {out}</span>}
        </p>
      )}
      <table className="tbl" data-sec-geo-recent={d.recent.length}><thead><tr><th>때</th><th>운영자</th><th>IP</th><th>나라</th><th>판별</th><th>판정</th></tr></thead>
        <tbody>{d.recent.map((r) => (
          <tr key={r.id}><td>{ymdhm(r.at)}</td><td className="mono">{r.email}</td><td className="mono">{r.ip ?? '—'}</td><td>{r.country ?? '—'}</td><td>{SOURCE[r.source] ?? r.source}</td>
            <td className={r.result === 'OK' ? '' : 'warn-text'}>{RESULT[r.result] ?? r.result}</td></tr>
        ))}</tbody></table>
      <div className="ad-nt info">업체에 접속 IP 를 보내는 것은 개인정보 처리 위탁(해외 업체면 국외 이전)일 수 있어 법무 확인 뒤 LIVE 로 바꿉니다. 판별을 못 하면(키 없음 · 업체 오류) 막지 않고 「판별 못 함」으로 남깁니다.</div>
    </section>
  );
}

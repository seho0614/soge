import { useEffect, useState } from 'react';
import { ymdKst } from '../../lib/format';
import { api } from '../../lib/api';
import { ErrorView } from '../../components/ErrorView';
import { codeList } from '../../lib/codes';
import { MapKeys } from './MapKeys';
import { WeatherKeys } from './WeatherKeys';
import { IntegrationKeys } from './IntegrationKeys';
import { MailPanel } from './MailPanel';
import { IdentityPanel } from './IdentityPanel';
import { AlimtalkPanel } from './AlimtalkPanel';
import { EsignPanel } from './EsignPanel';
import { IntegTestPanel } from './IntegTestPanel';
import { SafenumPanel } from './SafenumPanel';

interface Integration {
  code: string; name: string; purpose: string; provider: string | null;
  status: string; statusLabel: string; requiresIp: boolean;
  egressIp: string | null; ipRequestedAt: string | null; ipApprovedAt: string | null;
  secretKeyName: string | null; secretRegistered: boolean;
  leadTimeWeeks: number | null; blocksOpen: boolean; memo: string | null;
  estWeeksRemaining: number;
  appliedAt?: string | null; keyAt?: string | null; testedAt?: string | null; liveAt?: string | null;   /* v10.260 (D205) */
  dueOn?: string | null; overdue?: boolean;   /* v10.235 (docs/375) 예상일 = IP 신청일 + 걸리는 기간 · 지났는데 LIVE 아님 */
}

/* v10.260 (D205 · docs/392) — 외부 연동 신청 진행표 */
interface Progress {
  bizReportAt: string | null;
  apply?: { company: string | null; bizNo: string | null; ceo: string | null; address: string | null; baseUrl: string | null; egressIp: string | null };
  summary: { total: number; live: number; applied: number; blocking: number; overdue: number };
  rows: Array<{ code: string; name: string; status: string; provider: string | null; blocksOpen: boolean; requiresIp: boolean; dueOn: string | null; overdue: boolean;
    steps: Array<{ key: string; at: string | null; done: boolean }>; now: string; next: string; doneSteps: number; totalSteps: number }>;
}
const STEP_COLS: Array<[string, string]> = [['BIZ', '업종 정정'], ['APPLY', '신청'], ['IP_REQ', 'IP 신청'], ['IP_OK', 'IP 승인'], ['KEY', '키'], ['TEST', '시험'], ['LIVE', 'LIVE']];

/* ---------------------------------------------------------------------
 * v10.265 (docs/395) — 신청서 묶음: 연동마다 업체 신청서에 적을 값(docs/227 3절) · 복사 단추.
 *   공통 값은 운영 설정(footer.* · site.base_url · infra.egress_ip)에서 · 받는 주소 · 받아 올 키 이름은 아래 표(코드가 쓰는 이름 그대로).
 *   키 값은 여기 없음 — 받으면 「연동 키」에 넣음.
 * ------------------------------------------------------------------- */
const APPLY_INFO: Record<string, { vendor: string; weeks: string; returnPath?: string; keys: string[]; env?: string[]; note?: string }> = {
  PASS: { vendor: 'NICE평가정보(표준창) — 1원 계좌인증과 한 번에', weeks: '약 6주', returnPath: '/verify/return', keys: ['NICE_CLIENT_ID', 'NICE_CLIENT_SECRET', 'NICE_PRODUCT_ID'], env: ['NICE_API_BASE', 'NICE_WINDOW_URL'] },
  BANK: { vendor: 'NICE평가정보 — 본인인증과 한 번에', weeks: '약 4주', keys: ['BANK_VERIFY_KEY'], env: ['BANK_VERIFY_URL'] },
  PG: { vendor: '토스페이먼츠(결제만)', weeks: '약 5주', returnPath: '/api/v1/webhooks/toss', keys: ['TOSS_SECRET_KEY', 'TOSS_CLIENT_KEY'], note: '결제 알림(웹훅) 주소로 등록' },
  ALIMTALK: { vendor: '알림톡 대행사(업체 확인 필요)', weeks: '약 8주(템플릿 심사 포함)', keys: ['ALIMTALK_KEY', 'ALIMTALK_SENDER_KEY'], env: ['ALIMTALK_URL'], note: '템플릿 문구는 운영 화면 › 알림톡' },
  ESIGN: { vendor: '전자계약 업체(업체 확인 필요)', weeks: '약 2주', returnPath: '/api/v1/webhooks/esign', keys: ['ESIGN_API_KEY', 'ESIGN_WEBHOOK_SECRET'], env: ['ESIGN_URL'] },
  SAFENUM: { vendor: '050 안심번호 업체(업체 확인 필요)', weeks: '업체 확인 필요', returnPath: '/api/v1/webhooks/safenum', keys: ['SAFENUM_KEY', 'SAFENUM_WEBHOOK_SECRET'], env: ['SAFENUM_URL'] },
  NTS: { vendor: '공공데이터포털(국세청 사업자 상태)', weeks: '1 ~ 2주', keys: ['NTS_SERVICE_KEY'] },
};
function copyText(v: string, e: { currentTarget: HTMLButtonElement }) {
  const b = e.currentTarget;
  navigator.clipboard?.writeText(v).then(() => { b.textContent = '복사됨'; }, () => { b.textContent = '복사 못 함 — 글을 끌어 고르십시오'; });
}
function ApplyValues({ code, p, requiresIp }: { code: string; p: Progress; requiresIp: boolean }) {
  const info = APPLY_INFO[code];
  const ap = p.apply;
  const base = (ap?.baseUrl ?? 'https://sogaebank.com').replace(/\/$/, '');
  const rows: Array<[string, string | null]> = [
    ['상호 · 운영 주체', ap?.company ?? null], ['사업자등록번호', ap?.bizNo ?? null], ['대표자', ap?.ceo ?? null], ['사업장 주소', ap?.address ?? null],
    ['서비스 주소', base], ...(requiresIp ? [['허용 IP(서버 발신)', ap?.egressIp ?? null] as [string, string | null]] : []),
    ...(info?.returnPath ? [['받는 주소(업체에 등록)', base + info.returnPath] as [string, string | null]] : []),
    ['업종', '전자상거래 소매업(525101) + 중개 — 정정 뒤 새 등록증 기준'],
  ];
  return (
    <div data-int-apply={code} style={{ padding: '6px 0' }}>
      {info && <p className="dim">업체(안) {info.vendor} · 걸리는 기간 {info.weeks}{info.note ? ` · ${info.note}` : ''}</p>}
      <table className="tbl"><tbody>
        {rows.map(([k, v]) => (
          <tr key={k} data-int-apply-row={k}><td>{k}</td><td className="mono">{v ?? <span className="warn-text">운영 설정에 없음</span>}</td>
            <td>{v && <button type="button" className="btn-sm ghost" onClick={(e) => copyText(v, e)} data-int-copy="">복사</button>}</td></tr>
        ))}
        {info && <tr data-int-apply-row="keys"><td>받아 올 키 이름</td><td className="mono">{info.keys.join(' · ')}{info.env?.length ? ` (주소: ${info.env.join(' · ')} — 운영 .env)` : ''}</td><td /></tr>}
      </tbody></table>
      <p className="dim">키를 받으면 아래 「연동 키」에 넣고(값은 채팅 · 메일에 붙이지 않음) Claude 에게는 넣은 키 이름 · 업체 개발 문서만 넘깁니다(docs/227 4절).</p>
    </div>
  );
}

/** 한 줄에 한 연동 · 칸마다 날짜(없으면 「—」 · IP 가 필요 없으면 「해당 없음」) · 지금 단계는 굵게 */
function ProgressTable({ p }: { p: Progress }) {
  const [openCode, setOpenCode] = useState<string | null>(null);
  return (
    <div data-int-progress={`${p.summary.applied}|${p.summary.live}|${p.summary.total}`}>
      <h2 className="ad-s2">신청 진행표 <em>신청 {p.summary.applied} · LIVE {p.summary.live} / {p.summary.total}</em>
        {p.summary.overdue > 0 && <small className="warn-text"> 예상일 지남 {p.summary.overdue}</small>}</h2>
      {!p.bizReportAt && <div className="ad-nt warn" data-int-biz="none"><b>업종 정정신고가 먼저입니다.</b> 새 사업자등록증이 본인인증 · 계좌인증 · 결제 신청서의 첨부입니다 — 신고하면 「소개몰 판매자」 탭 맨 위 「입점 열기 준비」에서 날짜 · 접수번호를 적으십시오(SUPER).</div>}
      <div className="ad-tw"><table className="tbl">
        <thead><tr><th>연동</th>{STEP_COLS.map(([, l]) => <th key={l}>{l}</th>)}<th>다음에 할 일</th></tr></thead>
        <tbody>{p.rows.flatMap((r) => [
          <tr key={r.code} data-int-row={r.code} data-int-now={r.now} className={r.blocksOpen && r.now !== 'DONE' ? 'bad' : undefined}>
            <td><b>{r.name}</b>{r.blocksOpen && <span className="ad-ls">오픈 차단</span>}</td>
            {STEP_COLS.map(([k]) => {
              const st = r.steps.find((x) => x.key === k);
              if (!st) return <td key={k} className="dim">해당 없음</td>;
              return <td key={k} data-int-step={k} data-done={st.done ? '1' : '0'}>
                {st.done ? <span className="st ok">{st.at ?? '됨'}</span> : r.now === k ? <b>지금</b> : <span className="dim">—</span>}
              </td>;
            })}
            <td className="dim">{r.next}{r.overdue && r.dueOn ? <> · <b className="warn-text">예상일 {r.dueOn} 지남</b></> : null}
              {r.now !== 'DONE' && <> <button type="button" className="btn-sm ghost" onClick={() => setOpenCode(openCode === r.code ? null : r.code)} aria-expanded={openCode === r.code} data-int-apply-btn={r.code}>{openCode === r.code ? '신청서 값 닫기' : '신청서 값'}</button></>}</td>
          </tr>,
          openCode === r.code && <tr key={r.code + ':apply'}><td colSpan={STEP_COLS.length + 2}><ApplyValues code={r.code} p={p} requiresIp={r.requiresIp} /></td></tr>,
        ])}</tbody>
      </table></div>
      <div className="ad-nt info">날짜는 아래 「연동별 설정」에서 적습니다(업체에 확인하지 않고 적은 날짜를 그대로 보여 줌). 상태를 LIVE 로 바꾸면 LIVE 날짜는 저절로 오늘이 됩니다.</div>
    </div>
  );
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
/** v10.129 — 키를 이 화면 「연동 키」가 아닌 곳에서 넣는 연동 */
const KEY_AT: Record<string, { label: string; href?: string; sel?: string }> = {
  AGENT: { label: '위험감지 › AI 운영 › AI 에이전트 › 「AI 키」(최고 관리자)', href: '#/ai-ops/agent' },
  MAP: { label: '이 화면 아래 「카카오맵 키」', sel: '[data-map-keys]' },
  WEATHER: { label: '이 화면 아래 「날씨 키」', sel: '[data-weather-keys]' },
};

export function Integrations() {
  const [rows, setRows] = useState<Integration[]>([]);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ip, setIp] = useState('');
  const [ipMsg, setIpMsg] = useState<string | null>(null);

  const [prog, setProg] = useState<Progress | null>(null);
  const load = () => Promise.all([api<Integration[]>('/admin/integrations'), api<Progress>('/admin/integrations/progress')]).then(([r, p]) => {
    setRows(r); setProg(p);
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
        <thead><tr><th>연동</th><th>상태</th><th>오픈 차단</th><th>IP 등록</th><th>예상일</th><th>다음에 할 일</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.code} className={r.blocksOpen && r.status !== 'LIVE' ? 'bad' : undefined}>
            <td><b>{r.name}</b><span className="ad-ls">{r.purpose}</span></td>
            <td className="mono">{r.status}<span className="ad-ls">{r.statusLabel}</span></td>
            <td>{r.blocksOpen ? '예' : '아니오'}</td>
            <td>{!r.requiresIp ? '불필요' : r.ipApprovedAt ? '승인됨' : r.ipRequestedAt ? '심사중' : `필요${r.leadTimeWeeks ? ` · ${r.leadTimeWeeks}주` : ''}`}</td>
            <td data-int-due={r.code} data-overdue={r.overdue ? '1' : '0'}>{r.status === 'LIVE' || !r.dueOn ? '—' : r.overdue ? <b className="warn-text">{r.dueOn} 지남</b> : r.dueOn}</td>
            <td className="dim">{r.status === 'LIVE' ? '—' : r.memo ?? (r.requiresIp && !r.ipApprovedAt ? '계약 · 발신 IP 등록' : !r.secretRegistered ? '키 발급 · 등록' : '실제 호출 확인 후 LIVE')}</td>
          </tr>
        ))}</tbody>
      </table></div>
      {prog && <ProgressTable p={prog} />}
      <div className="ad-nt info"><b>키는 아래 「연동 키」에서 넣습니다.</b> 암호화해 저장하고 끝 4자리만 보입니다 — DB 백업에는 암호문만 남습니다. 이 화면 키가 먼저, 없으면 .env. 카카오맵 · 날씨 키는 맨 아래 각 구역.</div>
      <div className="ad-nt info"><b>예상일은 「(IP) 신청일 + 걸리는 기간」입니다.</b> 지났는데 LIVE 가 아니면 빨갛게 보이고 하루 한 번 운영 알림(외부 연동 예상일 지남)이 남습니다 — 실제로 업체에 신청한 날로 아래 「IP 신청일」(IP 가 필요 없는 연동은 「신청일」)을 고치면 예상일도 바뀝니다.</div>
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
            {/* v10.129 — 키를 다른 구역에서 넣는 연동은 그곳으로 가는 길(AI 는 위험감지 › AI 운영 › AI 에이전트 · 카카오맵 · 날씨는 이 화면 아래) */}
            {(() => {
              const at = KEY_AT[r.code];
              return at && <p className="hint" data-key-goto={r.code}>{at.href
                ? <a href={at.href}>키 넣는 곳으로 가기 — {at.label}</a>
                : <button type="button" className="btn-sm ghost" onClick={() => document.querySelector(at.sel ?? '')?.scrollIntoView({ behavior: 'smooth' })}>키 넣는 곳으로 가기 — {at.label}</button>}</p>;
            })()}

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

              {/* v10.236 — IP 가 필요 없는 연동(전자계약 등)도 업체 신청일을 넣어야 예상일을 셈 — 칸은 모두에게 · 이름만 다름(값은 같은 ip_requested_at) */}
              <label>
                <span>{r.requiresIp ? 'IP 신청일' : '신청일'}</span>
                <input
                  type="date" data-int-requested={r.code}
                  defaultValue={(ymdKst(r.ipRequestedAt) || '')}
                  onChange={(e) => e.target.value
                    && patch(r.code, { ipRequestedAt: e.target.value })}
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

              {/* v10.260 (D205) — 진행표 날짜: IP 가 필요한 연동은 업체 신청일을 따로(IP 신청일과 다를 수 있음) · 키 받은 날 · 시험 성공일 */}
              {r.requiresIp && (
                <label>
                  <span>업체 신청일</span>
                  <input type="date" data-int-applied={r.code} defaultValue={ymdKst(r.appliedAt) || ''}
                    onChange={(e) => e.target.value && patch(r.code, { appliedAt: e.target.value })} />
                </label>
              )}
              <label>
                <span>키 받은 날</span>
                <input type="date" data-int-keyat={r.code} defaultValue={ymdKst(r.keyAt) || ''}
                  onChange={(e) => e.target.value && patch(r.code, { keyAt: e.target.value })} />
              </label>
              <label>
                <span>시험 성공일</span>
                <input type="date" data-int-tested={r.code} defaultValue={ymdKst(r.testedAt) || ''}
                  onChange={(e) => e.target.value && patch(r.code, { testedAt: e.target.value })} />
              </label>

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

      {/* v10.140 (D136 · docs/211) — 메일 준비 상태 · 연결 확인 · 시험 메일 · 발송 기록 */}
      <MailPanel />

      {/* v10.141 (D137) — 본인인증(NICE 표준창) 방식 · 키 · 최근 30일 */}
      <IdentityPanel />

      {/* v10.142 (D138) — 알림톡 방식 · 키 · 템플릿 심의 · 시험 발송 · 보낸 기록 */}
      <AlimtalkPanel />

      {/* v10.143 (D139) — 전자계약 방식 · 키 · 웹훅 주소 · 최근 30일 · 요청 목록 */}
      <EsignPanel />

      {/* v10.144 (D140) — 결제 키 확인 · 1원 계좌인증 시험 · LIVE 근거 */}
      <IntegTestPanel />

      {/* v10.145 (D141) — 050 안심번호 방식 · 키 · 웹훅 주소 · 30일 · 통화 기록 */}
      <SafenumPanel />

      {/* v10.46 (D099 · docs/96) — 카카오맵 키(이 두 키만 화면에서 넣음 · 2026-10-17 대표 결정) */}
      <MapKeys />

      {/* v10.49 (D103 · docs/101) — 메인 「오늘의 날씨」 기상청 키(카카오맵과 같은 방식 · 2026-10-20 계획 승인) */}
      <WeatherKeys />
    </section>
  );
}

import { useState } from 'react';
import { api, ApiFailure, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { ErrorView } from '../../components/ErrorView';
import { won } from '../../lib/format';

interface Overview {
  settings: { payoutGate: string; cpc: number; holdDays: number; minPayout: number; withholdingBp: number; ctrSpikePct: number; dcPrefixes: number };
  publishers: { id: string; name: string; domain: string; domainVerifiedAt: string | null; status: string; shareBp: number; ownerIps: number;
                accountName: string | null; impressions: number; clicks: number; invalid: number }[];
  filters: { rule: string; n: number }[];
  clicks: { total: number; valid: number; held: number; confirmed: number; billed: number };
  ledgerMismatch: number;
  adBilling: { invoices: number; paid: number };
  statements: Statement[];
}
interface Statement {
  id: string; publisherName: string; month: string; confirmedRevenue: number; carriedIn: number; gross: number; withholding: number; net: number;
  status: string; clicks: number; requestedBy: string | null; approvedBy: string | null; paidBy: string | null; paidRef: string | null;
  mineRequested: boolean; mineApproved: boolean;
}
const FILTER: [string, string][] = [
  ['F1', '같은 기기가 같은 광고를 반복 클릭(24시간)'], ['F2', '노출 없는 클릭 (조작)'],
  ['F3', '노출 직후 0.5초 이내 클릭 — 사람이 읽고 누른 시간이 아닙니다'], ['F4', '봇 · 자동화 도구'],
  ['F5', '퍼블리셔 본인 IP 클릭 — 자기 지면 자기가 누르는 것'], ['F6', '데이터센터 · VPN 대역'], ['F7', '비정상 클릭률 급등'],
];
const SST: Record<string, [string, string]> = {
  DRAFT: ['마감 · 신청 전', ''], REQUESTED: ['신청됨', 'wait'], APPROVED: ['승인됨', 'pp'], PAID: ['집행됨', 'ok'], CARRIED: ['이월', ''],
};

/**
 * SB-ADS-PLT-010 광고 플랫폼(외부 송출) · SB-ADS-PAY-010 퍼블리셔 지급 (v10.31 — 시안 adx · payout. 전에는 해당 화면이 없었습니다)
 * 서버: adx_*(D084) — 미검증 도메인 송출 불가 · 무효 클릭 F1~F7 · 보류 7일 · 한 클릭은 한 명세서에만 · 2인 원칙 · 지급 게이트.
 * 시안 1단계의 「에스크로」는 쓰지 않습니다(INV-11 — 플랫폼 에스크로 금지). 광고주 돈은 광고 과금(청구 · 입금)으로 받습니다.
 */
export function Adx({ view, onGo }: { view: 'platform' | 'payout'; onGo?: (tab: string) => void }) {
  const r = useApi<Overview>('/admin/adx/overview');
  const [msg, setMsg] = useState<[boolean, string] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (k: string, path: string, method: string, body: unknown, ok: string | ((x: any) => string)) => {
    setBusy(k); setMsg(null);
    try { const x = await api<any>(path, { method, body: JSON.stringify(body) }); setMsg([true, typeof ok === 'string' ? ok : ok(x)]); r.reload(); }
    catch (e) { setMsg([false, e instanceof ApiFailure ? e.body.message : '처리하지 못했습니다.']); }
    finally { setBusy(null); }
  };
  if (r.error) return <ErrorView error={r.error} onRetry={r.reload} />;
  if (!r.data) return <p className="muted">불러오는 중…</p>;
  const d = r.data;
  const flash = msg && <p className={msg[0] ? 'form-ok' : 'form-error'} role="status">{msg[1]}</p>;
  return view === 'platform'
    ? <Platform d={d} run={run} busy={busy} flash={flash} onGo={onGo} />
    : <Payout d={d} run={run} busy={busy} flash={flash} />;
}

type Run = (k: string, path: string, method: string, body: unknown, ok: string | ((x: any) => string)) => Promise<void>;

function Platform({ d, run, busy, flash, onGo }: { d: Overview; run: Run; busy: string | null; flash: React.ReactNode; onGo?: (t: string) => void }) {
  const [f, setF] = useState({ name: '', domain: '', accountEmail: '', ownerIps: '' });
  const s = d.settings;
  const steps: [string, string, string, string][] = [
    ['1', '광고주 청구 · 입금', '광고주 → 광고 과금(우리가 받는 돈)', `청구 ${d.adBilling.invoices}건 · 입금 ${won(d.adBilling.paid)} — 에스크로 없음(INV-11)`],
    ['2', '송출 · 노출', '퍼블리셔 지면', `미검증 도메인 송출 불가 — 확인된 곳 ${d.publishers.filter((p) => p.domainVerifiedAt).length} / ${d.publishers.length}`],
    ['3', '클릭 · 과금', `CPC ${won(s.cpc)}`, `무효 클릭 필터 F1~F7 — 30일 무효 ${d.clicks.total - d.clicks.valid}건`],
    ['4', `${s.holdDays}일 보류`, '무효 클릭 걸러내기', `확정 전 지급 불가 — 보류 중 ${d.clicks.held}건`],
    ['5', '확정 · 분배', '퍼블리셔 70 : 플랫폼 30(퍼블리셔별 비율)', `원장 불일치 시 지급 차단 — 불일치 ${d.ledgerMismatch}건`],
    ['6', '월 마감 · 명세서', `이월(최소 ${won(s.minPayout)}) · 원천징수 ${(s.withholdingBp / 100).toFixed(1)}%`, '한 클릭은 한 명세서에만 (기본키)'],
    ['7', '신청 → 승인 → 집행', '2인 원칙', '신청자 ≠ 승인자 ≠ 집행자 · 게이트'],
  ];
  return (
    <>
      {/* v10.32 — 시안 scAdx: 위 안내 띠 노랑 · 지급 게이트 띠 빨강(닫힘) */}
      <div className="ad-nt warn">
        <b>내부 지면(ad_*)과 성격이 달라 접두를 adx_ 로 갈랐습니다.</b> ad_* — 내부 지면 · 기간 예약 · 정액 · 관에 묶임 / adx_* — 외부 송출 · 클릭 과금 · 수익배분 · 관 밖.
      </div>
      {flash}
      <h2 className="ad-s2">돈이 도는 길</h2>
      <div className="ad-tw"><table className="tbl" data-adx-path>
        <thead><tr><th>단계</th><th>무엇</th><th>누가</th><th>막는 장치 · 지금</th></tr></thead>
        <tbody>{steps.map((x) => <tr key={x[0]}><td className="num-cell">{x[0]}</td><td><b>{x[1]}</b></td><td>{x[2]}</td><td>{x[3]}</td></tr>)}</tbody>
      </table></div>
      <div className={`ad-nt ${s.payoutGate === 'open' ? 'info' : 'bad'}`} data-adx-gate={s.payoutGate}>
        <b>지급 게이트는 {s.payoutGate === 'open' ? '열려 있습니다' : '닫혀 있습니다'}.</b> 설정 adx.payout_gate = {s.payoutGate} —
        전자금융업 등록을 확인하기 전에는 돈이 나가지 않습니다. 명세서는 만들어지고 승인까지 되지만 집행에서 멈춥니다.
      </div>

      <h2 className="ad-s2">무효 클릭 필터</h2>
      <div className="ad-tw"><table className="tbl" data-adx-filters>
        <thead><tr><th>필터</th><th>무엇을 거르나</th><th className="num-cell">최근 30일</th></tr></thead>
        <tbody>{FILTER.map(([k, t]) => <tr key={k}><td className="mono"><b>{k}</b></td><td>{t}</td>
          <td className="num-cell">{d.filters.find((x) => x.rule === k)?.n ?? 0}</td></tr>)}</tbody>
      </table></div>
      <div className="ad-nt info">
        클릭 30일 {d.clicks.total}건 · 유효 {d.clicks.valid} · 확정 {d.clicks.confirmed} · 보류 {d.clicks.held} · 과금 {won(d.clicks.billed)}.
        F6 데이터센터 대역 {s.dcPrefixes}개 · F7 기준 클릭률 {s.ctrSpikePct}% — 설정(법정 고지 › 그 밖의 설정)에서 바꿉니다.
        <button className="linkbtn" style={{ marginLeft: 6 }} disabled={busy === 'confirm'}
                onClick={() => run('confirm', '/admin/adx/confirm', 'POST', {}, (x) => `보류가 지난 유효 클릭 ${x.confirmed}건을 확정했습니다.`)}>보류 지난 클릭 확정</button>
      </div>

      <h2 className="ad-s2">퍼블리셔 <em>{d.publishers.length}</em></h2>
      <div className="ad-tw"><table className="tbl" data-adx-publishers>
        <thead><tr><th>퍼블리셔</th><th>도메인</th><th>상태</th><th className="num-cell">노출 / 클릭 (30일)</th><th className="num-cell">무효</th><th>몫</th><th /></tr></thead>
        <tbody>
          {d.publishers.length === 0 && <tr><td colSpan={7} className="muted">등록된 퍼블리셔가 없습니다 — 아래에서 등록하면 도메인 확인 뒤 송출됩니다.</td></tr>}
          {d.publishers.map((p) => (
            <tr key={p.id}>
              <td><b>{p.name}</b>{p.accountName && <span className="ad-ls">담당 {p.accountName}</span>}</td>
              <td className="mono">{p.domain} {p.domainVerifiedAt ? <span className="ad-bg ok">확인됨</span> : <span className="ad-bg wait">미확인 — 송출 불가</span>}</td>
              <td><span className={`ad-bg ${p.status === 'ACTIVE' ? 'ok' : p.status === 'HOLD' ? 'wait' : ''}`}>{p.status === 'ACTIVE' ? '운영' : p.status === 'HOLD' ? '보류' : '종료'}</span></td>
              <td className="num-cell">{p.impressions.toLocaleString('ko-KR')} / {p.clicks.toLocaleString('ko-KR')}</td>
              <td className="num-cell">{p.invalid}</td>
              <td>{p.shareBp / 100}%</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {!p.domainVerifiedAt && <button className="btn-ok btn-sm" disabled={busy === p.id}
                  onClick={() => run(p.id, `/admin/adx/publishers/${p.id}`, 'PATCH', { verifyDomain: true }, `${p.domain} 도메인을 확인했습니다 — 송출이 열립니다.`)}>도메인 확인</button>}
                {p.status === 'ACTIVE'
                  ? <button className="btn-plain btn-sm" disabled={busy === p.id} style={{ marginLeft: 6 }}
                      onClick={() => run(p.id, `/admin/adx/publishers/${p.id}`, 'PATCH', { status: 'HOLD' }, `${p.name} 보류 — 송출 · 지급 신청이 멈춥니다.`)}>보류</button>
                  : <button className="btn-plain btn-sm" disabled={busy === p.id} style={{ marginLeft: 6 }}
                      onClick={() => run(p.id, `/admin/adx/publishers/${p.id}`, 'PATCH', { status: 'ACTIVE' }, `${p.name} 운영으로 되돌렸습니다.`)}>운영</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <div className="ad-panel" data-adx-new>
        <h3>퍼블리셔 등록 <small>도메인 확인 전에는 송출되지 않습니다</small></h3>
        <div className="ad-form">
          <label htmlFor="adx-n">이름</label><input id="adx-n" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="예: 창업노트 블로그" />
          <label htmlFor="adx-d">도메인</label><input id="adx-d" value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value })} placeholder="blog.example.com" />
          <label htmlFor="adx-a">담당 회원 이메일 (선택)</label><input id="adx-a" value={f.accountEmail} onChange={(e) => setF({ ...f, accountEmail: e.target.value })} />
          <label htmlFor="adx-i">본인 IP (F5 · 쉼표)</label><input id="adx-i" value={f.ownerIps} onChange={(e) => setF({ ...f, ownerIps: e.target.value })} placeholder="203.0.113.0/24" />
        </div>
        <button className="btn-ok" disabled={!f.name.trim() || !f.domain.trim() || busy === 'new'}
                onClick={() => run('new', '/admin/adx/publishers', 'POST',
                  { name: f.name, domain: f.domain, accountEmail: f.accountEmail || undefined, ownerIps: f.ownerIps.split(',').map((x) => x.trim()).filter(Boolean) },
                  `${f.name} 를 등록했습니다 — 도메인을 확인하면 송출됩니다.`).then(() => setF({ name: '', domain: '', accountEmail: '', ownerIps: '' }))}>등록</button>
      </div>
      {onGo && <div className="ad-dact"><button className="btn-plain" onClick={() => onGo('adx-payout')}>퍼블리셔 지급으로</button><button className="btn-plain" onClick={() => onGo('ad-billing')}>광고 과금으로</button></div>}
    </>
  );
}

function Payout({ d, run, busy, flash }: { d: Overview; run: Run; busy: string | null; flash: React.ReactNode }) {
  const roles = tokenRoles();
  /* 2026-10-21 결정 — SUPER 는 신청 · 승인 · 집행 모두. 같은 건을 혼자 다 하지는 못합니다(DB 2인 원칙) */
  const isOps = roles.includes('ADMIN') || roles.includes('SUPER'), isPay = roles.includes('PAYOUT') || roles.includes('SUPER');
  const s = d.settings;
  const [month, setMonth] = useState(() => { const t = new Date(); t.setMonth(t.getMonth() - 1); return t.toISOString().slice(0, 7); });
  const [ref, setRef] = useState<Record<string, string>>({});
  return (
    <>
      {/* v10.32 — 시안 scPayout: 맨 위 빨간 「지급 게이트 닫힘」 띠(10/10 결정 — 실제 지급은 닫아 둠 · 값은 설정 adx.payout_gate 그대로 읽음) */}
      {s.payoutGate === 'open'
        ? <div className="ad-nt info" data-payout-gate="open"><b>지급 게이트 열림.</b> 승인된 명세서를 지급 담당이 집행할 수 있습니다.</div>
        : <div className="ad-nt bad" data-payout-gate={s.payoutGate}>
            <b>실제 지급은 닫아 두었습니다(지급 게이트 닫힘).</b> 월 마감 정산서와 장부(원장)까지만 만듭니다.
            광고주 돈을 받아 퍼블리셔에게 나눠 주는 일은 자금 수탁(INV-11) · 전자금융 검토가 끝난 뒤에 엽니다 — 그 전에는 「집행」이 막힙니다.
          </div>}
      {flash}
      <h2 className="ad-s2">2인 원칙</h2>
      <div className="ad-tw"><table className="tbl" data-payout-roles>
        <thead><tr><th>단계</th><th>누가</th><th>막는 것</th></tr></thead>
        <tbody>
          <tr><td><b>신청</b></td><td>퍼블리셔 담당 또는 운영</td><td>보류 중이면 신청 불가</td></tr>
          <tr><td><b>승인</b></td><td>신청한 사람이 아닌 운영(ADMIN · SUPER)</td><td>자기가 신청한 것을 자기가 승인 불가</td></tr>
          <tr><td><b>집행</b></td><td>승인 · 신청한 사람이 아닌 지급 담당(PAYOUT)</td><td>승인 상태가 아니면 집행 불가 · 게이트가 닫히면 집행 불가 · 원장 불일치면 집행 불가</td></tr>
        </tbody>
      </table></div>
      <h2 className="ad-s2">금액 계산</h2>
      <div className="ad-tw"><table className="tbl" data-payout-calc>
        <thead><tr><th>항목</th><th>내용</th></tr></thead>
        <tbody>
          <tr><td><b>확정 수익</b></td><td>보류 {s.holdDays}일을 지나 확정된 유효 클릭의 퍼블리셔 몫(퍼블리셔별 비율 · 기본 70%)</td></tr>
          <tr><td><b>이월</b></td><td>최소 지급액({won(s.minPayout)}) 미달이면 다음 달로 넘깁니다</td></tr>
          <tr><td><b>총액</b></td><td>확정 수익 + 이월</td></tr>
          <tr><td><b>원천징수</b></td><td>{(s.withholdingBp / 100).toFixed(1)}% (소득세 3% + 지방소득세 0.3%) — 예수금 계정으로 따로 뺍니다</td></tr>
          <tr><td><b>실지급</b></td><td>총액 − 원천징수</td></tr>
        </tbody>
      </table></div>
      {/* v10.32 — 원천징수 띠 파랑(시안) · 아래 노란 게이트 띠는 맨 위 빨간 띠로 옮김 */}
      <div className="ad-nt info"><b>원천징수액은 우리 돈이 아닙니다.</b> 별도 예수금 계정(ACC-TAX)으로 옮겨 두고, 신고 때 그대로 납부합니다. 운영 자금과 섞이면 나중에 못 맞춥니다.</div>

      {isOps && (
        <div className="ad-dact" data-payout-close>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="마감할 달" />
          <button className="btn-ok" disabled={busy === 'close'} onClick={() => run('close', '/admin/adx/close-month', 'POST', { month }, (x) => x.note)}>월 마감 → 명세서</button>
        </div>
      )}
      <h2 className="ad-s2">명세서 <em>{d.statements.length}</em></h2>
      <div className="ad-tw"><table className="tbl" data-payout-statements>
        <thead><tr><th>달</th><th>퍼블리셔</th><th className="num-cell">확정 수익</th><th className="num-cell">이월</th><th className="num-cell">원천징수</th><th className="num-cell">실지급</th><th>상태</th><th /></tr></thead>
        <tbody>
          {d.statements.length === 0 && <tr><td colSpan={8} className="muted">명세서가 없습니다 — 확정된 클릭이 있는 달을 마감하면 생깁니다.</td></tr>}
          {d.statements.map((x) => {
            const st = SST[x.status] ?? [x.status, ''];
            return (
              <tr key={x.id} data-stmt={x.id}>
                <td className="mono">{x.month}</td><td><b>{x.publisherName}</b><span className="ad-ls">클릭 {x.clicks}건</span></td>
                <td className="num-cell">{won(x.confirmedRevenue)}</td><td className="num-cell">{won(x.carriedIn)}</td>
                <td className="num-cell">{won(x.withholding)}</td><td className="num-cell money-cell">{won(x.net)}</td>
                <td><span className={`ad-bg ${st[1]}`}>{st[0]}</span>
                  <span className="ad-ls">{[x.requestedBy && `신청 ${x.requestedBy}`, x.approvedBy && `승인 ${x.approvedBy}`, x.paidBy && `집행 ${x.paidBy} · ${x.paidRef}`].filter(Boolean).join(' · ')}</span></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {x.status === 'DRAFT' && isOps && <button className="btn-plain btn-sm" disabled={busy === x.id}
                    onClick={() => run(x.id, `/admin/adx/statements/${x.id}`, 'PATCH', { action: 'REQUEST' }, '지급을 신청했습니다 — 다른 운영자가 승인합니다.')}>신청</button>}
                  {x.status === 'REQUESTED' && isOps && <button className="btn-ok btn-sm" disabled={busy === x.id || x.mineRequested}
                    title={x.mineRequested ? '자기가 신청한 것은 승인할 수 없습니다' : undefined}
                    onClick={() => run(x.id, `/admin/adx/statements/${x.id}`, 'PATCH', { action: 'APPROVE' }, '승인했습니다 — 지급 담당이 집행합니다.')}>승인</button>}
                  {x.status === 'APPROVED' && isPay && (
                    <span style={{ display: 'flex', gap: 6 }}>
                      <input value={ref[x.id] ?? ''} placeholder="이체 참조" aria-label="이체 참조" onChange={(e) => setRef((r) => ({ ...r, [x.id]: e.target.value }))} />
                      <button className="btn-ok btn-sm" disabled={busy === x.id || !(ref[x.id] ?? '').trim()}
                        onClick={() => run(x.id, `/admin/adx/statements/${x.id}`, 'PATCH', { action: 'PAY', paidRef: ref[x.id] }, '집행을 기록했습니다.')}>집행</button>
                    </span>
                  )}
                  {x.status === 'APPROVED' && !isPay && <span className="dim">집행은 지급 담당이 합니다</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
    </>
  );
}

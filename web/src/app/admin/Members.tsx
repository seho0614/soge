import { useEffect, useState } from 'react';
import { api, ApiFailure, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { ymd, ymdhm } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { SubTabs, type SubTab } from '../../components/SubTabs';

interface Row {
  id: string; email: string; name: string; phone: string | null;
  accountType: string; status: string; identityVerified: boolean;
  companyName: string | null; bizVerified: boolean;
  createdAt: string; lastLoginAt: string | null;
}
interface Detail {
  ok: boolean; note: string | null;
  account?: {
    id: string; email: string; name: string; phone: string | null; accountType: string; status: string;
    identityVerifiedAt: string | null; createdAt: string; lastLoginAt: string | null; withdrawnAt: string | null;
  };
  business?: {
    bizRegNo: string; companyName: string; ceoName: string; ntsStatus: string | null;
    verifiedAt: string | null; rejectReason: string | null;
  } | null;
  roles?: string[];
  listings?: Array<{ id: string; title: string; status: string; statusLabel?: string; createdAt: string }>;
  deals?: Array<{ id: string; status: string; statusLabel?: string; createdAt: string; side: string }>;
  listingCount?: number; dealCount?: number;
  statusLog?: Array<{ from: string; to: string; reason: string; at: string; by: string | null }>;
  postingSuspension?: { until: string; reason: string } | null;
  reports?: { reported: number | string; reportedAgainst: number | string };
}

const TYPE: Record<string, string> = { INDIVIDUAL: '개인', BUSINESS: '사업자' };
const AST: Record<string, string> = { ACTIVE: '정상', SUSPENDED: '정지', WITHDRAWN: '탈퇴', DORMANT: '휴면' };

type View = 'list' | 'detail';

/**
 * SB-ADM-MBR-010 회원 목록
 * SB-ADM-MBR-020 회원 상세
 *
 * 이것이 없으면 운영이 **신고를 받아도 누구인지 못 봅니다.**
 * 목록 조회와 상세 조회는 **둘 다 감사 로그에 남습니다**(개인정보 보호법 29조) —
 * 그래서 타이핑할 때마다 부르지 않고 '찾기'를 눌렀을 때만 부릅니다.
 *
 * v10.31 (10/10 결함 · 시안 kim****@ · 010-****-2280) — 이메일 · 연락처 · 사업자번호는 서버가 가려서 보냅니다.
 * 시안 회원 상세의 「상태 변경」(정상 ↔ 정지 · 사유 필수 · 기록)을 더했습니다.
 */
export function Members() {
  const [view, setView] = useState<View>('list');
  const [id, setId] = useState<string | null>(null);
  const tabs: SubTab<View>[] = [
    { key: 'list', label: '회원 목록', screen: 'SB-ADM-MBR-010' },
    { key: 'detail', label: '회원 상세', screen: 'SB-ADM-MBR-020' },
  ];
  return (
    <section>
      <SubTabs tabs={tabs} value={view} onChange={setView} />
      {view === 'list' && <MemberList onOpen={(x) => { setId(x); setView('detail'); }} />}
      {view === 'detail' && <MemberDetail id={id} onBack={() => setView('list')} />}
    </section>
  );
}

function MemberList({ onOpen }: { onOpen: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [path, setPath] = useState('/admin/accounts?limit=50');
  const list = useApi<Row[]>(path);

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    const t = q.trim();
    setPath(t ? `/admin/accounts?q=${encodeURIComponent(t)}&limit=50` : '/admin/accounts?limit=50');
  };

  return (
    <>
      <form className="search-row" onSubmit={search}>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름 · 이메일 · 연락처" aria-label="회원 검색" />
        <button className="btn-ok" type="submit">찾기</button>
      </form>
      <div className="ad-nt info"><b>탈퇴 회원은 기본으로 빼고 보여 줍니다.</b> 보관 기간이 지나면 개인정보가 지워집니다.</div>
      {list.error ? <ErrorView error={list.error} onRetry={list.reload} /> : null}
      {list.loading && !list.data && <p className="muted">불러오는 중…</p>}
      {list.data && list.data.length === 0 && <p className="muted">찾는 회원이 없습니다.</p>}
      {(list.data ?? []).length > 0 && (
        <div className="ad-tw"><table className="tbl" data-member-list>
          <thead><tr><th>이름</th><th>이메일</th><th>유형</th><th>본인인증</th><th>사업자</th><th>상태</th><th>가입</th></tr></thead>
          <tbody>
            {(list.data ?? []).map((m) => (
              <tr key={m.id}>
                <td><button className="linkbtn" onClick={() => onOpen(m.id)}>{m.name || '(이름 없음)'}</button></td>
                <td className="mono">{m.email}</td>
                <td>{TYPE[m.accountType] ?? m.accountType}</td>
                <td>{m.identityVerified ? <span className="st ok">완료</span> : <span className="muted">미인증</span>}</td>
                <td>{m.companyName ? <>{m.companyName} {m.bizVerified ? <span className="st ok">인증</span> : <span className="muted">대기</span>}</> : <span className="dim">—</span>}</td>
                <td>{AST[m.status] ?? m.status}</td>
                <td className="muted">{ymd(m.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </>
  );
}

function MemberDetail({ id, onBack }: { id: string | null; onBack: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const load = () => {
    if (!id) return;
    setErr(null); setD(null);
    api<Detail>(`/admin/accounts/${id}`).then(setD).catch(setErr);
  };
  useEffect(load, [id]);

  if (!id) {
    return (
      <>
        <h2>회원 상세</h2>
        <p className="muted">선택된 회원이 없습니다. 목록에서 이름을 눌러 주십시오.</p>
        <button className="btn-ok" onClick={onBack}>목록으로</button>
      </>
    );
  }
  if (err) return <ErrorView error={err} onRetry={load} />;
  if (!d) return <p className="muted">불러오는 중…</p>;
  if (d.ok === false || !d.account) {
    return <><p className="card warn">{d.note ?? '없는 회원입니다.'}</p><button className="btn-plain" onClick={onBack}>목록으로</button></>;
  }
  const a = d.account;
  const listings = d.listings ?? [], deals = d.deals ?? [];
  const latest = <T extends { createdAt: string },>(xs: T[], f: (x: T) => string) => (xs[0] ? `${ymd(xs[0].createdAt)} ${f(xs[0])}` : '—');

  return (
    <>
      <div className="ad-nt warn">
        <b>이 화면을 여신 기록이 남습니다.</b> 누가 언제 누구를 보았는지 감사 로그에 기록됩니다 (개인정보 보호법 29조).
      </div>
      <div className="ad-tw">
        <table className="tbl" data-member-detail>
          <thead><tr><th style={{ width: 200 }}>항목</th><th>내용</th></tr></thead>
          <tbody>
            <tr><td><b>이름</b></td><td>{a.name}</td></tr>
            <tr><td><b>이메일</b></td><td className="mono">{a.email}</td></tr>
            <tr><td><b>연락처</b></td><td className="mono">{a.phone ?? '—'}</td></tr>
            <tr><td><b>유형</b></td><td>{TYPE[a.accountType] ?? a.accountType} {a.identityVerifiedAt
              ? <span className="ad-bg ok">본인인증 완료</span> : <span className="ad-bg">본인인증 전</span>}</td></tr>
            <tr><td><b>상태</b></td><td data-member-status={a.status}>
              <span className={`ad-bg ${a.status === 'ACTIVE' ? 'ok' : 'no'}`}>{AST[a.status] ?? a.status}</span>
              {a.withdrawnAt && ` · 탈퇴 ${ymd(a.withdrawnAt)}`}
              {d.postingSuspension && <> <span className="ad-bg wait">등록 정지 ~ {ymdhm(d.postingSuspension.until)}</span></>}
            </td></tr>
            <tr><td><b>가입</b></td><td>{ymd(a.createdAt)} · 최근 로그인 {ymdhm(a.lastLoginAt)}</td></tr>
            <tr><td><b>권한</b></td><td className="mono">{(d.roles ?? []).join(' · ') || '—'}</td></tr>
          </tbody>
        </table>
      </div>

      <h3 className="ad-s2">사업자</h3>
      {d.business ? (
        <div className="ad-tw">
          <table className="tbl">
            <thead><tr><th style={{ width: 200 }}>항목</th><th>내용</th></tr></thead>
            <tbody>
              <tr><td><b>상호</b></td><td>{d.business.companyName}</td></tr>
              <tr><td><b>사업자등록번호</b></td><td className="mono">{d.business.bizRegNo}</td></tr>
              <tr><td><b>국세청</b></td><td>{d.business.ntsStatus === 'VALID' ? '계속사업자 확인' : d.business.ntsStatus ?? <span className="muted">조회 미연동</span>}</td></tr>
              <tr><td><b>인증</b></td><td>{d.business.verifiedAt ? <span className="ad-bg ok">승인 {ymd(d.business.verifiedAt)}</span>
                : d.business.rejectReason ? <span className="ad-bg no">반려 — {d.business.rejectReason}</span> : <span className="ad-bg wait">대기</span>}</td></tr>
            </tbody>
          </table>
        </div>
      ) : <p className="ad-empty">사업자 정보가 없습니다.</p>}

      <h3 className="ad-s2">등록 · 거래</h3>
      <div className="ad-tw">
        <table className="tbl" data-member-activity>
          <thead><tr><th>구분</th><th>건</th><th>최근</th></tr></thead>
          <tbody>
            <tr><td><b>등록</b></td><td className="num-cell">{d.listingCount ?? listings.length}건</td><td>{latest(listings, (x) => x.title)}</td></tr>
            <tr><td><b>거래</b></td><td className="num-cell">{d.dealCount ?? deals.length}건</td><td>{latest(deals, (x) => `${x.side} · ${x.statusLabel ?? x.status}`)}</td></tr>
          </tbody>
        </table>
      </div>
      {(listings.length > 0 || deals.length > 0) && (
        <details className="ad-alert" style={{ marginTop: 6 }}>
          <summary><b>최근 10건 펼쳐 보기</b><span /><span className="dim">등록 {listings.length} · 거래 {deals.length}</span><span /></summary>
          <div className="bd">
            {listings.map((l) => <div key={l.id}>등록 · {ymd(l.createdAt)} · {l.title} · {l.statusLabel ?? l.status}</div>)}
            {deals.map((x) => <div key={x.id}>거래 · {ymd(x.createdAt)} · <span className="mono">{x.id.slice(0, 8)}</span> · {x.side} · {x.statusLabel ?? x.status}</div>)}
          </div>
        </details>
      )}

      <h3 className="ad-s2">신고</h3>
      <div className="ad-tw">
        <table className="tbl">
          <thead><tr><th>구분</th><th>건수</th></tr></thead>
          <tbody>
            <tr><td><b>이 회원이 신고한 것</b></td><td className="num-cell">{d.reports?.reported ?? 0}건</td></tr>
            <tr><td><b>이 회원이 신고당한 것</b></td><td className="num-cell">{d.reports?.reportedAgainst ?? 0}건</td></tr>
          </tbody>
        </table>
      </div>
      <div className="ad-nt info"><b>양쪽을 함께 봅니다.</b> 한쪽만 보면 &ldquo;상습 신고자&rdquo;인지 &ldquo;상습 피신고자&rdquo;인지 알 수 없습니다.</div>

      {(d.statusLog ?? []).length > 0 && (
        <>
          <h3 className="ad-s2">상태 변경 기록</h3>
          <div className="ad-tw">
            <table className="tbl"><thead><tr><th>일시</th><th>변경</th><th>사유</th><th>누가</th></tr></thead>
              <tbody>{d.statusLog!.map((x, i) => (
                <tr key={i}><td>{ymdhm(x.at)}</td><td>{AST[x.from] ?? x.from} → {AST[x.to] ?? x.to}</td><td>{x.reason}</td><td>{x.by ?? '—'}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}

      <LoginLock id={a.id} />
      {tokenRoles().includes('SUPER') && <ResetLink id={a.id} />}

      <StatusChange id={a.id} status={a.status} suspended={!!d.postingSuspension} onDone={load} onBack={onBack} />
    </>
  );
}

/** 시안 「상태 변경 · 목록으로」 — 누르면 정상/정지 고르기 + 사유 칸이 열립니다 */
function StatusChange({ id, status, suspended, onDone, onBack }: { id: string; status: string; suspended: boolean; onDone: () => void; onBack: () => void }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<[boolean, string] | null>(null);
  const [busy, setBusy] = useState(false);
  const run = (path: string, body: unknown, ok: string) => {
    setBusy(true); setMsg(null);
    api(path, { method: 'PATCH', body: JSON.stringify(body) })
      .then(() => { setMsg([true, ok]); setOpen(false); setReason(''); onDone(); })
      .catch((e) => setMsg([false, e instanceof ApiFailure ? e.body.message : '바꾸지 못했습니다.']))
      .finally(() => setBusy(false));
  };
  return (
    <>
      {msg && <p className={msg[0] ? 'form-ok' : 'form-error'} role="status">{msg[1]}</p>}
      {open && status !== 'WITHDRAWN' && (
        <div className="ad-panel" data-status-form>
          <h3>상태 변경 <small>사유가 기록에 남습니다 — 지울 수 없습니다</small></h3>
          <fieldset style={{ border: 0, padding: 0, margin: '0 0 8px' }} aria-label="바꿀 상태">
            <label><input type="radio" name="to" checked={to === 'ACTIVE'} disabled={status === 'ACTIVE'} onChange={() => setTo('ACTIVE')} /> 정상</label>{' '}
            <label><input type="radio" name="to" checked={to === 'SUSPENDED'} disabled={status === 'SUSPENDED'} onChange={() => setTo('SUSPENDED')} /> 정지 — 로그인이 막히고 소개코드가 멈춥니다</label>
          </fieldset>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유 (예: 허위 매물 반복 등록 — 신고 3건 확인)" style={{ width: '100%' }} aria-label="상태 변경 사유" />
          <div className="ad-dact">
            <button className="btn-ok" disabled={busy || reason.trim().length < 2 || to === status}
                    onClick={() => run(`/admin/accounts/${id}/status`, { status: to, reason }, to === 'SUSPENDED' ? '정지했습니다.' : '정상으로 되돌렸습니다.')}>
              {to === 'SUSPENDED' ? '정지' : '정상으로'}
            </button>
            <button className="btn-plain" onClick={() => setOpen(false)}>닫기</button>
          </div>
        </div>
      )}
      <div className="ad-dact">
        {status !== 'WITHDRAWN' && <button className="btn-ok" onClick={() => setOpen((o) => !o)} data-status-open>상태 변경</button>}
        {suspended && <button className="btn-plain" disabled={busy}
                              onClick={() => run(`/admin/accounts/${id}/posting-suspension/lift`, {}, '등록 정지를 풀었습니다.')}>등록 정지 풀기</button>}
        <button className="btn-plain" onClick={onBack}>목록으로</button>
      </div>
    </>
  );
}

/**
 * v10.48 (D102) — 로그인 잠금. 같은 이메일로 5번 연속 틀리면 30분 잠깁니다(저절로 풀림).
 *   고객센터에서 본인 확인을 마친 뒤에만 「잠금 풀기」를 누릅니다 — 감사 기록 LOGIN_UNLOCK.
 */
type LockState = { locked: boolean; lockedUntil: string | null; recentFails: number; lastFailAt: string | null };
function LoginLock({ id }: { id: string }) {
  const [st, setSt] = useState<LockState | null>(null);
  const [msg, setMsg] = useState<[boolean, string] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => { api<LockState>(`/admin/accounts/${id}/login-lock`).then(setSt).catch(() => setSt(null)); };
  useEffect(load, [id]);
  const unlock = () => {
    setBusy(true); setMsg(null);
    api(`/admin/accounts/${id}/login-lock`, { method: 'DELETE' })
      .then(() => { setMsg([true, '로그인 잠금을 풀었습니다.']); load(); })
      .catch((e) => setMsg([false, e instanceof ApiFailure ? e.body.message : '풀지 못했습니다.']))
      .finally(() => setBusy(false));
  };
  if (!st) return null;
  return (
    <>
      <h3 className="ad-s2">로그인 잠금</h3>
      <div className="ad-tw">
        <table className="tbl" data-login-lock={st.locked ? 'locked' : 'open'}>
          <thead><tr><th style={{ width: 200 }}>항목</th><th>내용</th></tr></thead>
          <tbody>
            <tr><td><b>상태</b></td><td>{st.locked
              ? <span className="ad-bg no">잠김 ~ {ymdhm(st.lockedUntil)}</span>
              : <span className="ad-bg ok">잠기지 않음</span>}</td></tr>
            <tr><td><b>최근 연속 실패</b></td><td>{st.locked ? '—' : `${st.recentFails}번`}{st.lastFailAt && ` · 마지막 ${ymdhm(st.lastFailAt)}`}</td></tr>
          </tbody>
        </table>
      </div>
      {msg && <p className={msg[0] ? 'form-ok' : 'form-error'} role="status">{msg[1]}</p>}
      {st.locked && (
        <div className="ad-dact">
          <button className="btn-plain" disabled={busy} onClick={unlock} data-login-unlock>잠금 풀기</button>
          <span className="muted">본인 확인을 마친 뒤에만 푸십시오. 30분이 지나면 저절로 풀립니다.</span>
        </div>
      )}
    </>
  );
}

/**
 * v10.147 — 비밀번호 재설정 링크(SUPER). 메일 발송 준비 전, 고객센터에서 본인 확인을 마친 회원에게 직접 전달합니다.
 *   30분 · 1번 · 새로 만들면 앞 링크 무효 · 운영진 계정은 서버가 막음 · 감사 기록 PASSWORD_RESET_LINK(까닭만)
 *   링크는 이 화면에만 한 번 보입니다(다시 볼 수 없음).
 */
function ResetLink({ id }: { id: string }) {
  const [reason, setReason] = useState('');
  const [link, setLink] = useState<{ url: string; note: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const make = () => {
    if (!confirm('본인 확인을 마쳤습니까? 앞서 만든 재설정 링크는 쓸 수 없게 됩니다.')) return;
    setBusy(true); setMsg(null); setLink(null);
    api<{ url: string; note: string }>(`/admin/accounts/${id}/password-reset-link`, { method: 'POST', body: JSON.stringify({ reason }) })
      .then((r) => { setLink(r); setReason(''); })
      .catch((e) => setMsg(e instanceof ApiFailure ? e.body.message : '만들지 못했습니다.'))
      .finally(() => setBusy(false));
  };
  return (
    <>
      <h3 className="ad-s2">비밀번호 재설정 링크</h3>
      <p className="muted">메일 발송 준비 전에 고객센터에서 씁니다. <b>본인 확인을 마친 회원</b>에게만 전화 · 문의 답변으로 직접 전달하십시오. 30분 · 한 번만 쓸 수 있습니다.</p>
      <div className="ad-dact" data-reset-link-form>
        <input style={{ minWidth: 360 }} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)}
               placeholder="본인 확인 방법과 까닭(예: 문의 #123 · 가입 휴대폰 뒤 4자리 확인)" />
        <button className="btn-plain" disabled={busy || reason.trim().length < 5} onClick={make} data-reset-link-make>링크 만들기</button>
      </div>
      {msg && <p className="form-error" role="alert">{msg}</p>}
      {link && (
        <div className="ad-tw" data-reset-link>
          <p className="form-ok" role="status">{link.note}</p>
          <code style={{ wordBreak: 'break-all' }}>{link.url}</code>
        </div>
      )}
    </>
  );
}

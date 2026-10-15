import { useEffect, useState } from 'react';
import { api, ApiFailure } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { ErrorView } from '../../components/ErrorView';
import { Pills } from '../../components/Pills';

interface Biz {
  id: string; accountId: string; companyName: string; ceoName: string;
  bizRegNo: string; ntsStatus: string | null; verifiedAt: string | null;
  accountName?: string; createdAt?: string;
  /* v10.31 — 반려 · 회원 상태 · 요금제 · 표시 번호(서버가 사업자번호 · 대표 이름을 가려서 보냄) */
  accountStatus?: string; rejectedAt?: string | null; rejectReason?: string | null; planCode?: string | null; no?: string;
}
type St = 'wait' | 'active' | 'suspended' | 'rejected' | 'all';

/**
 * SB-ADM-USR-010 회원 관리 · 사업자 인증
 *
 * 승인 시각이 소개비 수령 자격의 기준일입니다 (INV-10).
 * 자동 승인하지 않습니다 — 법적 판단이 섞여 있습니다.
 *
 * v10.31 (10/10 시안 기준 · scAdmUsr) — 탭 「승인 대기 · 정상 · 정지」, 「이름 · 이메일로 찾기」(회원 목록으로),
 * 신청 줄(상호 · 번호 · 사업자 128-86-***12 · 대표 김** · 신청일 / 요금제 · 국세청 / 반려 · 승인).
 * 새 서버 기능 — 사업자 신청 반려(사유) · 회원 정지 · 정지 해제(사유 · 기록). 「반려」 · 「전체」 탭은 개발에만.
 */
export function Users({ onGo }: { onGo?: (tab: string) => void }) {
  const [q, setQ] = useState('');
  const [path, setPath] = useState('/admin/businesses');
  const { data, error, loading, reload } = useApi<Biz[]>(path);
  const counts = useApi<{ active: number; suspended: number }>('/admin/accounts-counts');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [st, setSt] = useState<St>('wait');
  const [why, setWhy] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => { const t = setTimeout(() => setPath(q.trim() ? `/admin/businesses?q=${encodeURIComponent(q.trim())}` : '/admin/businesses'), 300); return () => clearTimeout(t); }, [q]);

  async function act(id: string, url: string, body: unknown, done: string) {
    setBusy(id); setErr(null); setOk(null);
    try {
      await api(url, { method: 'PATCH', body: JSON.stringify(body) });
      setOk(done); setOpen(null); reload(); counts.reload();
    } catch (e) {
      setErr(e instanceof ApiFailure ? e.body.message : '처리하지 못했습니다.');
    } finally { setBusy(null); }
  }
  const verify = (b: Biz) => act(b.id, `/admin/businesses/${b.id}/verify`, {}, `${b.companyName} — 승인했습니다. 승인 시각이 소개비 수령 자격의 기준일입니다.`);

  if (error) return <ErrorView error={error} />;
  if (loading || !data) return <p className="muted">불러오는 중…</p>;

  const waiting = data.filter((b) => !b.verifiedAt && !b.rejectedAt);
  const rejected = data.filter((b) => b.rejectedAt && !b.verifiedAt);
  const active = data.filter((b) => b.verifiedAt && b.accountStatus !== 'SUSPENDED');
  const suspended = data.filter((b) => b.accountStatus === 'SUSPENDED');
  const list = st === 'wait' ? waiting : st === 'active' ? active : st === 'suspended' ? suspended : st === 'rejected' ? rejected : data;
  const ymd = (s?: string | null) => (s ? new Date(s).toLocaleDateString('ko-KR') : '—');
  const ntsFail = (b: Biz) => b.ntsStatus === 'CLOSED' || b.ntsStatus === 'SUSPENDED';

  return (
    <>
      <Pills label="회원 상태" value={st} onChange={setSt}
             items={[['wait', '승인 대기', waiting.length], ['active', '정상', active.length],
                     ['suspended', '정지', suspended.length], ['rejected', '반려', rejected.length], ['all', '전체', data.length]]} />
      <div className="ad-dact" style={{ margin: '0 0 10px' }}>
        {onGo && <button className="btn-plain btn-sm" onClick={() => onGo('members')} data-go="members">이름 · 이메일로 찾기</button>}
        <div className="search-row" style={{ maxWidth: 360, margin: 0 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="상호 · 대표 · 사업자번호로 찾기" aria-label="사업자 찾기" />
        </div>
      </div>
      {counts.data && <p className="dim" style={{ fontSize: 12.5, margin: '-4px 0 8px' }} data-acc-counts>개인 회원을 포함한 전체 계정 — 정상 {counts.data.active.toLocaleString('ko-KR')} · 정지 {counts.data.suspended.toLocaleString('ko-KR')} (개인 회원은 「회원」 탭에서 찾고 정지합니다)</p>}
      {err && <p className="form-error">{err}</p>}
      {ok && <p className="form-ok" role="status">{ok}</p>}

      {list.length === 0 && (
        <p className="ad-empty">{st === 'wait' ? '대기 중인 신청이 없습니다.' : st === 'suspended' ? '정지된 사업자 회원이 없습니다.' : '해당하는 회원이 없습니다.'}</p>
      )}
      {list.slice(0, 60).map((b) => (
        /* 시안 .mrow — [상호 · 번호 · 사업자 · 대표 · 날짜 (경고)] [요금제 · 서류] [반려 · 승인] */
        <div key={b.id} className={`card row${ntsFail(b) ? ' row-warn' : ''}`} data-biz={b.id}>
          <div className="row-main">
            <strong>{b.companyName} <span className="dim">{b.no}</span></strong>
            <span className="dim">사업자 {b.bizRegNo} · 대표 {b.ceoName} · {ymd(b.createdAt)}</span>
            {ntsFail(b) && <span style={{ color: 'var(--danger)', fontSize: 12.5, fontWeight: 700, marginTop: 6 }}>사업자등록번호 확인 실패({b.ntsStatus === 'CLOSED' ? '폐업' : '휴업'}) — 승인 불가</span>}
            {b.rejectedAt && <span style={{ color: 'var(--danger)', fontSize: 12.5 }}>반려 {ymd(b.rejectedAt)} — {b.rejectReason}</span>}
          </div>
          <div className="row-main" style={{ flex: '0 0 180px' }}>
            <span className="ad-bg pp" style={{ alignSelf: 'flex-start' }}>{b.planCode ?? 'BASIC'}</span>
            <span className="dim">{b.ntsStatus === 'VALID' ? '국세청 계속사업자 확인' : b.ntsStatus ? `국세청 ${b.ntsStatus}` : '국세청 조회 미연동'}</span>
          </div>
          <div className="row-act">
            {!b.verifiedAt && !b.rejectedAt && (ntsFail(b)
              ? <button className="btn-plain" disabled>승인 불가</button>
              : <>
                  <button className="btn-no" disabled={busy === b.id} onClick={() => setOpen(open === b.id ? null : b.id)}>반려</button>
                  <button className="btn-ok" disabled={busy === b.id} onClick={() => verify(b)}>승인</button>
                </>)}
            {b.verifiedAt && b.accountStatus === 'ACTIVE' && (
              <button className="btn-no btn-sm" disabled={busy === b.id} onClick={() => setOpen(open === b.id ? null : b.id)}>정지</button>)}
            {b.accountStatus === 'SUSPENDED' && (
              <button className="btn-plain btn-sm" disabled={busy === b.id} onClick={() => setOpen(open === b.id ? null : b.id)}>정지 해제</button>)}
          </div>
          {open === b.id && (
            <div style={{ flex: '1 0 100%', display: 'flex', gap: 6, marginTop: 8 }} data-reason-form>
              <input value={why[b.id] ?? ''} onChange={(e) => setWhy((w) => ({ ...w, [b.id]: e.target.value }))} style={{ flex: 1 }}
                     placeholder={!b.verifiedAt ? '반려 사유 (예: 사업자등록증의 상호와 신청 상호가 다릅니다)' : '사유 (기록에 남습니다)'} aria-label="사유" />
              <button className="btn-ok btn-sm" disabled={busy === b.id || (why[b.id] ?? '').trim().length < 2}
                      onClick={() => !b.verifiedAt
                        ? act(b.id, `/admin/businesses/${b.id}/reject`, { reason: why[b.id] }, `${b.companyName} — 반려했습니다. 신청자에게 사유를 알렸습니다.`)
                        : act(b.id, `/admin/accounts/${b.accountId}/status`,
                              { status: b.accountStatus === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED', reason: why[b.id] },
                              b.accountStatus === 'SUSPENDED' ? `${b.companyName} — 정지를 풀었습니다.` : `${b.companyName} — 정지했습니다.`)}>
                {!b.verifiedAt ? '반려하기' : b.accountStatus === 'SUSPENDED' ? '정지 해제' : '정지하기'}
              </button>
            </div>
          )}
        </div>
      ))}

      {/* v10.32 — 시안 순서: 신청 카드 바로 아래 파란 안내 띠(전에는 아래 전체 표 뒤에 있어 200줄을 지나야 보였음) */}
      <div data-usr-note className="ad-nt info">
        <b>승인 전에는 사업자 기능이 열리지 않습니다.</b> 사업자 매물 등록 · 소개비 수령(사업자)은 승인 후에 열리고, 승인한 시각이 소개비 수령 자격의 기준일이 됩니다(INV-10).
        자동 승인하지 않습니다 — 법적 판단이 섞여 있습니다.
      </div>

      {st === 'wait' && (
        <>
          {/* 승인하면 대기 줄에서 빠지고 아래 전체 표에 인증 날짜가 찍힙니다 — 같은 화면에서 바로 확인(개발에만 · 시험도 이것을 봅니다) */}
          <h2 className="ad-s2">전체 <em>{data.length}</em></h2>
          <div className="ad-tw">
            <table className="tbl">
              <thead><tr><th>상호</th><th>대표</th><th>사업자번호</th><th>국세청</th><th>인증</th></tr></thead>
              <tbody>
                {data.slice(0, 100).map((b) => (
                  <tr key={b.id}>
                    <td><b>{b.companyName}</b></td><td>{b.ceoName}</td><td className="mono">{b.bizRegNo}</td>
                    <td>{b.ntsStatus ?? <span className="dim">미연동</span>}</td>
                    <td>{b.verifiedAt ? new Date(b.verifiedAt).toLocaleDateString('ko-KR')
                      : b.rejectedAt ? <span className="ad-chip no">반려</span> : <span className="ad-chip warn">대기</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

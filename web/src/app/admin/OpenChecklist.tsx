import { useEffect, useState } from 'react';
import { api, ApiFailure } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { ErrorView } from '../../components/ErrorView';
import { Switches } from './Switches';

interface Blocker { kind: string; item: string; reason: string }
interface Check { key: string; label: string; ok: boolean; detail: string; go: string | null }
interface Res { code: string; name: string; isActive: boolean; passed: number; total: number; canOpen: boolean; checks: Check[] }
interface Gwan { code: string; name: string; isActive: boolean; isHub: boolean }
/* v10.146 (D142 · docs/225) — 오픈 준비 점검 한 줄 */
interface Ready { code: string; label: string; required: boolean; ok: boolean; nowValue: string; todo: string; go: string | null }
/* v10.150 (D144 · docs/230) — 오픈일과 맞춘 날짜들 */
interface OpenDate { openDate: string | null; promoEndsOn: string | null; termsPublishBy: string | null; termsUnfavorableBy: string | null; daysLeft: number | null; termsOtherDate: number }
/* v10.149 (docs/229) — 파일 저장 위치 */
interface Storage { kind: 'S3' | 'LOCAL'; bucket: string | null; localFiles: number; s3Files: number; readyBytes: number; pendingMove: boolean }

const KIND_LABEL: Record<string, string> = {
  SETTING: '사이트 설정', TERM: '약관', FOOTER: '푸터 링크',
  /* v10.27 (G-176) — 외부 연동 · 간주 모드(연동 전이라 확인 없이 통과시키는 중) */
  INTEGRATION: '외부 연동', ASSUME: '간주 모드 켜짐',
  /* v10.146 (D142) — 방식 설정 · 메일 · 가짜(MOCK) · 소개비 순서 */
  READY: '오픈 준비',
};

/**
 * SB-ADM-SIT-040 오픈 체크리스트
 *
 * v10.31 (10/10 시안 기준 · scAdmSitChk) — 관 하나의 오픈 점검 6줄(업종 · 소개비 부담 주체 · 인증 게이트 · 법정 고지 · 약관 · 검수 담당자)과
 * 「N / 6 통과」, 「운영중으로 전환 · 법정 고지 채우기」. 판정은 서버(GET /admin/gwans/:code/open-check)가 DB 로 합니다.
 * 개발에만 있던 「서비스 오픈을 막는 항목」(v_open_blockers — 간주 모드 · 외부 연동 · 설정)은 아래에 그대로 둡니다.
 */
export function OpenChecklist({ onGo }: { onGo?: (tab: string) => void }) {
  const gwans = useApi<Gwan[]>('/admin/gwans/manage');
  const blockers = useApi<Blocker[]>('/admin/open-blockers');
  const ready = useApi<Ready[]>('/admin/open-readiness');
  const store = useApi<Storage>('/admin/storage-status');
  const [code, setCode] = useState<string>('');
  const [r, setR] = useState<Res | null>(null);
  const [msg, setMsg] = useState<[boolean, string] | null>(null);
  const [busy, setBusy] = useState(false);

  const list = (gwans.data ?? []).filter((g) => !g.isHub);
  useEffect(() => {
    if (!code && list.length) setCode((list.find((g) => !g.isActive) ?? list[0]!).code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gwans.data]);
  const load = () => { if (code) api<Res>(`/admin/gwans/${code}/open-check`).then(setR).catch(() => setR(null)); };
  useEffect(load, [code]);

  async function open() {
    if (!r) return;
    setBusy(true); setMsg(null);
    try { const x = await api<{ note: string }>(`/admin/gwans/${r.code}/open`, { method: 'POST', body: '{}' }); setMsg([true, x.note]); load(); gwans.reload(); }
    catch (e) { setMsg([false, e instanceof ApiFailure ? e.body.message : '전환하지 못했습니다.']); }
    finally { setBusy(false); }
  }

  if (gwans.error) return <ErrorView error={gwans.error} />;
  const fail = r ? r.checks.filter((c) => !c.ok) : [];
  const data = blockers.data ?? [];
  const byKind = data.reduce<Record<string, Blocker[]>>((a, b) => { (a[b.kind] ??= []).push(b); return a; }, {});

  return (
    <>
      <div className="ad-chk" style={{ flexWrap: 'wrap' }}>
        <select value={code} onChange={(e) => setCode(e.target.value)} aria-label="점검할 관">
          {list.map((g) => <option key={g.code} value={g.code}>{g.name} ({g.code}) · {g.isActive ? '운영중' : '준비중'}</option>)}
        </select>
        {r && <><b>{r.passed} / {r.total} 통과</b>
          <span className={`ad-bg ${r.isActive ? 'ok' : r.canOpen ? 'ok' : 'no'}`}>{r.isActive ? '운영중' : r.canOpen ? '오픈 가능' : '오픈 불가'}</span></>}
      </div>
      {msg && <p className={msg[0] ? 'form-ok' : 'form-error'} role="status">{msg[1]}</p>}
      {r && (
        <div className="ad-tw"><table className="tbl" data-open-check={r.code}>
          <tbody>{r.checks.map((c) => (
            <tr key={c.key} className={c.ok ? undefined : 'bad'}>
              <td><b>{c.label}</b></td><td>{c.detail}</td>
              <td style={{ width: 90 }}>{c.ok ? <span className="ad-bg ok">통과</span> : <span className="ad-bg no">미통과</span>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {r && fail.length > 0 && (
        <div className="ad-nt warn"><b>미통과 {fail.length}건.</b> {fail.map((c) => c.label).join(' · ')} — 법정 고지와 약관은 실제 값이 들어와야 채워집니다 (B-12 · D-02).</div>
      )}
      <div className="ad-dact">
        <button className="btn-ok" disabled={!r || !r.canOpen || busy} onClick={open} data-gwan-open
                title={r?.isActive ? '이미 운영중입니다' : !r?.canOpen ? '하나라도 미충족이면 열리지 않습니다' : undefined}>운영중으로 전환</button>
        {onGo && <button className="btn-plain" onClick={() => onGo('siteinfo')}>법정 고지 채우기</button>}
      </div>

      {/* v10.65 (docs/121) — 간주 모드 · 소개비 스위치를 운영 화면에서 */}
      <Switches />

      {/* v10.146 (D142 · docs/225) — 오픈 준비 점검: 꼭(안 되면 아래 「오픈 준비」 차단) · 권장(꺼져 있어도 오픈은 됨) */}
      <h2 className="ad-s2">오픈 준비 점검 <em>{(ready.data ?? []).filter((x) => x.required && !x.ok).length}</em> <small className="dim">꼭 4 · 권장 4 — 지금 값 · 할 일</small></h2>
      {ready.error ? <ErrorView error={ready.error} /> : (
        <div className="ad-tw"><table className="tbl" data-open-ready>
          <thead><tr><th>항목</th><th>구분</th><th>지금 값</th><th>할 일</th><th style={{ width: 90 }}>상태</th><th style={{ width: 90 }}></th></tr></thead>
          <tbody>{(ready.data ?? []).map((x) => (
            <tr key={x.code} data-ready={x.code} className={x.ok || !x.required ? undefined : 'bad'}>
              <td><b>{x.label}</b></td>
              <td>{x.required ? <span className="pill pill-danger">꼭</span> : <span className="pill pill-muted">권장</span>}</td>
              <td><code>{x.nowValue}</code></td>
              <td>{x.todo}</td>
              <td>{x.ok ? <span className="ad-bg ok">됨</span> : <span className={`ad-bg ${x.required ? 'no' : 'wait'}`}>{x.required ? '미통과' : '꺼짐'}</span>}</td>
              <td>{!x.ok && x.go && onGo && <button className="btn-plain" onClick={() => onGo(x.go!)}>고칠 곳</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}

      <OpenDateBox onSaved={ready.reload} />

      {/* v10.149 (docs/229) — 파일 저장 위치: 서버 디스크 / S3 · 바꾸기는 사람이 .env S3_BUCKET + files-to-s3.sh (화면은 읽기만) */}
      {store.data && (
        <p className="dim" data-storage={store.data.kind} data-storage-pending={store.data.pendingMove ? '1' : '0'}>
          파일 저장 위치: <b>{store.data.kind === 'S3' ? `S3 (${store.data.bucket})` : '서버 디스크'}</b>
          {' · '}디스크 기록 {store.data.localFiles.toLocaleString()}개 · S3 기록 {store.data.s3Files.toLocaleString()}개
          {' · '}쓰는 파일 {(store.data.readyBytes / 1048576).toFixed(1)}MB
          {store.data.pendingMove && <> · <span className="ad-bg wait">옮기기 덜 끝남 — files-to-s3.sh verify · apply</span></>}
          {store.data.kind === 'LOCAL' && <> · S3 로 바꾸는 순서는 docs/229</>}
        </p>
      )}

      <h2 className="ad-s2">서비스 오픈을 막는 항목 <em>{data.length}</em> <small className="dim">개발에만 — 간주 모드 · 외부 연동 · 설정</small></h2>
      {blockers.error ? <ErrorView error={blockers.error} /> : data.length === 0
        ? <p className="ok-note">오픈 차단 항목이 없습니다. 배포 점검을 통과합니다.</p>
        : Object.entries(byKind).map(([kind, l]) => (
          <section key={kind} className="card block-sec">
            <h3>{KIND_LABEL[kind] ?? kind} <em>{l.length}</em></h3>
            <ul>{l.map((b) => <li key={b.item}><strong>{b.item}</strong><span>{b.reason}</span></li>)}</ul>
          </section>
        ))}
    </>
  );
}

/** v10.150 (D144 · docs/230) — 오픈일 한 칸: 넣으면 홍보 기간 종료일(오픈 + 3개월)이 함께 정해짐 · 약관 시행일은 법정 고지 화면에서 이 날로 게시 */
function OpenDateBox({ onSaved }: { onSaved: () => void }) {
  const r = useApi<OpenDate>('/admin/open-date');
  const [d, setD] = useState('');
  const [msg, setMsg] = useState<[boolean, string] | null>(null);
  useEffect(() => { if (r.data) setD(r.data.openDate ?? ''); }, [r.data]);
  const save = async () => {
    const promo = d ? ` 홍보 기간 종료일도 오픈 + 3개월로 바뀝니다(이날부터 요청 열람 한도 자동 적용).` : '';
    if (!window.confirm(`오픈일을 ${d || '비움'} 으로 저장합니다.${promo}`)) return;
    try { await api('/admin/open-date', { method: 'PUT', body: JSON.stringify({ date: d }) }); setMsg([true, '저장했습니다.']); r.reload(); onSaved(); }
    catch (e) { setMsg([false, e instanceof ApiFailure ? e.body.message : '저장하지 못했습니다.']); }
  };
  const x = r.data;
  return (
    <>
      <h2 className="ad-s2">오픈일 <small className="dim">넣으면 홍보 기간 종료일 · 약관 게시 마감이 맞춰짐</small></h2>
      {r.error ? <ErrorView error={r.error} /> : (
        <div className="card" data-open-date>
          <p>
            <input type="date" value={d} onChange={(e) => setD(e.target.value)} data-open-date-input />{' '}
            <button className="btn" onClick={save} disabled={d === (x?.openDate ?? '')} data-open-date-save>저장</button>
            {msg && <span className={`ad-bg ${msg[0] ? 'ok' : 'no'}`} style={{ marginLeft: 8 }}>{msg[1]}</span>}
          </p>
          {x?.openDate ? (
            <table className="tbl"><tbody>
              <tr><th>오픈일</th><td><b>{x.openDate}</b> {x.daysLeft != null && <span className="dim">({x.daysLeft >= 0 ? `${x.daysLeft}일 남음` : `${-x.daysLeft}일 지남`})</span>}</td></tr>
              <tr><th>홍보 기간 종료일</th><td data-promo-end>{x.promoEndsOn ?? '—'} <span className="dim">이날부터 요청 열람 한도 자동 적용</span></td></tr>
              <tr><th>약관 게시 마감</th><td>{x.termsPublishBy} <span className="dim">시행 7일 전 · 불리한 변경이 있으면 {x.termsUnfavorableBy}(30일 전)</span></td></tr>
              <tr><th>약관 시행일</th><td>{x.termsOtherDate === 0
                ? <span className="ad-bg ok">게시된 약관 모두 오픈일</span>
                : <span className="ad-bg wait" data-terms-other={x.termsOtherDate}>시행일이 오픈일과 다른 약관 {x.termsOtherDate}개 — 법정 고지에서 오픈일로 게시</span>}</td></tr>
            </tbody></table>
          ) : <p className="dim">오픈일 미정 — 업종 정정 · 본인인증 연동 일정이 나오면 넣으십시오.</p>}
        </div>
      )}
    </>
  );
}


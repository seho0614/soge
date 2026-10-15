import { useEffect, useState } from 'react';
import { api, ApiFailure } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { ErrorView } from '../../components/ErrorView';
import { searchAddress } from '../../lib/postcode';
import { siteHref } from '../../lib/siteUrl';

interface Setting {
  key: string; value: string | null; description: string; isRequiredForOpen: boolean;
  /* v10.31 — 서버가 비밀 값(내부 API 키 · 수금 계좌번호)을 가려서 보냅니다. hasValue 로 「들어 있는지」만 압니다 */
  secret?: boolean; hasValue?: boolean; valueExample?: string | null; hasIssue?: boolean; issue?: string | null;
}

/** 시안 「항목 · 값」 표 9줄 — 푸터 법정 고지(D-02). 순서 · 이름은 시안 그대로 */
const LEGAL: [string, string][] = [
  ['footer.company_name', '상호'],
  ['footer.ceo_name', '대표자'],
  ['footer.biz_reg_no', '사업자등록번호'],
  ['footer.mail_order_no', '통신판매업 신고번호'],
  ['footer.job_info_no', '직업정보제공사업 신고번호'],
  ['footer.address', '주소'],
  ['footer.phone', '전화'],
  ['footer.privacy_officer', '개인정보보호책임자'],
  ['footer.hosting', '호스팅 제공자'],
];

/**
 * SB-ADM-SIT-070 사이트 기본 정보 · 법정 고지
 *
 * v10.31 (10/10 시안 기준) — 시안(scAdmLegal) 순서: 「9 / 9 입력됨」 → 항목 · 값 표(주소 검색) → 안내 →
 * 요청 열람 한도 · 소개코드 범위 · 사회관계망 주소 → 「주소 반영 · 저장 · 오픈 체크리스트로」.
 * 개발에만 있는 그 밖의 오픈 필수 설정(수금 계좌 · 약관 고지 등)은 아래 표로 남깁니다.
 * 결함 고침 — 내부 API 키 · 수금 계좌번호가 입력 칸에 그대로 보이던 것: 서버가 가린 값만 주고, 바꿀 때만 새 값을 입력합니다.
 */
export function SiteInfo({ onGo }: { onGo?: (tab: string) => void }) {
  const { data, error, loading, reload } = useApi<Setting[]>('/admin/site-settings');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [sns, setSns] = useState<Record<string, string>>({});
  const [changing, setChanging] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!data) return;
    setDraft(Object.fromEntries(LEGAL.map(([k]) => [k, data.find((s) => s.key === k)?.value ?? ''])));
    setSns(Object.fromEntries(data.filter((s) => s.key.startsWith('sns.')).map((s) => [s.key, s.value ?? ''])));
  }, [data]);

  async function save(key: string, value: string) {
    setBusy(key); setErr(null);
    try {
      await api('/admin/site-settings', { method: 'PATCH', body: JSON.stringify({ key, value }) });
      return true;
    } catch (e) {
      setErr(e instanceof ApiFailure ? `${key} — ${e.body.message}` : '저장하지 못했습니다.');
      return false;
    } finally { setBusy(null); }
  }
  async function saveOne(key: string, value: string, done: string) {
    setOk(null);
    if (await save(key, value)) { setOk(done); reload(); }
  }

  if (error) return <ErrorView error={error} />;
  if (loading || !data) return <p className="muted">불러오는 중…</p>;

  const get = (k: string) => data.find((s) => s.key === k);
  const filled = LEGAL.filter(([k]) => (draft[k] ?? get(k)?.value ?? '').trim()).length;
  const changedLegal = LEGAL.filter(([k]) => (draft[k] ?? '') !== (get(k)?.value ?? ''));

  async function saveLegal(only?: string) {
    setOk(null); setErr(null);
    const keys = only ? changedLegal.filter(([k]) => k === only) : changedLegal;
    if (keys.length === 0) { setOk(only ? '주소가 바뀌지 않았습니다 — 저장할 것이 없습니다.' : '바뀐 항목이 없습니다 — 저장할 것이 없습니다.'); return; }
    let n = 0;
    for (const [k] of keys) if (await save(k, (draft[k] ?? '').trim())) n++;
    if (n) { setOk(only ? '주소를 반영했습니다 — 모든 화면의 푸터 주소가 함께 바뀝니다.' : `${n}개 항목을 저장했습니다.`); reload(); }
  }

  /* D011 (10/2 결정) — 요청 열람 한도: 홍보 기간에는 끄고, 정식 서비스 때 켭니다. 무료 · 일반 회원은 같은 값 */
  const viewOn = get('request.view.limit')?.value === 'on';
  const viewFree = get('request.view.free_monthly');
  const viewFrom = get('request.view.limit_from');
  /* 홍보 기간 종료일이 지났으면 스위치가 off 여도 적용 중입니다 (서버 fn_request_view_limit 와 같은 판정 · 한국 날짜) */
  const todayKst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  const viewAuto = !viewOn && !!viewFrom?.value && todayKst >= viewFrom.value;
  const viewActive = viewOn || viewAuto;
  /* D012 (10/2 결정 「매물별로」 · 관리자 지정) — 소개코드 범위 */
  const scope = get('refcode.scope');
  /* D021 (10/2 결정 「운영 화면에서 입력」) — 사회관계망 계정 주소. 메인 푸터 아이콘이 이 주소로 연결됩니다 */
  const SNS: [string, string, string][] = [
    ['sns.facebook', '페이스북', 'https://www.facebook.com/…'], ['sns.instagram', '인스타그램', 'https://www.instagram.com/…'],
    ['sns.x', '엑스', 'https://x.com/…'], ['sns.youtube', '유튜브', 'https://www.youtube.com/@…']];
  const snsRows = SNS.filter(([k]) => get(k));
  const snsLinked = snsRows.filter(([k]) => get(k)?.value);
  const snsChanged = snsRows.filter(([k]) => (sns[k] ?? '').trim() !== (get(k)?.value ?? ''));

  async function saveSns() {
    setOk(null); setErr(null);
    if (snsChanged.length === 0) { setOk('바뀐 주소가 없습니다 — 저장할 것이 없습니다.'); return; }
    let n = 0;
    for (const [k] of snsChanged) if (await save(k, (sns[k] ?? '').trim())) n++;
    if (n) { setOk(`사회관계망 주소 ${n}개를 저장했습니다. 1분쯤 지나 메인 푸터에 반영됩니다.`); reload(); }
  }

  /* 시안 9줄 밖의 오픈 필수 설정(개발에만 — 약관 고지 · 수금 계좌 · 사이트 주소 등) */
  const legalKeys = new Set(LEGAL.map(([k]) => k));
  const others = data.filter((s) => s.isRequiredForOpen && !legalKeys.has(s.key));

  return (
    <>
      <div className="ad-chk" data-legal-count={`${filled}/${LEGAL.length}`}>
        <b>{filled} / {LEGAL.length} 입력됨</b>
        <span className={`ad-bg ${filled === LEGAL.length ? 'ok' : 'no'}`}>{filled === LEGAL.length ? '완료' : '미완'}</span>
      </div>
      {err && <p className="form-error">{err}</p>}
      {ok && <p className="form-ok" role="status">{ok}</p>}

      <div className="ad-tw">
        <table className="tbl" data-legal-table>
          <thead><tr><th style={{ width: 220 }}>항목</th><th>값</th></tr></thead>
          <tbody>
            {LEGAL.map(([k, t]) => {
              const s = get(k);
              if (!s) return <tr key={k}><td><b>{t}</b></td><td><span className="dim">서버 설정 없음 ({k})</span></td></tr>;
              const v = draft[k] ?? '';
              return (
                <tr key={k} className={!v.trim() ? 'bad' : undefined}>
                  <td><b>{t}</b></td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input name={k} value={v} placeholder="TBD" aria-label={t} style={{ flex: 1 }}
                             onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} />
                      {k === 'footer.address' && (
                        <button className="btn-sm" type="button" data-addr-search
                                onClick={() => searchAddress().then((a) => { if (a) setDraft((d) => ({ ...d, [k]: a })); })
                                  .catch((e: Error) => setErr(e.message))}>주소 검색</button>
                      )}
                      {busy === k && <span className="dim">저장 중…</span>}
                    </div>
                    {s.issue && <span className="ad-ls" style={{ color: 'var(--danger)' }}>{s.issue}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="ad-nt warn">
        <b>푸터 법정 고지의 원본입니다. 값이 비면 화면에 TBD 로 나가고 오픈 체크리스트가 막힙니다 (D-02 · B-12).</b>{' '}
        직업정보제공사업은 용역 소개를 시작하면 신고 의무가 생깁니다 — 지금은 물품 소개만 하므로 해당 없음입니다.
      </div>

      {get('request.view.limit') && (
        <section className="ad-panel" data-view-limit={viewOn ? 'on' : 'off'} data-view-active={viewActive ? 'yes' : 'no'}>
          <h3>요청 열람 한도 <small>운영이 지정</small></h3>
          <p className="now">지금: {viewOn ? '정식 서비스 — 한도 적용' : viewAuto ? '홍보 기간 종료일이 지나 한도 적용 중' : '홍보 기간 — 모든 회원 제한 없음'}</p>
          <span className="ad-ls">
            최초 3개월(홍보 기간)은 제한이 없습니다. 켜면 <b>무료(BASIC) 회원과 구독 없는 일반 회원에게 같은 건수(월 {viewFree?.value ?? '—'}건)</b>가
            적용되고, 유료 요금제는 요금제 값을 씁니다. 「홍보 기간 종료일」을 넣어 두면 그날부터 자동으로 적용됩니다. 같은 요청을 다시 여는 것은 세지 않습니다.
          </span>
          {viewFree && (
            <p style={{ margin: '8px 0 0' }}>
              <label>무료 · 일반 회원 월 열람 건수{' '}
                <input name="view-free-monthly" type="number" min={1} max={9999} defaultValue={viewFree.value ?? '5'} style={{ width: 90 }}
                  onBlur={(e) => { if (e.target.value !== (viewFree.value ?? '')) saveOne('request.view.free_monthly', e.target.value, '월 열람 건수를 저장했습니다.'); }} />
                {' '}건</label>
              {!viewActive && <span className="dim"> (지금은 홍보 기간이라 적용되지 않습니다)</span>}
            </p>
          )}
          {viewFrom && (
            <p style={{ margin: '8px 0 0' }}>
              <label>홍보 기간 종료일 (선택){' '}
                <input name="view-limit-from" type="date" defaultValue={viewFrom.value ?? ''}
                  onBlur={(e) => { if (e.target.value !== (viewFrom.value ?? '')) saveOne('request.view.limit_from', e.target.value, '홍보 기간 종료일을 저장했습니다.'); }} />
              </label>
              {viewAuto && <><br /><b data-view-auto="1">종료일이 지나 지금 한도가 적용 중입니다.</b></>}
            </p>
          )}
          {/* 예전 라디오도 둡니다(같은 설정) — 시험 · 키보드 */}
          <fieldset style={{ border: 0, padding: 0, margin: '8px 0 0' }} aria-label="요청 열람 한도">
            <label><input type="radio" name="view-limit" checked={!viewOn} disabled={busy === 'request.view.limit'}
              onChange={() => saveOne('request.view.limit', 'off', '홍보 기간으로 두었습니다 — 모든 회원 제한 없음.')} /> 홍보 기간 — 모든 회원 제한 없음</label>{' '}
            <label><input type="radio" name="view-limit" checked={viewOn} disabled={busy === 'request.view.limit'}
              onChange={() => saveOne('request.view.limit', 'on', '정식 서비스로 전환했습니다 — 한도가 적용됩니다.')} /> 정식 서비스 — 한도 적용</label>
          </fieldset>
          <div className="ad-dact" style={{ marginTop: 8 }}>
            <button className="btn-ok btn-sm" disabled={busy === 'request.view.limit'} data-view-toggle
                    onClick={() => saveOne('request.view.limit', viewOn ? 'off' : 'on',
                      viewOn ? '홍보 기간으로 되돌렸습니다 — 모든 회원 제한 없음.' : '정식 서비스로 전환했습니다 — 한도가 적용됩니다.')}>
              {viewOn ? '홍보 기간으로 되돌리기 (제한 없음)' : '정식 서비스로 전환 (한도 적용)'}
            </button>
          </div>
        </section>
      )}

      {scope && (
        <section className="ad-panel" data-refcode-scope={scope.value ?? ''}>
          <h3>소개코드 범위 <small>운영이 지정</small></h3>
          <p className="now">지금: {scope.value === 'all' ? '전체 — 코드 1개로 모든 매물' : '매물별 — 매물마다 코드가 따로'}</p>
          <span className="ad-ls">
            <b>매물별</b>이면 그 매물의 거래에만 소개자가 붙습니다(월 무료분 = 새 매물 1건, 더 필요하면 매물당 30,000원 결제 후 — 모든 요금제).
            <b> 전체</b>면 코드 1개로 모든 매물을 소개합니다. 바꾸기 전에 받은 코드는 그대로입니다.
          </span>
          <fieldset style={{ border: 0, padding: 0, margin: '8px 0 0' }} aria-label="소개코드 범위">
            <label><input type="radio" name="refcode-scope" checked={scope.value === 'listing'} disabled={busy === 'refcode.scope'}
              onChange={() => saveOne('refcode.scope', 'listing', '소개코드 범위를 매물별로 바꿨습니다.')} /> 매물별 — 매물마다 코드가 따로</label>{' '}
            <label><input type="radio" name="refcode-scope" checked={scope.value === 'all'} disabled={busy === 'refcode.scope'}
              onChange={() => saveOne('refcode.scope', 'all', '소개코드 범위를 전체로 바꿨습니다.')} /> 전체 — 코드 1개로 모든 매물</label>
          </fieldset>
          <div className="ad-dact" style={{ marginTop: 8 }}>
            <button className="btn-plain btn-sm" disabled={busy === 'refcode.scope'} data-scope-toggle
                    onClick={() => saveOne('refcode.scope', scope.value === 'all' ? 'listing' : 'all',
                      scope.value === 'all' ? '소개코드 범위를 매물별로 바꿨습니다.' : '소개코드 범위를 전체로 바꿨습니다.')}>
              {scope.value === 'all' ? '매물별로 바꾸기' : '전체로 바꾸기'}
            </button>
          </div>
        </section>
      )}

      {snsRows.length > 0 && (
        <section className="ad-panel" data-sns-settings>
          <h3>사회관계망 주소 <small>설정 {snsRows.map(([k]) => k).join(' · ')}</small></h3>
          <p className="now">지금: {snsLinked.length
            ? `${snsLinked.map(([, t]) => t).join(' · ')} 연결 — 나머지는 「준비 중」`
            : `연결한 곳 없음 — 메인 푸터 아이콘 ${snsRows.length}개가 「준비 중」으로 나갑니다`}</p>
          <span className="ad-ls">
            주소를 넣은 아이콘만 메인 푸터에서 새 창으로 그 주소를 엽니다. 비워 두면 「준비 중」으로 남습니다.
            <b> https:// 로 시작하는 주소</b>만 받습니다(서버 설정의 형식 검사와 같습니다). 저장한 뒤 1분쯤 지나 메인에 반영됩니다.
          </span>
          {snsRows.map(([k, t, ph]) => (
            <p key={k} style={{ margin: '6px 0', display: 'flex', gap: 8, alignItems: 'center' }}>
              <label htmlFor={`sns-${k}`} style={{ width: 90 }}>{t}</label>
              {/* 칸을 벗어나면 그 칸만 저장합니다(전과 같음). 아래 「사회관계망 주소 저장」은 바뀐 칸을 한꺼번에 */}
              <input id={`sns-${k}`} name={k} type="url" value={sns[k] ?? ''} placeholder={ph} style={{ flex: 1 }}
                     onChange={(e) => setSns((d) => ({ ...d, [k]: e.target.value }))}
                     onBlur={(e) => { if (e.target.value.trim() !== (get(k)?.value ?? '')) saveOne(k, e.target.value.trim(), `${t} 주소를 저장했습니다.`); }} />
              {busy === k ? <span className="dim">저장 중…</span> : get(k)?.value ? <span className="ad-bg ok">연결됨</span> : <span className="ad-bg">준비 중</span>}
            </p>
          ))}
          <div className="ad-dact" style={{ marginTop: 8 }}>
            <button className="btn-ok btn-sm" onClick={saveSns} data-sns-save>사회관계망 주소 저장</button>
            <a className="btn-plain btn-sm" href={siteHref('/')} target="_blank" rel="noreferrer">메인 푸터에서 확인</a>
          </div>
        </section>
      )}

      {others.length > 0 && (
        <>
          <h2 className="ad-s2">그 밖의 오픈 필수 설정 <small className="dim">{others.length}</small></h2>
          {/* 계좌는 **돈이 어디로 가는지**가 바뀌는 항목입니다. 다른 설정과 같은 무게로 두면 무심코 고칩니다. */}
          {others.some((s) => s.key.startsWith('company.bank')) && (
            <div className="ad-nt warn">
              <b>수금 계좌는 구독료 · 리드비 · 광고비만 받습니다. 거래 대금은 여기로 받지 마십시오</b> — 자금을 맡아 두는 것이 되어
              전자금융거래법상 등록 대상이 됩니다(미등록 3년 이하). 소개비와 거래 대금은 당사자끼리 직접 주고받습니다.
              계좌를 바꾸시면 <b>누가 언제 무엇에서 무엇으로 바꿨는지 기록에 남습니다</b> — 지울 수 없습니다.
              실제 법인 계좌 세 항목을 모두 넣으시면 가상 계좌 간주가 <b>자동으로 풀립니다</b>.
            </div>
          )}
          <div className="ad-tw">
            <table className="tbl" data-other-settings>
              <thead><tr><th>항목</th><th>값</th></tr></thead>
              <tbody>
                {others.map((s) => (
                  <tr key={s.key} className={!s.hasValue && !s.value?.trim() ? 'bad' : undefined}>
                    <td><b>{s.description}</b><span className="ad-ls mono">{s.key}</span></td>
                    <td>
                      {s.secret ? (
                        /* 비밀 값 — 가린 값만 보이고, 「바꾸기」를 눌러야 새 값 칸이 열립니다(지금 값을 칸에 채우지 않음) */
                        changing[s.key] === undefined ? (
                          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }} data-secret={s.key}>
                            <span className="mono">{s.value || '미입력'}</span>
                            <span className="ad-bg">가림</span>
                            <button className="btn-sm" onClick={() => setChanging((c) => ({ ...c, [s.key]: '' }))}>바꾸기</button>
                          </span>
                        ) : (
                          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <input type="password" autoComplete="new-password" placeholder="새 값" value={changing[s.key]}
                                   aria-label={`${s.description} 새 값`}
                                   onChange={(e) => setChanging((c) => ({ ...c, [s.key]: e.target.value }))} />
                            <button className="btn-ok btn-sm" disabled={!changing[s.key]?.trim() || busy === s.key}
                                    onClick={async () => {
                                      if (await save(s.key, changing[s.key]!.trim())) {
                                        setChanging((c) => { const n = { ...c }; delete n[s.key]; return n; });
                                        setOk(`${s.description} — 새 값으로 바꿨습니다.`); reload();
                                      }
                                    }}>저장</button>
                            <button className="btn-sm" onClick={() => setChanging((c) => { const n = { ...c }; delete n[s.key]; return n; })}>취소</button>
                          </span>
                        )
                      ) : (
                        <input defaultValue={s.value ?? ''} placeholder={s.valueExample ? `예: ${s.valueExample}` : '미입력'} style={{ width: '100%' }}
                               aria-label={s.description}
                               onBlur={(e) => { if (e.target.value !== (s.value ?? '')) saveOne(s.key, e.target.value, `${s.description} — 저장했습니다.`); }} />
                      )}
                      {s.issue && <span className="ad-ls" style={{ color: 'var(--danger)' }}>{s.issue}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="ad-dact">
        <button className="btn-ok" onClick={() => saveLegal('footer.address')} data-addr-apply>주소 반영</button>
        <button className="btn-plain" onClick={() => saveLegal()} data-legal-save>저장</button>
        {onGo && <button className="btn-plain" onClick={() => onGo('checklist')}>오픈 체크리스트로</button>}
      </div>
    </>
  );
}

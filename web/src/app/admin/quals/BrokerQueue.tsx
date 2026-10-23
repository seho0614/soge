import { ymdhm } from '../../../lib/act';
import { ErrorView } from '../../../components/ErrorView';
import { type Broker, BST, lookupView } from './shared';

export interface BrokerList {
  items: Broker[]; assumed: boolean; lookupConfigured?: boolean;
  counts: { pending: number; verified: number; rejected: number; expired: number };
  /** v10.27 (G-207) — 쪽 나눔 · 찾기 · 순서 */
  total?: number; page?: number; pages?: number; size?: number; order?: string; q?: string | null;
}

export function BrokerQueue({ list, state, onState, busy, onDecide, onOpen, q, onQ, order, onOrder, onPage }: {
  list: { data: BrokerList | null; error: unknown; reload: () => void };
  state: string; onState: (s: string) => void; busy: string | null;
  q: string; onQ: (v: string) => void; order: string; onOrder: (v: string) => void; onPage: (p: number) => void;
  onDecide: (b: Broker, s: 'VERIFIED' | 'REJECTED') => void; onOpen: (id: string) => void;
}) {
  if (list.error) return <ErrorView error={list.error} onRetry={list.reload} />;
  const c = list.data?.counts;
  const rows = list.data?.items ?? [];
  const TABS: Array<[string, string, number | undefined]> = [
    ['PENDING', '심사 대기', c?.pending], ['VERIFIED', '인증 완료', c?.verified],
    ['REJECTED', '반려', c?.rejected], ['EXPIRED', '기한 만료', c?.expired], ['ALL', '전체', undefined],
  ];
  return (
    <>
      <h2>중개사 인증 심사 <em>{c?.pending ?? ''}</em></h2>
      <p className="lead">사이트 「중개사 인증」(/my/broker) 신청입니다. <b>승인하면 그 사업자의 부동산 매물 공개가 열립니다.</b></p>
      {list.data?.assumed && (
        <p className="card warn">
          <b>국토부 연동 전이라 대조를 건너뛴 신청입니다(assume.broker).</b> &ldquo;일치&rdquo;는 실제 대조 결과가 아닙니다 —
          등록번호 · 상호 · 대표자를 국가공간정보포털에서 직접 확인한 뒤 승인하십시오.
        </p>
      )}
      <div className="acts">
        {TABS.map(([k, l, nn]) => (
          <button key={k} className={state === k ? 'btn-ok' : 'btn-plain'} onClick={() => onState(k)}>
            {l}{nn !== undefined ? ` ${nn}` : ''}
          </button>
        ))}
      </div>
      {/* v10.27 (G-207) — 찾기 · 순서 · 쪽 */}
      <form className="acts" data-broker-find onSubmit={(e) => { e.preventDefault(); onQ(String(new FormData(e.currentTarget).get('q') ?? '').trim()); }}>
        <input name="q" defaultValue={q} placeholder="상호 · 사무소 · 대표 · 이메일 · 사업자번호 · 등록번호" aria-label="중개사 신청 찾기" style={{ minWidth: 300 }} />
        <button className="btn-plain" type="submit">찾기</button>
        {q && <button className="btn-plain" type="button" onClick={() => onQ('')}>찾기 지우기</button>}
        <select aria-label="순서" value={order || (state === 'PENDING' ? 'old' : 'recent')} onChange={(e) => onOrder(e.target.value)}>
          <option value="old">오래된 순(먼저 온 신청부터)</option>
          <option value="recent">최근 순</option>
        </select>
        {list.data?.total != null && <span className="muted" data-broker-total={list.data.total}>{list.data.total.toLocaleString('ko-KR')}건 · {list.data.page}/{list.data.pages}쪽</span>}
      </form>
      {!list.data && <p className="muted">불러오는 중…</p>}
      {list.data && rows.length === 0 && <p className="muted">해당하는 중개사 인증 신청이 없습니다.</p>}
      {rows.length > 0 && (
        <table className="tbl">
          <thead><tr><th>사업자</th><th>등록번호 · 사무소</th><th>대표자</th><th>국토부 대조</th><th>상태</th><th>접수</th><th></th></tr></thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id} data-broker={b.id}>
                <td><b>{b.company}</b><span className="muted"> {b.accountEmail}</span></td>
                <td><span className="mono">{b.licenseNo}</span><br /><span className="muted">{b.officeName ?? '—'}</span></td>
                <td>{b.ceoName ?? '—'}{!b.ceoMatch && <><br /><span className="warn-text">사업자 대표({b.bizCeoName})와 다름</span></>}</td>
                <td>{lookupView(b)}</td>
                <td>{BST[b.state] ?? b.state}{b.rejectReason ? <><br /><span className="muted">{b.rejectReason}</span></> : null}</td>
                <td className="muted">{ymdhm(b.createdAt)}</td>
                <td>
                  <button className="btn-sm" onClick={() => onOpen(b.id)}>보기</button>{' '}
                  {(b.state === 'PENDING' || b.state === 'SUBMITTED') && (
                    <>
                      <button className="btn-sm" disabled={busy === b.id || b.lookupResult !== 'MATCH'}
                              onClick={() => onDecide(b, 'VERIFIED')}>승인</button>{' '}
                      <button className="btn-no" disabled={busy === b.id} onClick={() => onDecide(b, 'REJECTED')}>반려</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {(list.data?.pages ?? 1) > 1 && (
        <div className="acts" data-broker-pages>
          <button className="btn-plain" disabled={(list.data?.page ?? 1) <= 1} onClick={() => onPage((list.data?.page ?? 1) - 1)}>← 앞 쪽</button>
          <span className="muted">{list.data?.page} / {list.data?.pages}</span>
          <button className="btn-plain" disabled={(list.data?.page ?? 1) >= (list.data?.pages ?? 1)} onClick={() => onPage((list.data?.page ?? 1) + 1)}>다음 쪽 →</button>
        </div>
      )}
      <p className="card">
        <b>대조가 맞아도 자동 승인은 없습니다</b> — 명의 도용은 번호 대조로 거를 수 없어 사람이 봅니다.
        국토부 대조가 &ldquo;일치&rdquo;가 아니면 DB 가 승인을 막고, 반려에는 사유가 필요합니다. 승인되면 180일 뒤 재확인 기한이 붙습니다.
      </p>
      <p className="card">
        규제 분야 자격(qualification_reviews)의 중개사 항목은 「규제 자격 심사 (T-21)」 탭에서 그대로 처리합니다.
      </p>
    </>
  );
}

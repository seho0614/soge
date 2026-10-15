import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';

interface Opt { id: string; sort: number; label: string; sub: string | null; image: string | null; votes: number }
interface Poll {
  id: string; kind: string; title: string; description: string | null; image: string | null; state: string; open: boolean;
  endsAt: string | null; total: number; options: Opt[]; showOnHome: boolean; sort: number; hiddenReason: string | null;
  createdAt: string; onHome: boolean;
}
interface Data { items: Poll[]; guestVote: boolean; guestIpDailyLimit: number }

const KIND: Record<string, string> = { VS: '비교해요', ASK: '궁금해요', USED: '써본 의견이 필요해요' };
const KIND_HELP: Record<string, string> = { VS: '보기 정확히 2개', ASK: '보기 2 ~ 8개', USED: '보기 2 ~ 5개' };
const STATE: Record<string, string> = { DRAFT: '준비 중', OPEN: '진행 중', CLOSED: '마감', HIDDEN: '감춤' };
const pct = (v: number, t: number) => (t > 0 ? Math.round((v * 100) / t) : 0);

/**
 * SB-ADM-CMU-020 소개광장 「이건 어때?」 투표 관리 (D021)
 *
 * 투표를 만들고(준비 중) → 열고 → 마감하거나 감춥니다. 메인 「이건 어때?」에는 종류마다 1건(순서가 가장 앞선 열린 투표)이 나옵니다.
 * ★ 표가 들어온 투표는 보기를 바꿀 수 없습니다 — 결과가 달라지기 때문입니다(서버 · DB 가 막습니다). 새 투표를 만드십시오.
 * 참여 수는 실제 표 수입니다. 이 화면에서 표 수를 고칠 수 없습니다.
 */
export function Polls() {
  const q = useApi<Data>('/admin/community/polls');
  const a = useAct();
  const [kind, setKind] = useState('VS');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [image, setImage] = useState('');
  const [opts, setOpts] = useState('');
  const [home, setHome] = useState(true);
  /* v10.31 — 시안 아래 「감추는 사유」 칸. 적어 두면 「감추기」가 그 사유로 감춥니다(비어 있으면 묻습니다) */
  const [hideWhy, setHideWhy] = useState('');
  const [limit, setLimit] = useState<string>('');

  const patch = (id: string, body: Record<string, unknown>, ok?: string) =>
    a.run(id, () => api(`/admin/community/polls/${id}`, { method: 'PATCH', body: JSON.stringify(body) }), q.reload, ok);
  const setting = (key: string, value: string, ok: string) =>
    a.run(key, () => api('/admin/site-settings', { method: 'PATCH', body: JSON.stringify({ key, value }) }), q.reload, ok);

  function create() {
    /* 보기는 한 줄에 하나 — 「이름 | 한 줄 설명 | 그림 주소」. 설명 · 그림은 비워도 됩니다 */
    const options = opts.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [label, sub, img] = l.split('|').map((x) => x.trim());
      return { label: label ?? '', ...(sub ? { sub } : {}), ...(img ? { image: img } : {}) };
    });
    if (title.trim().length < 4) { a.setErr('제목을 4자 이상 적어 주십시오.'); return; }
    if (options.length < 2) { a.setErr('보기를 2개 이상 적어 주십시오(한 줄에 하나).'); return; }
    if (kind === 'VS' && options.length !== 2) { a.setErr('「비교해요」는 보기가 정확히 2개여야 합니다.'); return; }
    void a.run('create', () => api('/admin/community/polls', {
      method: 'POST',
      body: JSON.stringify({ kind, title: title.trim(), ...(desc.trim() ? { description: desc.trim() } : {}), ...(image.trim() ? { image: image.trim() } : {}), options, showOnHome: home }),
    }), () => { setTitle(''); setDesc(''); setImage(''); setOpts(''); q.reload(); });
  }

  const hide = (p: Poll) => {
    const reason = hideWhy.trim() || (prompt(`'${p.title}' 투표를 감춥니다.\n사유(5자 이상) — 기록에 남습니다`) ?? '');
    if (reason.trim().length < 5) { a.setErr('감추실 때는 사유를 5자 이상 적으십시오.'); return; }
    void patch(p.id, { state: 'HIDDEN', hiddenReason: reason.trim() }, '감췄습니다.');
  };

  if (q.error) return <ErrorView error={q.error} onRetry={q.reload} />;
  if (!q.data) return <p className="muted">불러오는 중…</p>;
  const { items, guestVote, guestIpDailyLimit } = q.data;
  const onHome = items.filter((p) => p.onHome);

  return (
    <section data-polls-admin>
      {/* v10.29 — 화면 제목 · 설명은 위 공통 제목 줄(App · adminMenu PAGE)이 그립니다 */}
      <Flash msg={a.msg} err={a.err} />

      <section className="card" data-guest-vote={guestVote ? 'on' : 'off'}>
        <h3 style={{ display: 'flex', justifyContent: 'space-between' }}>누가 투표할 수 있나 <small className="dim">설정 poll.guest_vote · poll.guest_ip_daily_limit</small></h3>
        <p style={{ margin: '0 0 6px', fontWeight: 700 }}>지금: {guestVote ? '비로그인도 가능 — 회원 1인 1표 · 비로그인은 기기 1표' : '로그인 회원만 — 1인 1표'}</p>
        <fieldset style={{ border: 0, padding: 0, margin: '0 0 8px' }} aria-label="투표 자격">
          <label><input type="radio" name="guest-vote" checked={guestVote} disabled={a.busy === 'poll.guest_vote'}
            onChange={() => void setting('poll.guest_vote', 'on', '비로그인 방문자도 투표할 수 있게 했습니다.')} /> 비로그인도 가능 — 회원 1인 1표 · 비로그인은 기기 1표</label><br />
          <label><input type="radio" name="guest-vote" checked={!guestVote} disabled={a.busy === 'poll.guest_vote'}
            onChange={() => void setting('poll.guest_vote', 'off', '로그인 회원만 투표하게 했습니다.')} /> 로그인 회원만 — 1인 1표</label>
        </fieldset>
        <label>같은 인터넷 주소에서 비로그인으로 하루에 넣을 수 있는 표(투표 1건당){' '}
          <input name="guest-ip-limit" type="number" min={1} max={999} defaultValue={guestIpDailyLimit} style={{ width: 80 }}
            onChange={(e) => setLimit(e.target.value)}
            onBlur={(e) => { if (e.target.value && Number(e.target.value) !== guestIpDailyLimit) void setting('poll.guest_ip_daily_limit', e.target.value, '하루 한도를 바꿨습니다.'); }} /> 건
        </label>{' '}
        <button className="btn-sm" disabled={a.busy === 'poll.guest_ip_daily_limit'} data-limit-save
                onClick={() => { const v = limit || String(guestIpDailyLimit); void setting('poll.guest_ip_daily_limit', v, `하루 한도를 ${v}표로 저장했습니다.`); }}>한도 저장</button>
        <div className="ad-dact" style={{ margin: '8px 0 0' }}>
          <button className="btn-plain btn-sm" disabled={a.busy === 'poll.guest_vote'} data-guest-toggle
                  onClick={() => void setting('poll.guest_vote', guestVote ? 'off' : 'on', guestVote ? '로그인 회원만 투표하게 했습니다.' : '비로그인 방문자도 투표할 수 있게 했습니다.')}>
            {guestVote ? '로그인 회원만으로 바꾸기' : '비로그인도 받기'}</button>
        </div>
        <p className="muted" style={{ marginTop: 6 }}>
          비로그인 투표는 쿠키를 지우면 다시 할 수 있어 표가 부풀 수 있습니다 — 위 한도가 그것을 줄입니다. 주소는 날짜를 섞은 해시로만 남깁니다.
        </p>
      </section>

      <section className="card">
        <h3>메인에 나가는 투표 <em>{onHome.length}</em> / 3</h3>
        {onHome.length === 0
          ? <p className="muted">메인에 낼 열린 투표가 없습니다 — 메인의 세 장이 「준비 중」으로 보입니다.</p>
          : <p>{onHome.map((p) => <span key={p.id} style={{ marginRight: 12 }}><b>{KIND[p.kind]}</b> {p.title}</span>)}</p>}
        <p className="muted">종류(비교해요 · 궁금해요 · 써본 의견)마다 「메인에 내기」를 켠 열린 투표 가운데 순서가 가장 앞선 1건이 나옵니다.</p>
      </section>

      <section className="card" data-poll-create>
        <h3>새 투표</h3>
        <p>
          <label>종류{' '}
            <select name="poll-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              {Object.entries(KIND).map(([k, t]) => <option key={k} value={k}>{t} ({KIND_HELP[k]})</option>)}
            </select>
          </label>{' '}
          <label><input name="poll-home" type="checkbox" checked={home} onChange={(e) => setHome(e.target.checked)} /> 메인에 내기</label>
        </p>
        <p><label>제목 <input name="poll-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} style={{ width: '60%' }} placeholder="둘 중 어떤 제품이 더 좋을까요?" /></label></p>
        <p><label>설명(선택) <input name="poll-desc" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={200} style={{ width: '60%' }} /></label></p>
        <p><label>카드 그림(선택) <input name="poll-image" value={image} onChange={(e) => setImage(e.target.value)} style={{ width: '50%' }} placeholder="/home/d/poll-bags.png 또는 https://…" /></label></p>
        <p>
          <label>보기 — 한 줄에 하나 (<code>이름 | 한 줄 설명 | 그림 주소</code>, 뒤 두 칸은 선택)<br />
            <textarea name="poll-options" value={opts} onChange={(e) => setOpts(e.target.value)} rows={5} style={{ width: '70%' }}
              placeholder={'A 브랜드 | 흡입력 강함 | /home/d/vs-a.png\nB 브랜드 | 가성비 좋음 | /home/d/vs-b.png'} />
          </label>
        </p>
        <button className="btn-sm" disabled={a.busy === 'create'} onClick={create}>만들기 (준비 중으로)</button>
        <span className="muted"> 만든 뒤 「열기」를 눌러야 보이고 투표를 받습니다.</span>
      </section>

      <h3 className="sec">투표 <em>{items.length}</em></h3>
      {items.length === 0 && <p className="muted">만든 투표가 없습니다.</p>}
      {items.length > 0 && (
        <table className="tbl">
          <thead><tr><th>종류</th><th>제목 · 보기별 표</th><th>상태</th><th>참여</th><th>메인</th><th>순서</th><th>처리</th></tr></thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id} data-poll={p.id} data-state={p.state}>
                <td>{KIND[p.kind] ?? p.kind}</td>
                <td>
                  <b>{p.title}</b>
                  <div className="muted">{p.options.map((o) => `${o.label} ${o.votes}표(${pct(o.votes, p.total)}%)`).join(' · ')}</div>
                  {p.state === 'HIDDEN' && p.hiddenReason && <div className="warn-text">감춘 사유: {p.hiddenReason}</div>}
                </td>
                <td>{STATE[p.state] ?? p.state}{p.state === 'OPEN' && !p.open && ' (기한 지남)'}</td>
                <td className="num-cell">{p.total.toLocaleString('ko-KR')}</td>
                <td>
                  {/* v10.31 — 시안 단추(메인에서 빼기 · 메인에 내기) */}
                  <button className="btn-sm" disabled={a.busy === p.id} data-poll-home={p.showOnHome ? 'on' : 'off'}
                    onClick={() => void patch(p.id, { showOnHome: !p.showOnHome }, p.showOnHome ? '메인에서 뺐습니다.' : '메인에 내도록 했습니다.')}>
                    {p.showOnHome ? '메인에서 빼기' : '메인에 내기'}</button>
                  {p.onHome ? <span className="dim"> 나가는 중</span> : ''}
                </td>
                <td><input type="number" min={0} max={9999} defaultValue={p.sort} style={{ width: 60 }} aria-label="순서"
                  onBlur={(e) => { if (e.target.value !== '' && Number(e.target.value) !== p.sort) void patch(p.id, { sort: Number(e.target.value) }, '순서를 바꿨습니다.'); }} /></td>
                <td>
                  {(p.state === 'DRAFT' || p.state === 'CLOSED' || p.state === 'HIDDEN') &&
                    <button className="btn-sm" disabled={a.busy === p.id} onClick={() => void patch(p.id, { state: 'OPEN' }, '열었습니다 — 지금부터 투표를 받습니다.')}>열기</button>}{' '}
                  {p.state === 'OPEN' &&
                    <button className="btn-sm" disabled={a.busy === p.id} onClick={() => void patch(p.id, { state: 'CLOSED' }, '마감했습니다 — 결과는 계속 보입니다.')}>마감</button>}{' '}
                  {p.state !== 'HIDDEN' &&
                    <button className="btn-no" disabled={a.busy === p.id} onClick={() => hide(p)}>감추기</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p style={{ marginTop: 10 }}><label>감추는 사유 (5자 이상 — 기록에 남습니다){' '}
        <input name="poll-hide-reason" value={hideWhy} onChange={(e) => setHideWhy(e.target.value)} style={{ width: '50%' }} placeholder="예) 특정 상표를 깎아내리는 보기" /></label></p>
      <div className="ad-nt info">
        <b>표가 들어온 투표는 제목 · 보기를 바꿀 수 없습니다(POLL_LOCKED).</b> 결과가 달라지기 때문입니다 — 새 투표를 만드십시오.
        이 화면에서 표 수를 고칠 수 없고, 넣은 표는 누구도 고치거나 지울 수 없습니다(POLL_VOTE_FIXED). 만들기 · 열기 · 마감 · 감추기는 감사 기록에 남습니다.
      </div>
    </section>
  );
}

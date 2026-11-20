/* ===== v10.553 ~ 555 (D287 · docs/691 ~ 693) (57) 소개몰 3 — web/src/app/admin/Smx.tsx 새 파일 =====
 * 대표 11/21 「(57)」 — 「주문 받기」가 꺼진 지금은 운영 화면 관리부터(세 스위치 모두 처음 꺼짐).
 *   SmxBundles  소개몰 › 묶음 할인 — 묶음 만들기(직판 옵션 · 수량) · 묶음가 · 정가 합 · 할인율 · 만들 수 있는 수(품절 0) · 판매 시작 · 멈춤
 *   SmxRemote   소개몰 › 도서산간 배송비 — 우편번호 범위 · 금액 · 켬 · 우편번호로 확인 · 최근 30일 붙은 주문
 *   SmxReplies  소개몰 › 리뷰 답글 — 답글 없는 직판 리뷰에 운영 답글 · 운영 확인 대기 · 가린 답글 · 보이기 · 가리기 · 고치기 기록
 * (adminMenu · App.tsx 연결 줄은 patches/1_wiring.md) · 색 · 글자는 기존 클래스(card · tbl · btn-sm · btn-plain · warn-text · muted · num)만 — 어두운 테마 그대로
 */
import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';

const won = (v: number | null | undefined) => (v == null ? '—' : Number(v).toLocaleString('ko-KR'));

/* ── 묶음 할인 ── */
interface BundleItem { optionId: string; qty: number; code: string; name: string; optionLabel: string; price: number; stock: number; onSale: boolean; direct: boolean }
interface BundleRow { id: string; code: string; name: string; summary: string | null; price: number; state: string; maxPerOrder: number; startedAt: string | null; updatedAt: string;
  lines: number; canMake: number; listAmount: number; orders: number; items: BundleItem[]; discountRate: number; overList: boolean; startBlocks: string[] }
interface BundleView { on: boolean; items: BundleRow[]; note: string }
interface Draft { id: string | null; code: string; name: string; summary: string; price: string; maxPerOrder: string; items: Array<{ optionId: string; qty: string }> }
const ST_KO: Record<string, string> = { DRAFT: '초안', ON_SALE: '판매 중', STOPPED: '멈춤' };
const empty = (): Draft => ({ id: null, code: '', name: '', summary: '', price: '', maxPerOrder: '5', items: [{ optionId: '', qty: '1' }, { optionId: '', qty: '1' }] });

export function SmxBundles() {
  const v = useApi<BundleView>('/admin/smx/bundles');
  const a = useAct();
  const [f, setF] = useState<Draft | null>(null);
  const d = v.data;
  const edit = (b: BundleRow) => setF({ id: b.id, code: b.code, name: b.name, summary: b.summary ?? '', price: String(b.price), maxPerOrder: String(b.maxPerOrder),
    items: b.items.map((i) => ({ optionId: i.optionId, qty: String(i.qty) })) });
  const save = () => {
    if (!f) return;
    const body = JSON.stringify({ code: f.code.trim().toUpperCase(), name: f.name.trim(), summary: f.summary.trim() || undefined, price: Number(f.price), maxPerOrder: Number(f.maxPerOrder) || 5,
      items: f.items.filter((i) => i.optionId.trim()).map((i) => ({ optionId: i.optionId.trim(), qty: Number(i.qty) || 1 })) });
    void a.run('save', () => api(f.id ? `/admin/smx/bundles/${f.id}` : '/admin/smx/bundles', { method: f.id ? 'PUT' : 'POST', body }), () => { setF(null); v.reload(); });
  };
  const state = (b: BundleRow, st: 'ON_SALE' | 'STOPPED') => (st === 'ON_SALE' || confirm(`「${b.name}」 판매를 멈춥니다. 이미 받은 주문은 그대로입니다.`))
    && void a.run(`st${b.id}`, () => api(`/admin/smx/bundles/${b.id}/state`, { method: 'POST', body: JSON.stringify({ state: st }) }), v.reload);
  return (
    <section data-smx-bundles={d ? (d.on ? 'on' : 'off') : ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && <p className={d.on ? '' : 'warn-text'}>{d.note}</p>}
      <p className="muted">직판 상품의 옵션 여럿을 묶음가 하나로 팝니다. 재고는 따로 두지 않고 주문 때 구성 옵션에서 빠지며, 하나라도 품절이면 묶음도 품절입니다. 쿠폰과 함께 쓰면 쿠폰 대상 금액은 묶음가 기준이고, 반품은 주문 통째(묶음 단위)입니다. 판매 중인 묶음의 구성은 멈춘 뒤 고칩니다.</p>
      <p><button className="btn-sm" onClick={() => setF(empty())} data-smx-bundle-new="">새 묶음</button></p>
      {f && (
        <div className="card" data-smx-bundle-form={f.id ?? 'new'}>
          <p>
            <input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="코드(대문자 · 숫자 · -)" aria-label="묶음 코드" />{' '}
            <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="이름(2 ~ 60자)" aria-label="묶음 이름" />{' '}
            <input value={f.price} onChange={(e) => setF({ ...f, price: e.target.value.replace(/[^0-9]/g, '') })} placeholder="묶음가(원)" aria-label="묶음가" inputMode="numeric" />{' '}
            <input value={f.maxPerOrder} onChange={(e) => setF({ ...f, maxPerOrder: e.target.value.replace(/[^0-9]/g, '') })} placeholder="한 주문 최대" aria-label="한 주문에 살 수 있는 수" inputMode="numeric" />
          </p>
          <p><input value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} placeholder="한 줄 설명(200자 · 선택)" aria-label="한 줄 설명" size={60} /></p>
          <table className="tbl"><thead><tr><th>옵션 번호(소개몰 상품 › 옵션)</th><th className="num">수량</th><th /></tr></thead>
            <tbody>{f.items.map((it, i) => (
              <tr key={i}>
                <td><input value={it.optionId} onChange={(e) => setF({ ...f, items: f.items.map((x, j) => (j === i ? { ...x, optionId: e.target.value } : x)) })} size={40} aria-label="옵션 번호" /></td>
                <td className="num"><input value={it.qty} onChange={(e) => setF({ ...f, items: f.items.map((x, j) => (j === i ? { ...x, qty: e.target.value.replace(/[^0-9]/g, '') } : x)) })} size={3} aria-label="구성 수량" /></td>
                <td><button className="btn-sm btn-plain" onClick={() => setF({ ...f, items: f.items.filter((_, j) => j !== i) })}>빼기</button></td>
              </tr>))}
            </tbody></table>
          <p>
            {f.items.length < 10 && <button className="btn-sm btn-plain" onClick={() => setF({ ...f, items: [...f.items, { optionId: '', qty: '1' }] })}>구성 줄 더하기</button>}{' '}
            <button className="btn-sm" disabled={a.busy === 'save'} onClick={save} data-smx-bundle-save="">{f.id ? '고치기' : '초안으로 만들기'}</button>{' '}
            <button className="btn-sm btn-plain" onClick={() => setF(null)}>닫기</button>
          </p>
          <p className="muted">판매 시작 조건 — 구성 두 줄 이상 · 수량 1 인 줄 하나 이상(묶음가를 원 단위로 나눠 적는 자리) · 모두 직판 상품.</p>
        </div>
      )}
      {d && (
        <table className="tbl"><thead><tr><th>묶음</th><th>구성</th><th className="num">묶음가</th><th className="num">정가 합</th><th className="num">할인</th><th className="num">만들 수 있는 수</th><th>상태</th><th /></tr></thead>
          <tbody>{d.items.map((b) => (
            <tr key={b.id} data-smx-bundle-row={b.state}>
              <td><b>{b.name}</b> <span className="muted">{b.code}</span>{b.summary ? <div className="muted">{b.summary}</div> : null}</td>
              <td>{b.items.map((i) => (
                <div key={i.optionId} className={i.onSale && i.direct ? '' : 'warn-text'}>{i.name} {i.optionLabel} × {i.qty} <span className="muted">(재고 {won(i.stock)} · {won(i.price)}원)</span></div>))}</td>
              <td className="num"><b>{won(b.price)}</b></td>
              <td className="num">{won(b.listAmount)}</td>
              <td className="num">{b.overList ? <span className="warn-text">정가보다 비쌈</span> : `${b.discountRate}%`}</td>
              <td className="num">{b.canMake === 0 ? <span className="warn-text">품절</span> : won(b.canMake)}</td>
              <td>{ST_KO[b.state] ?? b.state}{b.orders ? <span className="muted"> · 주문 {won(b.orders)}</span> : null}{b.startedAt ? <div className="muted">{ymdhm(b.startedAt)}</div> : null}
                {b.state !== 'ON_SALE' && b.startBlocks.length > 0 && <div className="warn-text">필요: {b.startBlocks.join(' · ')}</div>}</td>
              <td>
                <button className="btn-sm btn-plain" onClick={() => edit(b)}>고치기</button>{' '}
                {b.state !== 'ON_SALE' && <button className="btn-sm" disabled={a.busy === `st${b.id}`} onClick={() => state(b, 'ON_SALE')} data-smx-bundle-start="">{b.state === 'DRAFT' ? '판매 시작' : '다시 판매'}</button>}
                {b.state === 'ON_SALE' && <button className="btn-sm btn-plain" disabled={a.busy === `st${b.id}`} onClick={() => state(b, 'STOPPED')}>멈춤</button>}
              </td>
            </tr>))}
            {d.items.length === 0 && <tr><td colSpan={8} className="muted">묶음이 없습니다.</td></tr>}
          </tbody></table>
      )}
    </section>
  );
}

/* ── 도서산간 배송비 ── */
interface Zone { id: string; name: string; kind: string; zipFrom: string; zipTo: string; fee: number; isActive: boolean; memo: string | null; updatedAt: string }
interface ZoneView { on: boolean; items: Zone[]; orders30: number; amount30: number; note: string }
interface ZoneDraft { id: string | null; name: string; kind: string; zipFrom: string; zipTo: string; fee: string; isActive: boolean; memo: string }
const KIND_KO: Record<string, string> = { JEJU: '제주', ISLAND: '도서', MOUNTAIN: '산간', OTHER: '그 밖' };

export function SmxRemote() {
  const v = useApi<ZoneView>('/admin/smx/remote-zones');
  const a = useAct();
  const [f, setF] = useState<ZoneDraft | null>(null);
  const [zip, setZip] = useState('');
  const [hit, setHit] = useState<{ zip: string; zone: string | null; fee: number } | null>(null);
  const d = v.data;
  const save = () => f && void a.run('zsave', () => api(f.id ? `/admin/smx/remote-zones/${f.id}` : '/admin/smx/remote-zones', { method: f.id ? 'PUT' : 'POST',
    body: JSON.stringify({ name: f.name.trim(), kind: f.kind, zipFrom: f.zipFrom, zipTo: f.zipTo, fee: Number(f.fee) || 0, isActive: f.isActive, memo: f.memo.trim() || undefined }) }),
  () => { setF(null); v.reload(); });
  const del = (z: Zone) => confirm(`「${z.name}」 구역을 지웁니다. 이미 받은 주문은 그대로입니다.`)
    && void a.run(`zd${z.id}`, () => api(`/admin/smx/remote-zones/${z.id}`, { method: 'DELETE' }), v.reload);
  const check = async () => {
    try { setHit(await api<{ zip: string; zone: string | null; fee: number }>(`/admin/smx/remote-zones/check?zip=${encodeURIComponent(zip)}`)); }
    catch { a.setErr('우편번호는 숫자 5자리입니다.'); }
  };
  return (
    <section data-smx-remote={d ? (d.on ? 'on' : 'off') : ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && <p className={d.on ? '' : 'warn-text'}>{d.note} 최근 30일 붙은 주문 {won(d.orders30)}건 · {won(d.amount30)}원.</p>}
      <p className="muted">직판 · 입점 판매자 주문의 배송지 우편번호가 켠 구역(처음 ~ 끝 포함)에 들면 그 금액을 배송비에 더하고 주문서 · 내 주문에 따로 보입니다. 겹치면 큰 금액 하나만. 구역을 고쳐도 이미 받은 주문은 그대로입니다. 입점 판매자 주문의 추가 몫은 판매자 몫으로 정산합니다(수수료 없음). 면세 상품만 담은 주문의 추가 몫은 면세 · 섞이면 금액 비율(smx.remote_tax_mode · SUPER).</p>
      <p>
        <input value={zip} onChange={(e) => setZip(e.target.value.replace(/[^0-9]/g, '').slice(0, 5))} placeholder="우편번호 5자리" aria-label="확인할 우편번호" inputMode="numeric" size={8} />{' '}
        <button className="btn-sm btn-plain" disabled={zip.length !== 5} onClick={() => void check()} data-smx-remote-check="">구역 확인</button>{' '}
        {hit && <span data-smx-remote-hit={hit.fee}>{hit.zip} → {hit.zone ? `${hit.zone} · ${won(hit.fee)}원` : '구역 밖(추가 없음)'}</span>}{' '}
        <button className="btn-sm" onClick={() => setF({ id: null, name: '', kind: 'ISLAND', zipFrom: '', zipTo: '', fee: '', isActive: true, memo: '' })} data-smx-zone-new="">구역 더하기</button>
      </p>
      {f && (
        <div className="card" data-smx-zone-form={f.id ?? 'new'}>
          <p>
            <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="이름" aria-label="구역 이름" />{' '}
            <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} aria-label="종류">{Object.entries(KIND_KO).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>{' '}
            <input value={f.zipFrom} onChange={(e) => setF({ ...f, zipFrom: e.target.value.replace(/[^0-9]/g, '').slice(0, 5) })} placeholder="처음" aria-label="우편번호 처음" size={7} />
            {' ~ '}
            <input value={f.zipTo} onChange={(e) => setF({ ...f, zipTo: e.target.value.replace(/[^0-9]/g, '').slice(0, 5) })} placeholder="끝" aria-label="우편번호 끝" size={7} />{' '}
            <input value={f.fee} onChange={(e) => setF({ ...f, fee: e.target.value.replace(/[^0-9]/g, '') })} placeholder="금액(원)" aria-label="추가 배송비" size={8} />{' '}
            <label><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> 켬</label>
          </p>
          <p><input value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} placeholder="메모(200자)" aria-label="메모" size={60} />{' '}
            <button className="btn-sm" disabled={a.busy === 'zsave'} onClick={save} data-smx-zone-save="">{f.id ? '고치기' : '더하기'}</button>{' '}
            <button className="btn-sm btn-plain" onClick={() => setF(null)}>닫기</button></p>
        </div>
      )}
      {d && (
        <table className="tbl"><thead><tr><th>구역</th><th>종류</th><th>우편번호</th><th className="num">금액</th><th>켬</th><th>메모</th><th /></tr></thead>
          <tbody>{d.items.map((z) => (
            <tr key={z.id} data-smx-zone-row={z.isActive ? 'on' : 'off'}>
              <td>{z.name}</td><td>{KIND_KO[z.kind] ?? z.kind}</td><td>{z.zipFrom} ~ {z.zipTo}</td><td className="num">{won(z.fee)}</td>
              <td>{z.isActive ? '켬' : <span className="muted">끔</span>}</td><td className="muted">{z.memo ?? ''}</td>
              <td>
                <button className="btn-sm btn-plain" onClick={() => setF({ id: z.id, name: z.name, kind: z.kind, zipFrom: z.zipFrom, zipTo: z.zipTo, fee: String(z.fee), isActive: z.isActive, memo: z.memo ?? '' })}>고치기</button>{' '}
                <button className="btn-sm btn-plain" disabled={a.busy === `zd${z.id}`} onClick={() => del(z)}>지우기</button>
              </td>
            </tr>))}
            {d.items.length === 0 && <tr><td colSpan={7} className="muted">구역이 없습니다.</td></tr>}
          </tbody></table>
      )}
    </section>
  );
}

/* ── 리뷰 답글 ── */
interface ReplyInfo { id: string; kind: string; body: string; state: string; holdWord: string | null; hiddenReason: string | null; editCount: number; createdAt: string; updatedAt: string }
interface ReplyRow { reviewId: string; productCode: string; productName: string; sellerType: string | null; sellerName: string | null; rating: number; body: string; createdAt: string; writer: string; reply: ReplyInfo | null }
interface ReplyView { on: boolean; view: string; counts: { open: number; pending: number; hidden: number }; items: ReplyRow[]; note: string }
interface Edit { id: string; oldBody: string; newBody: string; editedAt: string; editor: string }
const RST_KO: Record<string, string> = { VISIBLE: '보임', PENDING: '운영 확인 대기', HIDDEN: '가림' };

export function SmxReplies() {
  const [view, setView] = useState('open');
  const v = useApi<ReplyView>(`/admin/smx/review-replies?view=${view}`, [view]);
  const a = useAct();
  const [text, setText] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<{ id: string; items: Edit[] } | null>(null);
  const d = v.data;
  const write = (r: ReplyRow) => {
    const body = (text[r.reviewId] ?? r.reply?.body ?? '').trim();
    if (body.length >= 2) void a.run(`w${r.reviewId}`, () => api(`/admin/smx/review-replies/${r.reviewId}`, { method: 'PUT', body: JSON.stringify({ body }) }), v.reload);
  };
  const decide = (r: ReplyInfo, action: 'SHOW' | 'HIDE') => {
    const reason = action === 'HIDE' ? prompt('가리는 사유(2자 이상 · 답글 쓴 쪽에 보입니다):', '') : '';
    if (action === 'HIDE' && !(reason && reason.trim().length >= 2)) return;
    void a.run(`d${r.id}`, () => api(`/admin/smx/review-replies/${r.id}/decide`, { method: 'POST', body: JSON.stringify(action === 'HIDE' ? { action, reason: reason!.trim() } : { action }) }), v.reload);
  };
  const showEdits = async (r: ReplyInfo) => {
    try { const x = await api<{ id: string; items: Edit[] }>(`/admin/smx/review-replies/${r.id}/edits`); setEdits(x); } catch { a.setErr('고치기 기록을 읽지 못했습니다.'); }
  };
  return (
    <section data-smx-replies={d ? (d.on ? 'on' : 'off') : ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && <p className={d.on ? '' : 'warn-text'}>{d.note}</p>}
      <p data-smx-reply-filter="">
        {[['open', `답글 없는 직판 리뷰 ${d ? won(d.counts.open) : ''}`], ['pending', `운영 확인 대기 ${d ? won(d.counts.pending) : ''}`], ['hidden', `가림 ${d ? won(d.counts.hidden) : ''}`], ['all', '모든 답글']]
          .map(([k, l]) => <button key={k} className={`btn-sm ${view === k ? '' : 'btn-plain'}`} onClick={() => setView(k ?? 'open')}>{l}</button>)}
      </p>
      {edits && (
        <div className="card" data-smx-reply-edits={edits.items.length}>
          <p><b>고치기 기록</b> <button className="btn-sm btn-plain" onClick={() => setEdits(null)}>닫기</button></p>
          {edits.items.length === 0 ? <p className="muted">고친 적이 없습니다.</p> : edits.items.map((e) => (
            <p key={e.id}><span className="muted">{ymdhm(e.editedAt)} · {e.editor}</span><br /><s className="muted">{e.oldBody}</s><br />{e.newBody}</p>))}
        </div>
      )}
      {d && (
        <table className="tbl"><thead><tr><th>리뷰</th><th>답글</th><th /></tr></thead>
          <tbody>{d.items.map((r) => (
            <tr key={r.reviewId} data-smx-reply-row={r.reply?.state ?? 'NONE'}>
              <td style={{ maxWidth: 360 }}>
                <div>{r.productName} <span className="muted">{r.sellerType === 'DIRECT' ? '직판' : r.sellerName ?? ''}</span></div>
                <div>{'★'.repeat(r.rating)} <span className="muted">{r.writer} · {ymdhm(r.createdAt)}</span></div>
                <div className="muted">{r.body}</div>
              </td>
              <td>
                {r.reply && <div>{r.reply.kind === 'STAFF' ? '운영' : '판매자'} · {RST_KO[r.reply.state] ?? r.reply.state}{r.reply.editCount ? ` · 고침 ${r.reply.editCount}번` : ''}
                  {r.reply.holdWord ? <span className="warn-text"> · 걸린 말 「{r.reply.holdWord}」</span> : null}
                  {r.reply.hiddenReason ? <span className="muted"> · 사유 {r.reply.hiddenReason}</span> : null}
                  <div>{r.reply.body}</div></div>}
                {(r.sellerType === 'DIRECT' && r.reply?.state !== 'HIDDEN') && (
                  <textarea rows={2} cols={50} value={text[r.reviewId] ?? r.reply?.body ?? ''} onChange={(e) => setText({ ...text, [r.reviewId]: e.target.value })}
                    placeholder="운영 답글(2 ~ 1,000자)" aria-label="운영 답글" disabled={!d.on} />
                )}
              </td>
              <td>
                {r.sellerType === 'DIRECT' && r.reply?.state !== 'HIDDEN' && d.on && <button className="btn-sm" disabled={a.busy === `w${r.reviewId}`} onClick={() => write(r)} data-smx-reply-write="">{r.reply ? '고치기' : '답글 달기'}</button>}{' '}
                {r.reply && r.reply.state !== 'VISIBLE' && <button className="btn-sm btn-plain" disabled={a.busy === `d${r.reply.id}`} onClick={() => decide(r.reply!, 'SHOW')}>보이기</button>}{' '}
                {r.reply && r.reply.state !== 'HIDDEN' && <button className="btn-sm btn-plain" disabled={a.busy === `d${r.reply.id}`} onClick={() => decide(r.reply!, 'HIDE')}>가리기</button>}{' '}
                {r.reply && r.reply.editCount > 0 && <button className="btn-sm btn-plain" onClick={() => void showEdits(r.reply!)}>기록</button>}
              </td>
            </tr>))}
            {d.items.length === 0 && <tr><td colSpan={3} className="muted">없습니다.</td></tr>}
          </tbody></table>
      )}
    </section>
  );
}

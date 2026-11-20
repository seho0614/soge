/**
 * v10.537 (D282 · docs/675) 휴대폰 재고 실사 — 소개몰 › 휴대폰 실사 · SB-ADM-DTX-030
 *   휴대폰 폭(390px)에서 쓰는 한 줄 화면 — 운영 화면 1240px 아래 서랍 메뉴 그대로 · 큰 단추(44px) · 글자 16px 입력(휴대폰 확대 막음)
 *   카메라 읽기: 브라우저 BarcodeDetector(QR · Code128 · EAN 등 지원하는 것만) · 같은 글자는 2.5초 안 다시 안 셈 · 읽으면 짧게 진동
 *     없으면(아이폰 사파리 등) 「손으로 넣기」 칸만 — 블루투스 리더기도 글자 입력처럼 들어와 Enter 로 셈
 *     카메라는 https(운영 화면 주소)에서만 열림 · 그림은 브라우저 밖으로 보내지 않음(읽은 글자만 서버로)
 *   로트 실사  — 회차 열기 · 읽기(+1 또는 수량 입력) · 여럿이면 고르기 · 줄 고치기 · 닫기 · 차이 조정(SUPER) · 로트 QR 라벨 인쇄
 *   자산 실사  — ㉟ 열린 회차 고르기 · QR 읽기(POST /admin/hrx/stocktakes/{id}/scan 그대로) · 둔 곳
 * 새 npm 없음(QR 그림은 lib/qr.ts) · 글자 12 · 13 · 14 · 16 · 20px · 모서리 var(--r-sm) · var(--r-md) · # 색 없음(다크 모드 토큰 그대로)
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';
import { qrSvg } from '../../lib/qr';
import { openPrint } from '../../lib/printDoc';

const BIG = { minHeight: 44, fontSize: 16, padding: '8px 14px' } as const;
const INPUT = { fontSize: 16, minHeight: 44, padding: '6px 10px', width: '100%', boxSizing: 'border-box' as const, borderRadius: 'var(--r-sm)' };
const isSuper = () => tokenRoles().includes('SUPER');
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const WANT = ['qr_code', 'code_128', 'ean_13', 'ean_8', 'code_39', 'upc_a', 'data_matrix'];

/** 카메라로 바코드 · QR 읽기 — BarcodeDetector 가 있을 때만 · 계속 읽기(같은 글자 2.5초 안 무시) */
export function CameraScan({ onCode, paused }: { onCode: (code: string) => void; paused?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [on, setOn] = useState(false);
  const [err, setErr] = useState('');
  const last = useRef<{ c: string; t: number }>({ c: '', t: 0 });
  const pausedRef = useRef(!!paused);
  pausedRef.current = !!paused;
  const cb = useRef(onCode);   // 화면이 다시 그려져도 카메라를 다시 열지 않게 — 늘 마지막 onCode 를 부름
  cb.current = onCode;
  const has = typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;
  useEffect(() => {
    if (!on || !video.current) return;
    let stop = false; let stream: MediaStream | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Det = (window as any).BarcodeDetector;
    void (async () => {
      try {
        const sup: string[] = typeof Det.getSupportedFormats === 'function' ? await Det.getSupportedFormats() : WANT;
        const formats = WANT.filter((f) => sup.includes(f));
        const det = new Det(formats.length ? { formats } : undefined);
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (stop) { stream.getTracks().forEach((t) => t.stop()); return; }
        video.current!.srcObject = stream; await video.current!.play();
        while (!stop) {
          if (!pausedRef.current) {
            const r = await det.detect(video.current!).catch(() => []);
            const c = r?.[0]?.rawValue ? String(r[0].rawValue).trim() : '';
            const now = Date.now();
            if (c && (c !== last.current.c || now - last.current.t > 2500)) {
              last.current = { c, t: now };
              try { navigator.vibrate?.(60); } catch { /* 진동 없음 */ }
              cb.current(c);
            }
          }
          await new Promise((ok) => setTimeout(ok, 250));
        }
      } catch (e) {
        setErr(e instanceof Error && e.name === 'NotAllowedError' ? '카메라 권한이 거절되었습니다 — 브라우저 설정에서 허용하거나 손으로 넣으십시오.' : '카메라를 열지 못했습니다(https 주소 · 다른 앱이 카메라를 쓰는지 확인) — 손으로 넣으십시오.');
        setOn(false);
      }
    })();
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [on]);
  if (!has) return <p className="muted" data-scan-nocam="">이 브라우저는 카메라 읽기(BarcodeDetector)를 지원하지 않습니다 — 아래 칸에 손으로 넣거나 리더기로 읽으십시오.</p>;
  return (
    <div data-scan-cam={on ? 'on' : 'off'}>
      {on && <video ref={video} muted playsInline style={{ width: '100%', maxWidth: 480, borderRadius: 'var(--r-md)', display: 'block', marginBottom: 8 }} />}
      <button className={on ? 'btn-plain' : 'btn-ok'} style={BIG} onClick={() => { setErr(''); setOn(!on); }} data-scan-toggle="">{on ? '카메라 끄기' : '카메라로 읽기'}</button>
      {err && <p className="muted">{err}</p>}
    </div>
  );
}

/** 손 입력 · 리더기 칸 — Enter 로 보냄 · 보낸 뒤 비우고 다시 초점 */
function ManualInput({ onCode, placeholder }: { onCode: (code: string) => void; placeholder: string }) {
  const [v, setV] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const send = () => { const c = v.trim(); if (!c) return; onCode(c); setV(''); ref.current?.focus(); };
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
      <input ref={ref} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); }} placeholder={placeholder}
             autoCapitalize="characters" autoCorrect="off" spellCheck={false} inputMode="text" style={INPUT} aria-label="읽은 글자" data-scan-input="" />
      <button className="btn-ok" style={BIG} disabled={!v.trim()} onClick={send} data-scan-send="">넣기</button>
    </div>
  );
}

export function MobileScan() {
  const [mode, setMode] = useState<'LOT' | 'ASSET'>('LOT');
  return (
    <section data-mobile-scan={mode} style={{ maxWidth: 640 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button className={mode === 'LOT' ? 'btn-ok' : 'btn-plain'} style={{ ...BIG, flex: 1 }} onClick={() => setMode('LOT')} data-scan-mode="LOT">로트 재고 실사</button>
        <button className={mode === 'ASSET' ? 'btn-ok' : 'btn-plain'} style={{ ...BIG, flex: 1 }} onClick={() => setMode('ASSET')} data-scan-mode="ASSET">자산 실사</button>
      </div>
      {mode === 'LOT' ? <LotScan /> : <AssetScan />}
    </section>
  );
}

/* ── 로트 실사 ── */
interface CntRow { id: string; title: string; state: string; createdAt: string; closedAt: string | null; total: number; counted: number; diffs: number; adjusted: number }
interface CntLine { lotId: string; code: string; lotNo: string; name: string; label: string; expiresOn: string; expected: number; counted: number | null; bookQty: number | null; nowQty: number | null; diff: number | null; note: string | null; addedLate: boolean; adjustedAt: string | null; barcode: string | null }
interface CntOne { count: { id: string; title: string; state: string }; lines: CntLine[]; counts: { total: number; counted: number; pending: number; diffs: number; adjusted: number }; adjustable: number }
interface Cand { lotId: string; lotNo: string; name: string; label: string; expiresOn: string }
interface ScanRes { ok: boolean; matched: boolean; candidates?: Cand[]; name?: string; lotNo?: string; counted?: number; note: string }

function LotScan() {
  const q = useApi<{ items: CntRow[]; openId: string | null; lotsWithStock: number; note: string }>('/admin/qlt/lot-counts');
  const a = useAct();
  const [sel, setSel] = useState('');
  const id = sel || q.data?.openId || '';
  const one = useApi<CntOne | null>(id ? `/admin/qlt/lot-counts/${id}` : '/admin/qlt/lot-counts', [id]);
  const [title, setTitle] = useState('');
  const [qtyMode, setQtyMode] = useState(false);
  const [qty, setQty] = useState('');
  const [lastRes, setLastRes] = useState<ScanRes | null>(null);
  const [cands, setCands] = useState<Cand[]>([]);
  const [busy, setBusy] = useState(false);
  const d = id && one.data && 'count' in one.data ? one.data : null;
  const open = d?.count.state === 'OPEN';
  const reload = () => { q.reload(); one.reload(); };

  const send = useCallback((code: string) => {
    if (!id || busy) return;
    const counted = qtyMode && qty.trim() !== '' ? Number(qty) : undefined;
    setBusy(true);
    void a.run('scan', () => api<ScanRes>(`/admin/qlt/lot-counts/${id}/scan`, { method: 'POST', body: JSON.stringify(counted !== undefined ? { code, counted } : { code }) }), undefined, (r) => {
      setLastRes(r ?? null); setCands(r && !r.matched ? r.candidates ?? [] : []);
      if (r?.matched) { one.reload(); setQty(''); }
      return r?.note ?? '';
    }).finally(() => setBusy(false));
  }, [id, busy, qtyMode, qty, a, one]);

  const openCount = () => void a.run('open', () => api<{ id: string }>('/admin/qlt/lot-counts', { method: 'POST', body: JSON.stringify({ title }) }), () => { setTitle(''); setSel(''); reload(); });
  const fix = (l: CntLine) => {
    const v = prompt(`${l.name} · 로트 ${l.lotNo} — 센 수(비우면 세지 않음으로)`, l.counted == null ? '' : String(l.counted));
    if (v == null) return;
    const body = v.trim() === '' ? { reset: true } : { counted: Number(v) };
    void a.run(`fix${l.lotId}`, () => api(`/admin/qlt/lot-counts/${id}/lines/${l.lotId}`, { method: 'PUT', body: JSON.stringify(body) }), one.reload);
  };
  const close = () => {
    const pend = d?.counts.pending ?? 0;
    if (!confirm(pend ? `세지 않은 로트 ${pend}개가 있습니다. 그대로 두고 닫을까요?(차이 셈에서 빠짐) 닫으면 고칠 수 없습니다.` : '실사를 닫을까요? 닫으면 고칠 수 없습니다.')) return;
    void a.run('close', () => api(`/admin/qlt/lot-counts/${id}/close`, { method: 'POST', body: JSON.stringify({ skipUncounted: pend > 0 }) }), reload);
  };
  const adjust = (l: CntLine) => {
    const reason = prompt(`${l.name} · 로트 ${l.lotNo} 차이 ${l.diff! > 0 ? '+' : ''}${l.diff}개를 원가 장부에 조정합니다. 사유(2자 이상)`);
    if (!reason || reason.trim().length < 2) return;
    void a.run(`adj${l.lotId}`, () => api(`/admin/qlt/lot-counts/${id}/lines/${l.lotId}/adjust`, { method: 'POST', body: JSON.stringify({ reason }) }), reload);
  };
  const labels = () => {
    const xs = (d?.lines ?? []);
    if (!xs.length) return;
    const ok = openPrint({ title: '로트 QR 라벨', body: `<div style="display:flex;flex-wrap:wrap;gap:10px">${xs.map((l) =>
      `<div style="border:1px dashed gray;padding:6px;width:150px;text-align:center;font-size:12px">${qrSvg(l.code, 3, 2)}<br/><b>${esc(l.code)}</b><br/>${esc(l.name)} ${esc(l.label ?? '')}<br/>로트 ${esc(l.lotNo)} · ~${esc(l.expiresOn)}</div>`).join('')}</div>` });
    if (!ok) a.setErr('새 창이 막혔습니다 — 팝업을 허용하십시오.');
  };

  return (
    <div data-lot-scan={id}>
      <Flash msg={a.msg} err={a.err} />
      {!q.data?.openId && (
        <div className="card pad" data-lot-open="">
          <b>로트 실사 열기</b> <small className="dim">남은 수량이 있는 로트 {q.data?.lotsWithStock ?? '—'}개가 들어갑니다.</small>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="회차 이름(예: 11월 창고)" style={INPUT} aria-label="회차 이름" />
            <button className="btn-ok" style={BIG} disabled={title.trim().length < 2 || a.busy === 'open'} onClick={openCount} data-lot-open-go="">열기</button>
          </div>
        </div>
      )}
      {(q.data?.items.length ?? 0) > 0 && (
        <select value={id} onChange={(e) => setSel(e.target.value)} style={{ ...INPUT, marginBottom: 8 }} aria-label="회차 고르기" data-lot-pick="">
          {q.data!.items.map((c) => <option key={c.id} value={c.id}>#{c.id} {c.title} · {c.state === 'OPEN' ? '여는 중' : '닫음'} · {c.counted}/{c.total}</option>)}
        </select>
      )}
      {d && open && (
        <div className="card pad" data-lot-scanbox="">
          <div style={{ fontSize: 14, marginBottom: 8 }}><b>{d.count.title}</b> · 센 로트 {d.counts.counted} / {d.counts.total} · 차이 {d.counts.diffs}</div>
          <CameraScan onCode={send} paused={busy || cands.length > 0} />
          <ManualInput onCode={send} placeholder="SGB-LOT-000123 · 로트 번호 · 바코드" />
          <label style={{ display: 'block', marginTop: 8, fontSize: 14 }}>
            <input type="checkbox" checked={qtyMode} onChange={(e) => setQtyMode(e.target.checked)} data-lot-qtymode="" /> 수량 넣고 읽기(끄면 한 번 읽을 때 +1)
          </label>
          {qtyMode && <input value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" placeholder="센 수" style={{ ...INPUT, marginTop: 8 }} aria-label="센 수" data-lot-qty="" />}
          {lastRes?.matched && <p style={{ fontSize: 20, margin: '8px 0' }} data-lot-last={lastRes.counted}><b>{lastRes.counted}</b> · {lastRes.name} · 로트 {lastRes.lotNo}</p>}
          {cands.length > 0 && (
            <div data-lot-cands={cands.length}>
              <p className="muted">{lastRes?.note}</p>
              {cands.map((c) => (
                <button key={c.lotId} className="btn-plain" style={{ ...BIG, display: 'block', width: '100%', textAlign: 'left', marginBottom: 6 }}
                        onClick={() => { setCands([]); send(`SGB-LOT-${c.lotId.padStart(6, '0')}`); }} data-lot-cand={c.lotId}>
                  {c.name} {c.label} · 로트 {c.lotNo} · ~{c.expiresOn}
                </button>
              ))}
              <button className="btn-sm btn-plain" onClick={() => setCands([])}>고르지 않음</button>
            </div>
          )}
        </div>
      )}
      {d && (
        <div className="card pad" data-lot-lines={d.lines.length}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
            <b>{d.count.title}</b> <small className="dim">{d.count.state === 'OPEN' ? '여는 중' : '닫음'} · 세지 않음 {d.counts.pending} · 차이 {d.counts.diffs} · 조정 {d.counts.adjusted}</small>
            <button className="btn-sm btn-plain" onClick={labels} data-lot-labels="">QR 라벨 인쇄</button>
            {open && <button className="btn-sm" disabled={a.busy === 'close'} onClick={close} data-lot-close="">닫기</button>}
          </div>
          {d.lines.map((l) => (
            <div key={l.lotId} style={{ borderTop: '1px solid var(--line)', padding: '8px 0', fontSize: 14 }} data-lot-line={l.lotId} data-lot-diff={l.diff ?? ''}>
              <div><b>{l.name}</b> {l.label} <small className="dim">로트 {l.lotNo} · ~{l.expiresOn}{l.addedLate ? ' · 늦게 더함' : ''}</small></div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span>열 때 {l.expected}</span>
                <span>센 수 <b>{l.counted ?? '—'}</b></span>
                {l.diff != null && <span className={l.diff === 0 ? 'dim' : 'pill-danger'} style={{ fontSize: 12, padding: '1px 7px', borderRadius: 'var(--r-sm)' }}>차이 {l.diff > 0 ? '+' : ''}{l.diff}</span>}
                {open && <button className="btn-sm btn-plain" onClick={() => fix(l)} data-lot-fix={l.lotId}>고치기</button>}
                {!open && isSuper() && l.diff != null && l.diff !== 0 && !l.adjustedAt && <button className="btn-sm" onClick={() => adjust(l)} data-lot-adjust={l.lotId}>차이 조정</button>}
                {l.adjustedAt && <small className="dim">조정 {ymdhm(l.adjustedAt)}</small>}
              </div>
            </div>
          ))}
        </div>
      )}
      {q.data && <p className="muted">{q.data.note}</p>}
    </div>
  );
}

/* ── 자산 실사(㉟ API 그대로) ── */
interface StRow { id: string; title: string; asOf: string; state: string; total: number; found: number; missing: number; pending: number }
interface StOne { stocktake: { id: string; title: string; state: string }; counts: { total: number; found: number; missing: number; pending: number } }

function AssetScan() {
  const q = useApi<{ items: StRow[] }>('/admin/hrx/stocktakes');
  const a = useAct();
  const opens = (q.data?.items ?? []).filter((x) => x.state === 'OPEN');
  const [sel, setSel] = useState('');
  const id = sel || opens[0]?.id || '';
  const one = useApi<StOne | null>(id ? `/admin/hrx/stocktakes/${id}` : '/admin/hrx/stocktakes', [id]);
  const [loc, setLoc] = useState('');
  const [last, setLast] = useState('');
  const [busy, setBusy] = useState(false);
  const d = id && one.data && 'stocktake' in one.data ? one.data : null;
  const send = useCallback((code: string) => {
    if (!id || busy) return;
    setBusy(true);
    void a.run('scan', () => api<{ name: string; code: string; again: boolean; note: string }>(`/admin/hrx/stocktakes/${id}/scan`, { method: 'POST', body: JSON.stringify(loc.trim() ? { code, location: loc.trim() } : { code }) }),
      undefined, (r) => { setLast(r ? `${r.code} · ${r.name}${r.again ? ' (이미 찾음)' : ''}` : ''); one.reload(); return r?.note ?? ''; })
      .finally(() => setBusy(false));
  }, [id, busy, loc, a, one]);
  if (q.error) return <p className="muted">자산 실사를 볼 권한이 없습니다(회계 › 자산 실사 — ADMIN · 지급 담당).</p>;
  return (
    <div data-asset-scan={id}>
      <Flash msg={a.msg} err={a.err} />
      {!opens.length && <div className="card pad">열린 자산 실사 회차가 없습니다 — 회계 › 매입 · 경비 › 자산 실사에서 회차를 연 뒤 휴대폰으로 읽습니다.</div>}
      {opens.length > 1 && (
        <select value={id} onChange={(e) => setSel(e.target.value)} style={{ ...INPUT, marginBottom: 8 }} aria-label="자산 실사 회차" data-asset-pick="">
          {opens.map((s) => <option key={s.id} value={s.id}>#{s.id} {s.title} · {s.found}/{s.total}</option>)}
        </select>
      )}
      {d && (
        <div className="card pad" data-asset-scanbox="">
          <div style={{ fontSize: 14, marginBottom: 8 }}><b>{d.stocktake.title}</b> · 찾음 {d.counts.found} / {d.counts.total} · 확인 전 {d.counts.pending}</div>
          <input value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="둔 곳(선택 · 예: 3층 회의실) — 읽을 때마다 함께 적음" style={{ ...INPUT, marginBottom: 8 }} aria-label="둔 곳" data-asset-loc="" />
          <CameraScan onCode={send} paused={busy} />
          <ManualInput onCode={send} placeholder="SGB-AST-000123 · 자산 번호" />
          {last && <p style={{ fontSize: 20, margin: '8px 0' }} data-asset-last="">{last}</p>}
          <p className="muted">없음 · 메모 · 닫기 · 처분은 회계 › 자산 실사 화면에서 합니다.</p>
        </div>
      )}
    </div>
  );
}

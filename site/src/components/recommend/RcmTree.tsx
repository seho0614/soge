'use client';
/**
 * v10.254 (docs/388) — 추천 관계도 그림 ↔ 목록(나의공간 · 파트너센터 같은 부품)
 *
 *   그림: 위에서 아래로 상자와 선 · 확대 · 축소 · 끌기 · 이름 찾기 · 상자를 누르면 펴고 접기 · 모두 펴기 / 접기.
 *   목록: 들여쓰기 목록(접고 펴기). 휴대폰 폭 · 300명 넘으면 목록으로 먼저 보이고, 그림은 3번째 줄까지 펴 둠.
 *   새 프로그램 묶음 없이 SVG 로 직접 그립니다. 글자는 모두 서버 화면이 사전에서 넘겨 줌(L) — 이 파일에 한국어 없음.
 *   보이는 것은 서버가 준 것뿐(가린 이름 · 날짜 · 그분이 추천한 수) — 실적 · 금액 · 연락처 · 회원 번호 없음.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

export interface RcmNode { k: number; p: number; gen: number; name: string | null; joined: string; children: number }
export interface RcmLabels {
  graph: string; list: string; expandAll: string; collapseAll: string; search: string; zoomIn: string; zoomOut: string; fit: string;
  me: string; joinedDay: string; joinedMonth: string; theirs: string; left: string; noMatch: string; found: string;
}

const W = 132, H = 48, GX = 16, GY = 46;
const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_m, k) => String(v[k] ?? ''));

export function RcmTree({ rootName, nodes, L }: { rootName: string; nodes: RcmNode[]; L: RcmLabels }) {
  const kids = useMemo(() => {
    const m = new Map<number, RcmNode[]>();
    for (const n of nodes) m.set(n.p, [...(m.get(n.p) ?? []), n]);
    return m;
  }, [nodes]);
  const byK = useMemo(() => new Map(nodes.map((n) => [n.k, n])), [nodes]);
  const [mode, setMode] = useState<'graph' | 'list'>('graph');
  const [open, setOpen] = useState<Set<number>>(() => new Set([0, ...nodes.filter((n) => n.gen <= 2 && n.children > 0).map((n) => n.k)]));
  const [q, setQ] = useState('');
  const [hit, setHit] = useState<number[]>([]);
  const [view, setView] = useState({ x: 20, y: 20, s: 1 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  /* 휴대폰 폭 · 사람이 많으면 목록으로 먼저 */
  useEffect(() => { if (nodes.length > 300 || window.innerWidth < 640) setMode('list'); }, [nodes.length]);

  /* 그림 자리 — 펼친 것만 · 잎은 한 칸 · 부모는 자식 가운데 */
  const layout = useMemo(() => {
    const pos = new Map<number, { x: number; y: number }>();
    let col = 0;
    const walk = (k: number, d: number): number => {
      const cs = open.has(k) ? kids.get(k) ?? [] : [];
      let x: number;
      if (!cs.length) { x = col * (W + GX); col += 1; }
      else { const xs = cs.map((c) => walk(c.k, d + 1)); x = (xs[0]! + xs[xs.length - 1]!) / 2; }
      pos.set(k, { x, y: d * (H + GY) });
      return x;
    };
    walk(0, 0);
    let maxY = 0;
    for (const v of pos.values()) maxY = Math.max(maxY, v.y);
    return { pos, w: Math.max(1, col) * (W + GX), h: maxY + H };
  }, [open, kids]);

  const fit = () => {
    const el = box.current;
    if (!el) return;
    const s = Math.min(1, Math.max(0.2, Math.min((el.clientWidth - 40) / layout.w, (el.clientHeight - 40) / layout.h)));
    setView({ x: 20, y: 20, s });
  };
  const centerOn = (k: number) => {
    const el = box.current, p = layout.pos.get(k);
    if (!el || !p) return;
    setView((v) => ({ ...v, x: el.clientWidth / 2 - (p.x + W / 2) * v.s, y: el.clientHeight / 3 - p.y * v.s }));
  };

  const toggle = (k: number) => setOpen((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const all = (on: boolean) => setOpen(on ? new Set([0, ...nodes.filter((n) => n.children > 0).map((n) => n.k)]) : new Set([0]));
  const find = () => {
    const t = q.trim();
    if (!t) { setHit([]); return; }
    const hs = nodes.filter((n) => (n.name ?? '').includes(t)).map((n) => n.k);
    setHit(hs);
    if (!hs.length) return;
    setOpen((o) => {
      const n = new Set(o);
      for (const h of hs) { let c = byK.get(h); while (c && c.p !== 0) { n.add(c.p); c = byK.get(c.p); } }
      n.add(0);
      return n;
    });
    setTimeout(() => centerOn(hs[0]!), 0);
  };
  const label = (n: RcmNode) => fill(n.gen === 1 ? L.joinedDay : L.joinedMonth, { d: n.joined });

  const branch = (pk: number) => {
    const list = kids.get(pk) ?? [];
    if (!list.length) return null;
    return (
      <ul className="rcm-ul">
        {list.map((n) => (
          <li key={n.k} data-rcm-gen={n.gen} className={hit.includes(n.k) ? 'rcm-hit' : undefined}>
            {n.children > 0 ? (
              <details open={open.has(n.k)} onToggle={(e) => { const o = (e.target as HTMLDetailsElement).open; if (o !== open.has(n.k)) toggle(n.k); }}>
                <summary><b>{n.name ?? L.left}</b> <span className="dim">{label(n)}</span> <span className="state">{fill(L.theirs, { n: n.children })}</span></summary>
                {open.has(n.k) && branch(n.k)}
              </details>
            ) : (
              <span className="rcm-leaf"><b>{n.name ?? L.left}</b> <span className="dim">{label(n)}</span></span>
            )}
          </li>
        ))}
      </ul>
    );
  };

  const lines: Array<[number, number, number, number]> = [];
  for (const [k, p] of layout.pos) {
    if (k === 0) continue;
    const n = byK.get(k), pp = n ? layout.pos.get(n.p) : null;
    if (pp) lines.push([pp.x + W / 2, pp.y + H, p.x + W / 2, p.y]);
  }

  return (
    <div className="rcm-box" data-rcm-tree={mode} data-rcm-nodes={nodes.length}>
      <div className="rcm-bar">
        <span className="rcm-seg">
          <button type="button" className={mode === 'graph' ? 'on' : undefined} onClick={() => setMode('graph')} data-rcm-mode="graph">{L.graph}</button>
          <button type="button" className={mode === 'list' ? 'on' : undefined} onClick={() => setMode('list')} data-rcm-mode="list">{L.list}</button>
        </span>
        <button type="button" onClick={() => all(true)} data-rcm-all="open">{L.expandAll}</button>
        <button type="button" onClick={() => all(false)} data-rcm-all="close">{L.collapseAll}</button>
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') find(); }} placeholder={L.search} aria-label={L.search} data-rcm-search="" />
        <button type="button" onClick={find} data-rcm-find="">{L.search}</button>
        {q.trim() && <span className="dim" data-rcm-hits={hit.length}>{hit.length ? fill(L.found, { n: hit.length }) : L.noMatch}</span>}
        {mode === 'graph' && <>
          <button type="button" onClick={() => setView((v) => ({ ...v, s: Math.min(2, v.s * 1.25) }))} aria-label={L.zoomIn} data-rcm-zoom="in">＋</button>
          <button type="button" onClick={() => setView((v) => ({ ...v, s: Math.max(0.2, v.s / 1.25) }))} aria-label={L.zoomOut} data-rcm-zoom="out">－</button>
          <button type="button" onClick={fit} data-rcm-fit="">{L.fit}</button>
        </>}
      </div>

      {mode === 'list' ? (
        <div className="card p2pad rcm-tree">
          <div><b>{rootName}</b> <span className="dim">({L.me})</span></div>
          {branch(0)}
        </div>
      ) : (
        <div ref={box} className="rcm-canvas"
             onPointerDown={(e) => { if ((e.target as Element).closest('[data-rcm-node]')) return; drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId); }}
             onPointerMove={(e) => { const d = drag.current; if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y })); }}
             onPointerUp={() => { drag.current = null; }}
             onWheel={(e) => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); setView((v) => ({ ...v, s: Math.min(2, Math.max(0.2, v.s * (e.deltaY < 0 ? 1.1 : 0.9))) })); }}>
          <svg width="100%" height="100%" role="img" aria-label={L.graph}>
            <g transform={`translate(${view.x},${view.y}) scale(${view.s})`}>
              {lines.map(([x1, y1, x2, y2], i) => {
                const my = (y1 + y2) / 2;
                return <path key={i} d={`M${x1},${y1} V${my} H${x2} V${y2}`} className="rcm-ln" />;
              })}
              {[...layout.pos].map(([k, p]) => {
                const n = k === 0 ? null : byK.get(k)!;
                const closed = !!n && n.children > 0 && !open.has(k);
                return (
                  <g key={k} transform={`translate(${p.x},${p.y})`} className={`rcm-nd${k === 0 ? ' me' : ''}${hit.includes(k) ? ' hit' : ''}`}
                     data-rcm-node={k} data-rcm-gen={n?.gen ?? 0} onClick={() => { if (n && n.children > 0) toggle(k); }} style={{ cursor: n && n.children > 0 ? 'pointer' : 'default' }}>
                    <rect width={W} height={H} rx={9} />
                    <text x={W / 2} y={19} textAnchor="middle" className="t1">{k === 0 ? rootName : n!.name ?? L.left}</text>
                    <text x={W / 2} y={36} textAnchor="middle" className="t2">{k === 0 ? L.me : label(n!)}</text>
                    {n && n.children > 0 && <text x={W - 8} y={14} textAnchor="end" className="t3">{closed ? `+${n.children}` : '−'}</text>}
                  </g>
                );
              })}
            </g>
          </svg>
          {/* 화면 읽기 프로그램용 — 그림과 같은 사람을 글로(보이지 않음) */}
          <ul className="sr-only" data-rcm-sr="">
            {nodes.map((n) => <li key={n.k}>{n.name ?? L.left} · {label(n)}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

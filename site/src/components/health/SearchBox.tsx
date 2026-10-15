'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type Sug = { word: string; kind: string; code: string };

/**
 * 검색 칸 + 자동완성 — 시안 SB-HLT-CAT-020 (hltSugBind) · v10.26.
 *
 * 제안은 서버가 줍니다(GET /health/suggest?q=) — 성분 이름 + **상품 이름**(시안 글 그대로 · 시안 코드의 오타로 상품이 빠지던 것을 바르게) ·
 * **살 수 있는 것만** · 앞에서부터 맞는 말이 먼저 · 8줄까지.
 * 시안과 다른 곳(10/8 확인 B-11): 제안을 고르면 칸에 넣기만 하지 않고 **바로 검색**합니다.
 * 키보드 — ↑ ↓ 로 고르고 Enter 로 검색 · Esc 로 닫기. 고른 줄이 없을 때 Enter 는 친 말 그대로 검색합니다.
 * v10.31 (시안 기준) — 시안 배치: 「검색어」 이름표 + 넓은 칸(최대 520) → 아래 「검색 · 초기화」 단추. 초기화는 늘 보이고 칸을 비운 뒤 검색 첫 화면으로.
 */
export function SearchBox({ q }: { q: string }) {
  const router = useRouter();
  const [v, setV] = useState(q);
  const [list, setList] = useState<Sug[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const kw = v.trim();
    if (!kw || kw === q) { setList([]); return; }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/v1/health/suggest?q=${encodeURIComponent(kw)}`, { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : []))
        .then((d: Sug[]) => { setList(Array.isArray(d) ? d.slice(0, 8) : []); setActive(-1); setOpen(true); })
        .catch(() => { /* 제안이 안 와도 검색은 됩니다 */ });
    }, 150);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [v, q]);

  /* 바깥을 누르면 닫음 — 'click' 이 아니라 'pointerdown' 입니다. 칸에서 Enter 를 치면 브라우저가 검색 단추의 click 을 만들어 내는데,
   * 'click' 으로 닫으면 그 click 이 목록을 먼저 닫아 고른 제안 대신 친 글자로 검색됐습니다(시험 W-13 이 잡음). */
  useEffect(() => {
    const close = (e: PointerEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  function go(word: string) {
    setV(word); setOpen(false);
    router.push(`/health/search?q=${encodeURIComponent(word)}`);
  }

  const shown = open && list.length > 0;

  return (
    <form className="hlt-sform" action="/health/search" role="search"
      onSubmit={(e) => { if (shown && active >= 0) { e.preventDefault(); go(list[active]!.word); } }}>
      <label htmlFor="qInput" className="hlt-sform-l">검색어</label>
      <div className="hlt-acwrap" ref={wrap}>
        <input id="qInput" name="q" type="search" value={v} autoComplete="off" placeholder="성분 · 상품명" aria-label="검색어"
          role="combobox" aria-expanded={shown} aria-controls="hltSug" aria-autocomplete="list"
          aria-activedescendant={shown && active >= 0 ? `hltSug-${active}` : undefined}
          onChange={(e) => setV(e.target.value)}
          onFocus={() => list.length && setOpen(true)}
          onKeyDown={(e) => {
            if (!shown) return;
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % list.length); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + list.length) % list.length); }
            else if (e.key === 'Escape') { setOpen(false); }
          }} />
        {shown && (
          <ul id="hltSug" className="hlt-ac" role="listbox" data-suggest>
            {list.map((s, i) => (
              <li key={`${s.kind}-${s.code}`} id={`hltSug-${i}`} role="option" aria-selected={i === active}
                data-hsug={s.word} onMouseDown={(e) => { e.preventDefault(); go(s.word); }}>
                <span>🔍 {s.word}</span><span className="k">{s.kind}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="hlt-btns">
        <button className="hlt-btn pri">검색</button>
        <button type="button" className="hlt-btn" data-search-reset=""
          onClick={() => { setV(''); setList([]); setOpen(false); router.push('/health/search'); }}>초기화</button>
      </div>
    </form>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * v10.47 (D100 · docs/98) — 맛집 소개 글 쓰기 (SB-HOM-CMU-052)
 *
 *   ① 가게 찾기  GET /me/community/food/search?q= — 서버가 카카오를 대신 부름 · 음식점 · 카페만 · 1분 30회
 *   ② 고르기     찾은 결과에서 하나(서버가 10분 동안 기억 — 고른 가게가 그 결과에 있어야 저장됨)
 *   ③ 글         제목 · 소개 · 추천 메뉴(선택) · 광고 · 협찬 여부(대가를 받았으면 반드시)
 *   ④ 저장       POST /me/community/food → 가게 화면으로(첫 글이면 「확인 후 올라갑니다」)
 */

interface Found { kakaoId: string; name: string; category: string | null; address: string | null }

export function FoodWriteForm({ preset }: { preset: { kakaoId: string; name: string } | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pick, setPick] = useState<Found | null>(preset ? { kakaoId: preset.kakaoId, name: preset.name, category: null, address: null } : null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [menu, setMenu] = useState('');
  const [sponsored, setSponsored] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    const k = q.trim();
    if ([...k].length < 2) { setNote('가게 이름을 두 글자 이상 넣으십시오.'); return; }
    setBusy(true); setNote(null); setErr(null);
    try {
      const r = await fetch(`/api/v1/me/community/food/search?q=${encodeURIComponent(k)}`, { headers: { Accept: 'application/json' } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setFound([]); setNote(d.message ?? '가게를 찾지 못했습니다.'); return; }
      setFound(d.items ?? []);
      setNote(d.note ?? ((d.items ?? []).length === 0 ? '찾은 가게가 없습니다. 이름을 바꾸거나 동네 이름을 함께 넣어 보십시오 — 예) 정자동 칼국수' : null));
    } catch { setNote('가게를 찾지 못했습니다. 잠시 후 다시 해 주십시오.'); }
    finally { setBusy(false); }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!pick) { setErr('가게를 먼저 찾아 고르십시오.'); return; }
    if (title.trim().length < 2) { setErr('제목을 두 글자 이상 쓰십시오.'); return; }
    if (body.trim().length < 10) { setErr('소개를 열 자 이상 쓰십시오.'); return; }
    start(async () => {
      const r = await fetch('/api/v1/me/community/food', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kakaoPlaceId: pick.kakaoId, title: title.trim(), body: body.trim(), menu: menu.trim() || undefined, sponsored }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.message ?? '저장하지 못했습니다.'); return; }
      router.push(`/community/food/${d.placeId}?posted=${d.state === 'PENDING' ? 'wait' : '1'}`);
    });
  }

  return (
    <div className="fd-form">
      {pick ? (
        <div className="fd-pick" data-food-pick>
          <b>{pick.name}</b>{pick.address && <span className="dim"> · {pick.address}</span>}
          {!preset && <> <button type="button" className="btn-sm" onClick={() => { setPick(null); }}>다른 가게 고르기</button></>}
        </div>
      ) : (
        <>
          <form className="fd-bar" onSubmit={search} role="search" aria-label="가게 찾기">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="가게 이름 — 예) 정자동 칼국수" aria-label="가게 이름" maxLength={40} autoFocus />
            <button type="submit" disabled={busy}>{busy ? '찾는 중…' : '가게 찾기'}</button>
          </form>
          {found && found.length > 0 && (
            <ul className="fd-res" aria-label="찾은 가게">
              {found.map((f) => (
                <li key={f.kakaoId}>
                  <button type="button" onClick={() => setPick(f)}>
                    <div className="fd-nm">{f.name}</div>
                    <div className="fd-sub">{[f.category?.split('>').pop()?.trim(), f.address].filter(Boolean).join(' · ')}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {note && <p className="fd-note" role="status">{note}</p>}
        </>
      )}

      <form className="fd-form" onSubmit={submit}>
        <label>제목<input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} placeholder="예) 점심에 줄 서는 칼국수집" /></label>
        <label>소개<textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={3000} placeholder="직접 먹어 본 것 · 분위기 · 기다리는 시간처럼 이웃에게 도움이 되는 이야기를 열 자 이상 써 주십시오." /></label>
        <label>추천 메뉴 <span className="dim">(선택)</span><input type="text" value={menu} onChange={(e) => setMenu(e.target.value)} maxLength={60} placeholder="예) 바지락 칼국수" /></label>
        <label className="fd-chk"><input type="checkbox" checked={sponsored} onChange={(e) => setSponsored(e.target.checked)} />
          <span><b>광고 · 협찬입니다</b> — 가게에서 무료 음식 · 할인 · 돈을 받고 쓰는 글이면 반드시 체크하십시오. 글에 「광고 · 협찬」이 표시됩니다.</span></label>
        <div className="notice warn">
          <b>첫 글은 확인 후 올라갑니다.</b> 가입 7일이 안 되셨으면 링크를 넣으실 수 없습니다. 하루에 5개까지 쓰실 수 있습니다.
          가게를 깎아내리거나 사실이 아닌 내용은 신고로 가려질 수 있습니다.
        </div>
        {err && <p className="form-error" role="alert">{err}</p>}
        <p><button type="submit" className="fd-cta" disabled={pending}>{pending ? '올리는 중…' : '소개 올리기'}</button></p>
      </form>
    </div>
  );
}

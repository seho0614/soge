/**
 * 주소 검색 (Daum 우편번호 서비스) — 운영 화면용.
 * 사용자 웹 site/src/components/AddressInput.tsx 와 같은 스크립트 · 같은 방식(키 없음 · 누를 때 처음 받음).
 * v10.31 — 시안 「법정 고지」의 「주소 검색」 단추.
 */
const SRC = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
let loading: Promise<void> | null = null;

function load(): Promise<void> {
  const w = window as unknown as { daum?: { Postcode?: unknown } };
  if (w.daum?.Postcode) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = SRC; el.async = true;
    el.onload = () => resolve();
    el.onerror = () => { loading = null; reject(new Error('주소 검색을 불러오지 못했습니다')); };
    document.head.appendChild(el);
  });
  return loading;
}

/** 우편번호 창을 열고, 고른 도로명 주소(건물명 포함)를 돌려줍니다. 닫으면 null */
export async function searchAddress(): Promise<string | null> {
  await load();
  return new Promise((resolve) => {
    const w = window as unknown as { daum: { Postcode: new (o: unknown) => { open: () => void } } };
    let done = false;
    new w.daum.Postcode({
      oncomplete: (d: { roadAddress?: string; address?: string; buildingName?: string; bname?: string }) => {
        done = true;
        const extra = [d.bname, d.buildingName].filter(Boolean).join(', ');
        resolve(`${d.roadAddress || d.address || ''}${extra ? ` (${extra})` : ''}`.trim() || null);
      },
      onclose: () => { if (!done) resolve(null); },
    }).open();
  });
}

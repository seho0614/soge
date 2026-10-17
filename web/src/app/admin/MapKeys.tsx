import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { ymdKst } from '../../lib/format';

/**
 * v10.46 (D099 · docs/96) — 외부 연동 › 카카오맵 키 (SB-ADM-SIT-080 안의 한 구역 · SUPER)
 *
 * ★ 이 화면의 다른 연동과 다릅니다 — 카카오맵 키 2개만 여기서 넣습니다(2026-10-17 대표 결정).
 *   넣은 값은 서버가 **암호화해** 저장하고(정산 계좌와 같은 열쇠) 다시 보여 주지 않습니다 — 끝 4자리만.
 *   결제 · 계좌인증 같은 다른 연동 키는 지금처럼 .env 에만 둡니다.
 *
 * 순서: ① 카카오 콘솔 할 일(docs/96 4절) → ② 키 2개 넣기 → ③ 「시험 호출」 성공 → ④ 「지도 사용」 켜기.
 * 지도 사용이 꺼져 있으면(처음 값) 사용자 화면은 지도 연동 전과 같습니다.
 */

interface KeyState { name: 'KAKAO_REST_KEY' | 'KAKAO_JS_KEY'; source: 'ADMIN' | 'ENV' | 'NONE'; masked: string | null; updatedAt: string | null }
interface MapAdmin { enabled: boolean; keys: KeyState[] }

const LABEL: Record<KeyState['name'], [string, string]> = {
  KAKAO_REST_KEY: ['REST API 키', '서버만 씁니다(주소 → 좌표). 화면 · 응답에 나가지 않습니다.'],
  KAKAO_JS_KEY: ['JavaScript 키', '브라우저가 지도를 그릴 때 씁니다(공개되는 키). 다시 빌드하지 않아도 바로 적용됩니다.'],
};
const SRC: Record<KeyState['source'], string> = { ADMIN: '이 화면에서 넣음', ENV: '.env 값 사용 중', NONE: '없음' };

export function MapKeys() {
  const [d, setD] = useState<MapAdmin | null>(null);
  const [val, setVal] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => api<MapAdmin>('/admin/map').then(setD).catch((e) => setMsg({ ok: false, text: e?.message ?? '불러오지 못했습니다.' }));
  useEffect(() => { void load(); }, []);

  async function run(tag: string, fn: () => Promise<unknown>, okText?: string) {
    setBusy(tag); setMsg(null);
    try { const r = await fn(); if (r && typeof r === 'object' && 'keys' in (r as object)) setD(r as MapAdmin); if (okText) setMsg({ ok: true, text: okText }); }
    catch (e) { setMsg({ ok: false, text: (e as Error)?.message ?? '실패했습니다.' }); }
    finally { setBusy(null); }
  }

  const save = (n: KeyState['name']) => run(n, async () => {
    const v = (val[n] ?? '').trim();
    if (!v) throw new Error('키를 붙여 넣으십시오.');
    const r = await api<MapAdmin>(`/admin/map/keys/${n}`, { method: 'PUT', body: JSON.stringify({ value: v }) });
    setVal((x) => ({ ...x, [n]: '' }));
    return r;
  }, '저장했습니다 — 값은 다시 보이지 않습니다(끝 4자리만).');

  const clear = (n: KeyState['name']) => {
    if (!window.confirm(`${LABEL[n][0]}를 지울까요? 지우면 .env 값을 쓰고, 그것도 없으면 지도가 꺼진 것처럼 동작합니다.`)) return;
    void run(n, () => api<MapAdmin>(`/admin/map/keys/${n}`, { method: 'DELETE' }), '지웠습니다.');
  };

  const test = () => run('_test', async () => {
    const r = await api<{ ok: boolean; message: string }>('/admin/map/test', { method: 'POST' });
    setMsg({ ok: r.ok, text: r.message });
    return null;
  });

  const toggle = (on: boolean) => run('_toggle', () => api<MapAdmin>('/admin/map', { method: 'PATCH', body: JSON.stringify({ enabled: on }) }),
    on ? '지도 사용을 켰습니다 — 사용자 화면에 1분 안에 나타납니다.' : '지도 사용을 껐습니다 — 사용자 화면은 지도 연동 전과 같습니다.');

  if (!d) return msg ? <p className="warn-text" role="alert">{msg.text}</p> : null;
  const restOk = d.keys.some((k) => k.name === 'KAKAO_REST_KEY' && k.source !== 'NONE');
  const jsOk = d.keys.some((k) => k.name === 'KAKAO_JS_KEY' && k.source !== 'NONE');

  return (
    <div data-map-keys>
      <h2 className="ad-s2">카카오맵 키 <small className="dim">v10.46 · 이 두 키만 여기서 넣습니다(암호화 저장)</small></h2>
      <div className="ad-nt info">
        <b>순서</b> ① 카카오 콘솔 — 「카카오맵」 사용 켜기 · 사이트 도메인 등록(docs/96 4절) → ② 키 2개 넣기 → ③ 시험 호출 성공 → ④ 지도 사용 켜기.
        넣은 키는 <b>다시 보이지 않습니다</b>(끝 4자리만). REST 키를 채팅 · 메일에 붙여 넣지 마십시오.
      </div>

      <ul className="rows">
        {d.keys.map((k) => (
          <li key={k.name} className="row">
            <div className="row-head">
              <strong>{LABEL[k.name][0]}</strong>
              <span className="mono">{k.name}</span>
              <span className={`pill pill-${k.source === 'NONE' ? 'warning' : 'muted'}`}>{SRC[k.source]}</span>
              {k.masked && <span className="mono">{k.masked}</span>}
              {k.updatedAt && <span className="dim">{ymdKst(k.updatedAt)}</span>}
            </div>
            <p className="legal">{LABEL[k.name][1]}</p>
            <div className="ip-row">
              <input type="password" autoComplete="off" spellCheck={false} aria-label={`${LABEL[k.name][0]} 넣기`}
                     placeholder={k.source === 'NONE' ? '카카오 콘솔 › 앱 키에서 복사해 붙여 넣기' : '바꿀 때만 새 값을 넣으십시오'}
                     value={val[k.name] ?? ''} onChange={(e) => setVal((x) => ({ ...x, [k.name]: e.target.value }))} />
              <button className="btn-ok" disabled={busy === k.name} onClick={() => void save(k.name)}>저장</button>
              {k.source === 'ADMIN' && <button className="btn-no" disabled={busy === k.name} onClick={() => clear(k.name)}>지우기</button>}
            </div>
          </li>
        ))}
      </ul>

      <div className="ip-row">
        <button className="btn-plain" disabled={busy === '_test' || !restOk} onClick={() => void test()}
                title={restOk ? '서울시청 주소 1건으로 REST 키를 확인합니다' : 'REST API 키를 먼저 넣으십시오'}>시험 호출</button>
        <span className={`pill pill-${d.enabled ? 'muted' : 'warning'}`}>지도 사용 {d.enabled ? '켜짐' : '꺼짐'}</span>
        {d.enabled
          ? <button className="btn-no" disabled={busy === '_toggle'} onClick={() => void toggle(false)}>지도 사용 끄기</button>
          : <button className="btn-ok" disabled={busy === '_toggle' || !restOk || !jsOk} onClick={() => void toggle(true)}
                    title={restOk && jsOk ? '' : '키 2개를 먼저 넣으십시오'}>지도 사용 켜기</button>}
      </div>
      {msg && <p className={msg.ok ? 'hint' : 'warn-text'} role={msg.ok ? 'status' : 'alert'} data-map-msg>{msg.text}</p>}
    </div>
  );
}

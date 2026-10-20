import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { ymdKst } from '../../lib/format';

/**
 * v10.49 (D103 · docs/101) — 외부 연동 › 날씨 키 (SB-ADM-SIT-080 안의 한 구역 · SUPER)
 *
 * 메인 「오늘의 날씨」 띠의 기상청 단기예보 인증키 1개. 카카오맵 키와 같은 방식입니다(2026-10-20 v10.49 계획 승인) —
 *   넣은 값은 서버가 **암호화해** 저장하고 다시 보여 주지 않습니다(끝 4자리만).
 *
 * 순서: ① 공공데이터포털 「기상청_단기예보 조회서비스」 활용 신청 → ② 일반 인증키(Decoding) 넣기 → ③ 「시험 호출」 성공 → ④ 「날씨 사용」 켜기.
 * 날씨 사용이 꺼져 있으면(처음 값) 메인은 날씨 연동 전과 같습니다.
 */

interface KeyState { name: 'KMA_SERVICE_KEY'; source: 'ADMIN' | 'ENV' | 'NONE'; masked: string | null; updatedAt: string | null }
interface WxAdmin { enabled: boolean; defaultRegion: string; regions: { code: string; name: string }[]; key: KeyState }

const SRC: Record<KeyState['source'], string> = { ADMIN: '이 화면에서 넣음', ENV: '.env 값 사용 중', NONE: '없음' };

export function WeatherKeys() {
  const [d, setD] = useState<WxAdmin | null>(null);
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => api<WxAdmin>('/admin/weather').then(setD).catch((e) => setMsg({ ok: false, text: e?.message ?? '불러오지 못했습니다.' }));
  useEffect(() => { void load(); }, []);

  async function run(tag: string, fn: () => Promise<unknown>, okText?: string) {
    setBusy(tag); setMsg(null);
    try { const r = await fn(); if (r && typeof r === 'object' && 'key' in (r as object)) setD(r as WxAdmin); if (okText) setMsg({ ok: true, text: okText }); }
    catch (e) { setMsg({ ok: false, text: (e as Error)?.message ?? '실패했습니다.' }); }
    finally { setBusy(null); }
  }

  const save = () => run('_key', async () => {
    const v = val.trim();
    if (!v) throw new Error('인증키를 붙여 넣으십시오.');
    const r = await api<WxAdmin>('/admin/weather/key', { method: 'PUT', body: JSON.stringify({ value: v }) });
    setVal('');
    return r;
  }, '저장했습니다 — 값은 다시 보이지 않습니다(끝 4자리만).');

  const clear = () => {
    if (!window.confirm('기상청 인증키를 지울까요? 지우면 .env 값을 쓰고, 그것도 없으면 메인의 날씨 띠가 숨습니다.')) return;
    void run('_key', () => api<WxAdmin>('/admin/weather/key', { method: 'DELETE' }), '지웠습니다.');
  };

  const test = () => run('_test', async () => {
    const r = await api<{ ok: boolean; message: string }>('/admin/weather/test', { method: 'POST' });
    setMsg({ ok: r.ok, text: r.message });
    return null;
  });

  const patch = (body: { enabled?: boolean; defaultRegion?: string }, okText: string) =>
    run('_patch', () => api<WxAdmin>('/admin/weather', { method: 'PATCH', body: JSON.stringify(body) }), okText);

  if (!d) return msg ? <p className="warn-text" role="alert">{msg.text}</p> : null;
  const keyOk = d.key.source !== 'NONE';

  return (
    <div data-weather-keys>
      <h2 className="ad-s2">날씨 키 <small className="dim">v10.49 · 메인 「오늘의 날씨」 · 기상청 단기예보(암호화 저장)</small></h2>
      <div className="ad-nt info">
        <b>순서</b> ① 공공데이터포털(data.go.kr) 「기상청_단기예보 조회서비스」 활용 신청 → ② 일반 인증키(Decoding) 넣기 → ③ 시험 호출 성공 → ④ 날씨 사용 켜기.
        넣은 키는 <b>다시 보이지 않습니다</b>(끝 4자리만). 인증키를 채팅 · 메일에 붙여 넣지 마십시오.
      </div>

      <ul className="rows">
        <li className="row">
          <div className="row-head">
            <strong>기상청 인증키</strong>
            <span className="mono">{d.key.name}</span>
            <span className={`pill pill-${d.key.source === 'NONE' ? 'warning' : 'muted'}`}>{SRC[d.key.source]}</span>
            {d.key.masked && <span className="mono">{d.key.masked}</span>}
            {d.key.updatedAt && <span className="dim">{ymdKst(d.key.updatedAt)}</span>}
          </div>
          <p className="legal">서버만 씁니다(기상청 호출). 화면 · 응답에 나가지 않습니다. Encoding 키를 넣어도 서버가 알아서 풉니다.</p>
          <div className="ip-row">
            <input type="password" autoComplete="off" spellCheck={false} aria-label="기상청 인증키 넣기"
                   placeholder={keyOk ? '바꿀 때만 새 값을 넣으십시오' : '공공데이터포털 › 활용 신청 상세의 일반 인증키(Decoding)'}
                   value={val} onChange={(e) => setVal(e.target.value)} />
            <button className="btn-ok" disabled={busy === '_key'} onClick={() => void save()}>저장</button>
            {d.key.source === 'ADMIN' && <button className="btn-no" disabled={busy === '_key'} onClick={clear}>지우기</button>}
          </div>
        </li>
      </ul>

      <div className="ip-row">
        <button className="btn-plain" disabled={busy === '_test' || !keyOk} onClick={() => void test()}
                title={keyOk ? '서울 초단기실황 1번으로 키를 확인합니다' : '인증키를 먼저 넣으십시오'}>시험 호출</button>
        <label>처음 지역{' '}
          <select value={d.defaultRegion} disabled={busy === '_patch'} aria-label="날씨 처음 지역"
                  onChange={(e) => void patch({ defaultRegion: e.target.value }, '처음 지역을 바꿨습니다 — 메인에 10분 안에 반영됩니다.')}>
            {d.regions.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
          </select>
        </label>
        <span className={`pill pill-${d.enabled ? 'muted' : 'warning'}`}>날씨 사용 {d.enabled ? '켜짐' : '꺼짐'}</span>
        {d.enabled
          ? <button className="btn-no" disabled={busy === '_patch'} onClick={() => void patch({ enabled: false }, '날씨 사용을 껐습니다 — 메인에서 10분 안에 날씨 띠가 사라집니다.')}>날씨 사용 끄기</button>
          : <button className="btn-ok" disabled={busy === '_patch' || !keyOk} title={keyOk ? '' : '인증키를 먼저 넣으십시오'}
                    onClick={() => void patch({ enabled: true }, '날씨 사용을 켰습니다 — 메인에 10분 안에 날씨 띠가 나타납니다.')}>날씨 사용 켜기</button>}
      </div>
      {msg && <p className={msg.ok ? 'hint' : 'warn-text'} role={msg.ok ? 'status' : 'alert'} data-weather-msg>{msg.text}</p>}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { ymdKst } from '../../lib/format';

/**
 * v10.128 (D128 · docs/192) — 외부 연동 › 연동 키 (SB-ADM-SIT-080 안의 한 구역 · SUPER)
 *
 * 대표 「외부 연동에서 key 등록 관리를 관리자에서 · .env 관리가 아님」(2026-10-27 승인).
 *   결제 · 계좌 · 국세청 · 중개사 · 세금계산서 · 메일 · 본인인증 · 전자계약 · 알림톡 · 안심번호 키를 여기서 넣고 바꾸고 지웁니다.
 *   넣은 값은 서버가 **암호화해** 저장하고 다시 보여 주지 않습니다(끝 4자리만). 1분 안에 반영 · 다시 띄우거나 빌드할 필요 없음.
 *   운영 화면 키가 먼저, 없으면 .env. 키만 다룹니다 — 주소(…_URL)는 그대로 .env.
 *   카카오맵 · 날씨 키는 아래 각 구역, AI 키는 AI 운영 › AI 에이전트에서(이 목록에서는 뺌).
 */

interface KeyRow {
  code: string; integration: string; name: string; label: string; isPublic: boolean;
  adapter: 'REAL' | 'STUB' | 'NONE'; source: 'ADMIN' | 'ENV' | 'NONE'; masked: string | null; updatedAt: string | null;
}

const SRC: Record<KeyRow['source'], string> = { ADMIN: '이 화면에서 넣음', ENV: '.env 값 사용 중', NONE: '없음' };
const ADAPTER: Record<KeyRow['adapter'], string> = { REAL: '', STUB: '연동 구현 전 — 넣어 두어도 아직 부르지 않음', NONE: '업체 미정 — 넣어 두어도 아직 부르지 않음' };
const OWN_PANEL = ['MAP', 'WEATHER', 'AGENT'];

export function IntegrationKeys() {
  const [rows, setRows] = useState<KeyRow[] | null>(null);
  const [val, setVal] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; at?: string } | null>(null);

  const load = () => api<KeyRow[]>('/admin/integration-keys').then(setRows).catch((e) => setMsg({ ok: false, text: e?.message ?? '불러오지 못했습니다.' }));
  useEffect(() => { void load(); }, []);

  const id = (r: KeyRow) => `${r.code}/${r.name}`;

  async function run(r: KeyRow, fn: () => Promise<KeyRow[]>, okText: string) {
    setBusy(id(r)); setMsg(null);
    try { setRows(await fn()); setMsg({ ok: true, text: okText, at: id(r) }); }
    catch (e) { setMsg({ ok: false, text: (e as Error)?.message ?? '실패했습니다.', at: id(r) }); }
    finally { setBusy(null); }
  }

  const save = (r: KeyRow) => {
    const v = (val[id(r)] ?? '').trim();
    if (!v) { setMsg({ ok: false, text: '키를 붙여 넣으십시오.', at: id(r) }); return; }
    void run(r, async () => {
      const out = await api<KeyRow[]>(`/admin/integration-keys/${r.code}/${r.name}`, { method: 'PUT', body: JSON.stringify({ value: v }) });
      setVal((m) => ({ ...m, [id(r)]: '' }));
      return out;
    }, `${r.integration} · ${r.label} 저장 — 1분 안에 반영됩니다. 값은 다시 보이지 않습니다(끝 4자리만).`);
  };

  const clear = (r: KeyRow) => {
    if (!window.confirm(`${r.integration} · ${r.label}를 지울까요? 지우면 .env 값을 쓰고, 그것도 없으면 그 연동은 간주 모드 · 시험 · 「준비 중」으로 돕니다.`)) return;
    void run(r, () => api<KeyRow[]>(`/admin/integration-keys/${r.code}/${r.name}`, { method: 'DELETE' }), `${r.integration} · ${r.label} 지움.`);
  };

  if (!rows) return msg ? <p className="warn-text" role="alert">{msg.text}</p> : null;
  const list = rows.filter((r) => !OWN_PANEL.includes(r.code));
  /* 토스 시크릿 · 클라이언트 키는 짝으로 — 한쪽만 있거나 test/live 가 다르면 결제창은 시험 결제로 둡니다(서버가 공개 키를 주지 않음) */
  const pg = list.filter((r) => r.code === 'PG');
  const pgHalf = pg.some((r) => r.source !== 'NONE') && pg.some((r) => r.source === 'NONE');

  return (
    <div data-integration-keys>
      <h2 className="ad-s2">연동 키 <em>{list.length}</em> <small className="dim">v10.128 · 암호화 저장 · 이 화면 키가 먼저, 없으면 .env</small></h2>
      <div className="ad-nt info">
        업체 콘솔에서 받은 키를 여기에 넣습니다. 넣은 키는 <b>다시 보이지 않습니다</b>(끝 4자리만) · 1분 안에 반영(다시 띄우거나 빌드할 필요 없음).
        키만 다룹니다 — 연동 주소(…_URL)는 .env. 키를 채팅 · 메일에 붙여 넣지 마십시오.
        키를 넣어도 간주 모드(assume.*) · 연동 상태는 그대로입니다 — 실제 호출을 확인한 뒤 따로 바꾸십시오.
      </div>

      {pgHalf && <div className="ad-nt warn" data-pg-half><b>전자결제 키가 하나만 있습니다.</b> 시크릿 키와 결제창 클라이언트 키를 같은 계정 · 같은 test/live 로 함께 넣어야 실제 결제가 됩니다 — 그 전에는 시험 결제로 돕니다.</div>}
      <ul className="rows">
        {list.map((r) => (
          <li key={id(r)} className="row" data-integ-key={id(r)}>
            <div className="row-head">
              <strong>{r.integration} · {r.label}</strong>
              <span className="mono">{r.name}</span>
              <span className={`pill pill-${r.source === 'NONE' ? 'warning' : 'muted'}`}>{SRC[r.source]}</span>
              {r.masked && <span className="mono">{r.masked}</span>}
              {r.updatedAt && <span className="dim">{ymdKst(r.updatedAt)}</span>}
            </div>
            <p className="legal">
              {r.isPublic ? '공개 키 — 결제창을 열 때 브라우저에 나갑니다(비밀 키 아님).' : '서버만 씁니다. 화면 · 응답에 나가지 않습니다.'}
              {ADAPTER[r.adapter] && <> {ADAPTER[r.adapter]}.</>}
            </p>
            <div className="ip-row">
              <input type="password" autoComplete="off" spellCheck={false} aria-label={`${r.integration} ${r.label} 넣기`}
                     placeholder={r.source === 'NONE' ? '업체에서 받은 키' : '바꿀 때만 새 값을 넣으십시오'}
                     value={val[id(r)] ?? ''} onChange={(e) => setVal((m) => ({ ...m, [id(r)]: e.target.value }))} />
              <button className="btn-ok" disabled={busy === id(r)} onClick={() => save(r)}>저장</button>
              {r.source === 'ADMIN' && <button className="btn-no" disabled={busy === id(r)} onClick={() => clear(r)}>지우기</button>}
            </div>
            {msg?.at === id(r) && <p className={msg.ok ? 'hint' : 'warn-text'} role={msg.ok ? 'status' : 'alert'} data-integ-key-msg>{msg.text}</p>}
          </li>
        ))}
      </ul>
      {msg && !msg.at && <p className="warn-text" role="alert">{msg.text}</p>}
    </div>
  );
}

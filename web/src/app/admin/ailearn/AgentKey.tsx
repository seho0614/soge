import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { ymdKst } from '../../../lib/format';

/**
 * v10.111 (D122 · docs/173) — AI 운영 › AI 에이전트 › 「AI 키」 (SB-ADM-AGT-010 안의 한 구역 · SUPER)
 *
 * Anthropic API 키 1개. 날씨 키 · 카카오맵 키와 같은 방식입니다(2026-10-26 대표 「개발 진행」) —
 *   넣은 값은 서버가 **암호화해** 저장하고 다시 보여 주지 않습니다(끝 4자리만). 운영 화면에 키가 없으면 .env 키를 씁니다.
 *
 * 키를 넣어도 AI 를 켜지는 않습니다 — 부르는지는 지금처럼 전체 스위치(agent.enabled) · 통로 스위치 · 월 상한이 정합니다.
 * 「키 확인」은 Anthropic 모델 목록을 한 번 읽습니다(토큰을 쓰지 않아 비용 없음).
 */

interface KeyState {
  name: 'ANTHROPIC_API_KEY'; source: 'ADMIN' | 'ENV' | 'MOCK' | 'NONE'; engine: 'CLAUDE' | 'MOCK' | null;
  saved: boolean; unreadable: boolean; masked: string | null; updatedAt: string | null;
}

const SRC: Record<KeyState['source'], string> = { ADMIN: '이 화면에서 넣음', ENV: '.env 값 사용 중', MOCK: '시험 엔진(.env MOCK)', NONE: '없음' };

export function AgentKey({ onChanged }: { onChanged?: () => void }) {
  const [d, setD] = useState<KeyState | null>(null);
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api<KeyState>('/admin/agent/key').then(setD).catch((e) => setMsg({ ok: false, text: e?.message ?? '불러오지 못했습니다.' }));
  }, []);

  async function run(tag: string, fn: () => Promise<KeyState | null>, okText?: string) {
    setBusy(tag); setMsg(null);
    try {
      const r = await fn();
      if (r) { setD(r); onChanged?.(); }
      if (okText) setMsg({ ok: true, text: okText });
    } catch (e) { setMsg({ ok: false, text: (e as Error)?.message ?? '실패했습니다.' }); }
    finally { setBusy(null); }
  }

  const save = () => run('_key', async () => {
    const v = val.trim();
    if (!v) throw new Error('키를 붙여 넣으십시오.');
    const r = await api<KeyState>('/admin/agent/key', { method: 'PUT', body: JSON.stringify({ value: v }) });
    setVal('');
    return r;
  }, '저장했습니다 — 값은 다시 보이지 않습니다(끝 4자리만). 1분 안에 모든 통로가 이 키를 씁니다. 「키 확인」으로 맞는 키인지 보십시오.');

  const clear = () => {
    if (!window.confirm('AI 키를 지울까요? 지우면 .env 키를 쓰고, 그것도 없으면 AI 를 부르지 않습니다.')) return;
    void run('_key', () => api<KeyState>('/admin/agent/key', { method: 'DELETE' }), '지웠습니다.');
  };

  const test = () => run('_test', async () => {
    const r = await api<{ ok: boolean; message: string }>('/admin/agent/key/test', { method: 'POST' });
    setMsg({ ok: r.ok, text: r.message });
    return null;
  });

  if (!d) return msg ? <p className="warn-text" role="alert">{msg.text}</p> : null;
  const keyOk = d.source !== 'NONE';

  return (
    <div data-agent-key>
      <h3 className="sec">AI 키 <small className="dim">v10.111 · Anthropic API 키(암호화 저장 · 최고 관리자만)</small></h3>
      <div className="ad-nt info">
        <b>순서</b> ① Anthropic 콘솔(console.anthropic.com) › API Keys › 새 키 만들기 → ② 여기에 붙여 넣고 저장 → ③ 키 확인 성공.
        넣은 키는 <b>다시 보이지 않습니다</b>(끝 4자리만). 키를 채팅 · 메일에 붙여 넣지 마십시오.
        키를 넣어도 <b>AI 는 켜지지 않습니다</b> — 전체 스위치 · 월 상한을 따로 정합니다.
      </div>

      <ul className="rows">
        <li className="row">
          <div className="row-head">
            <strong>Anthropic API 키</strong>
            <span className="mono">{d.name}</span>
            <span className={`pill pill-${d.source === 'NONE' ? 'warning' : 'muted'}`} data-agent-key-source={d.source}>{SRC[d.source]}</span>
            {d.masked && <span className="mono">{d.masked}</span>}
            {d.updatedAt && <span className="dim">{ymdKst(d.updatedAt)}</span>}
            <span className="dim">엔진 {d.engine ?? '없음'}</span>
          </div>
          <p className="legal">
            서버만 씁니다(번역 · 게시판 번역 · 검수 보조 · AI 상담). 화면 · 응답 · 기록에 나가지 않습니다.
            {d.source === 'MOCK' && d.saved && ' 지금은 .env 의 시험 엔진(MOCK)이 먼저라 저장한 키를 쓰지 않습니다.'}
          </p>
          {d.unreadable && <p className="warn-text" role="alert" data-agent-key-unreadable>저장한 키를 읽지 못해 쓰지 않고 있습니다(서버의 암호 열쇠 ENC_KEY 확인) — 지금은 {d.source === 'ENV' ? '.env 키' : '엔진 없음'}입니다. 키를 다시 넣으십시오.</p>}
          <div className="ip-row">
            <input type="password" autoComplete="off" spellCheck={false} aria-label="AI 키 넣기"
                   placeholder={d.saved ? '바꿀 때만 새 키를 넣으십시오' : 'sk-ant-api 로 시작하는 키'}
                   value={val} onChange={(e) => setVal(e.target.value)} />
            <button className="btn-ok" disabled={!!busy} onClick={() => void save()}>저장</button>
            {d.saved && <button className="btn-no" disabled={!!busy} onClick={clear}>지우기</button>}
            <button className="btn-plain" disabled={!!busy || !keyOk} onClick={() => void test()}
                    title={keyOk ? 'Anthropic 모델 목록을 한 번 읽어 확인합니다(비용 없음)' : '키를 먼저 넣으십시오'}>키 확인</button>
          </div>
        </li>
      </ul>
      {msg && <p className={msg.ok ? 'hint' : 'warn-text'} role={msg.ok ? 'status' : 'alert'} data-agent-key-msg>{msg.text}</p>}
    </div>
  );
}

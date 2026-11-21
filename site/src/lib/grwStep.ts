/**
 * v10.597 (docs/739) 가입 화면 단계 수 — 가입 화면(SignupWizard)이 단계가 바뀔 때 한 번 부름.
 *   보내는 것: 단계 번호(1 ~ 5) 하나뿐(POST /api/v1/site/grw/signup-step) — 계정 · 이메일 · 입력한 글 · 방문자 번호 · 쿠키 없음.
 *   스위치(grw.signup_steps)는 GET /api/v1/site/grw/switches 로 탭마다 한 번 확인 · 꺼져 있으면 아무것도 보내지 않음.
 *   이 탭 안 메모(sessionStorage sgb_grw — 스위치 · 보낸 단계)는 탭을 닫으면 사라지고 서버로 가지 않음.
 *   브라우저 「추적 안 함」(DNT) · GPC 이면 보내지 않음. 저장소가 막힌 브라우저도 조용히 넘어감.
 */
const KEY = 'sgb_grw';
interface Memo { on: boolean | null; sent: number[] }

function read(): Memo {
  try { const raw = sessionStorage.getItem(KEY); return raw ? (JSON.parse(raw) as Memo) : { on: null, sent: [] }; } catch { return { on: false, sent: [] }; }
}
function write(m: Memo) { try { sessionStorage.setItem(KEY, JSON.stringify(m)); } catch { /* 저장소 막힘 */ } }

function send(step: number) {
  const json = JSON.stringify({ s: step });
  const ok = typeof navigator.sendBeacon === 'function' && navigator.sendBeacon('/api/v1/site/grw/signup-step', new Blob([json], { type: 'application/json' }));
  if (!ok) void fetch('/api/v1/site/grw/signup-step', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json, keepalive: true }).catch(() => undefined);
}

export function grwStep(step: number) {
  if (typeof window === 'undefined' || !Number.isInteger(step) || step < 1 || step > 5) return;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  if (nav.doNotTrack === '1' || nav.globalPrivacyControl === true) return;
  const m = read();
  if (m.on === false || m.sent.includes(step)) return;
  const go = () => { const x = read(); if (x.sent.includes(step)) return; write({ on: true, sent: [...x.sent, step] }); send(step); };
  if (m.on === true) { go(); return; }
  void fetch('/api/v1/site/grw/switches').then((r) => (r.ok ? r.json() : null)).then((j: { signupSteps?: boolean } | null) => {
    const on = !!j?.signupSteps;
    write({ ...read(), on });
    if (on) go();
  }).catch(() => undefined);
}

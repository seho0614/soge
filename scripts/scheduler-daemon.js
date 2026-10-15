#!/usr/bin/env node
/**
 * 배치 스케줄러 — 개발용 EventBridge 대역.
 *
 * **운영과 정확히 같은 것을 부릅니다.**
 *   EventBridge → Lambda → POST /admin/jobs/tick  (X-Job-Token)
 *   이 데몬      →         POST /admin/jobs/tick  (X-Job-Token)
 *
 * 호출 대상·주기·인증이 같으므로 "로컬에선 되는데" 가 생기지 않습니다.
 * 무엇을 언제 돌릴지는 양쪽 다 DB(job_schedules)가 정합니다.
 *
 * ── 운영에서 이것을 쓰지 마십시오 ───────────────────────────────────
 * 프로세스가 죽으면 아무도 모릅니다.
 * infra/eventbridge-jobs.yaml 에는 실패 알람과 **멈춤 알람**이 함께 있습니다 —
 * 15분 동안 한 번도 안 불리면 웁니다.
 */
require('./load-env');

const API = process.env.API_ORIGIN || 'http://localhost:3000';
const TOKEN = process.env.JOB_TOKEN;
const EVERY_MS = 60_000;
/* 살아 있음 표시 (docker compose 의 scheduler healthcheck 가 읽습니다).
 * tick 이 **성공**할 때만 시각을 갱신합니다 — 프로세스만 살아 있고 API 를 못 부르면 unhealthy 가 됩니다. */
const HEARTBEAT = process.env.SCHEDULER_HEARTBEAT || '/tmp/scheduler.ok';

if (!TOKEN || TOKEN.length < 32) {
  console.error('JOB_TOKEN 이 없거나 32자 미만입니다. 스케줄러를 시작하지 않습니다.');
  console.error('  openssl rand -hex 24');
  process.exit(1);
}

async function tick() {
  try {
    const res = await fetch(`${API}/api/v1/admin/jobs/tick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Job-Token': TOKEN },
    });
    const body = await res.text();
    if (!res.ok) {
      console.error(`[${new Date().toISOString()}] tick 실패 HTTP ${res.status} ${body.slice(0, 200)}`);
      return;
    }
    const r = JSON.parse(body);
    try { require('fs').writeFileSync(HEARTBEAT, new Date().toISOString()); } catch { /* 표시 실패는 배치와 무관 */ }
    // 돌린 것이 있을 때만 적습니다. 매분 "할 일 없음"을 남기면 로그가 묻힙니다.
    if (r.ran?.length) {
      console.log(`[${new Date().toISOString()}] 실행 ${r.ran.join(', ')}`);
    }
    if (r.skipped?.length) {
      console.log(`[${new Date().toISOString()}] 건너뜀(다른 곳에서 실행) ${r.skipped.join(', ')}`);
    }
  } catch (e) {
    // API 가 아직 안 떴을 수 있습니다. 죽지 않고 다음 분에 다시 봅니다.
    console.error(`[${new Date().toISOString()}] ${e.message}`);
  }
}

console.log(`배치 스케줄러 시작 · ${API} · ${EVERY_MS / 1000}초 주기`);
tick();
setInterval(tick, EVERY_MS);

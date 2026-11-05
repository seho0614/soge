/**
 * v10.196 (docs/308) — 올린 파일 백업을 cron 없이.
 *
 * 배치 호출기(scheduler-daemon.js · 운영 pm2 sgb-jobs)가 매분 check() 를 부르면,
 * 정한 시각(한국 시간 UPLOADS_BACKUP_DAILY · 예 04:30)을 지난 뒤 **하루 한 번** deploy/aws/uploads-backup.sh 를 부릅니다.
 *
 *   - UPLOADS_BACKUP_DAILY 가 없거나 'off' 면 아무것도 안 함(개발 도커 스케줄러는 이 값이 없음 · 운영은 run-jobs.sh 가 04:30 을 넘김)
 *   - 오늘 묶음이 이미 있으면 스크립트가 건너뜀 — cron 을 함께 등록해도 · 호출기가 다시 떠도 한 번만 묶임
 *   - 실패는 여기서 다시 하지 않음: 디스크 부족은 스크립트의 UPLOADS_BACKUP_SKIPPED, 그 밖에는 36시간 넘음 알림(UPLOADS_BACKUP_STALE)
 */
const { spawn } = require('child_process');
const path = require('path');

/** 'HH:MM' → 하루 중 분. 형식이 아니면 null(꺼짐) */
function parseAt(v) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(v ?? '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** 한국 시간 날짜(YYYYMMDD) · 하루 중 분 */
function kst(now) {
  const d = new Date(now.getTime() + 9 * 3600_000);
  return { day: d.toISOString().slice(0, 10).replace(/-/g, ''), min: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

/** 정한 시각을 지났고 오늘 아직 안 불렀으면 true */
function due(now, atMin, lastDay) {
  if (atMin === null) return false;
  const k = kst(now);
  return k.min >= atMin && lastDay !== k.day;
}

function createDailyBackup(env = process.env, root = path.resolve(__dirname, '..')) {
  const atMin = parseAt(env.UPLOADS_BACKUP_DAILY);
  const script = path.join(root, 'deploy/aws/uploads-backup.sh');
  let lastDay = null;
  let running = false;
  return {
    enabled: atMin !== null,
    at: env.UPLOADS_BACKUP_DAILY,
    /** 불렀으면 true. 끝은 기다리지 않음(묶는 데 몇 분 걸려도 매분 tick 은 그대로) */
    check(now = new Date()) {
      if (running || !due(now, atMin, lastDay)) return false;
      lastDay = kst(now).day;
      running = true;
      let out = '';
      const child = spawn('bash', [script], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', (b) => { out += b; });
      child.stderr.on('data', (b) => { out += b; });
      child.on('error', (e) => { running = false; console.error(`[${new Date().toISOString()}] 올린 파일 백업을 부르지 못함 — ${e.message}`); });
      child.on('close', (code) => {
        running = false;
        const last = out.trim().split('\n').slice(-1)[0] ?? '';
        (code === 0 ? console.log : console.error)(`[${new Date().toISOString()}] 올린 파일 백업 끝 (종료 값 ${code}) — ${last.slice(0, 200)}`);
      });
      return true;
    },
  };
}

module.exports = { parseAt, kst, due, createDailyBackup };

import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/* ---------------------------------------------------------------------
 * v10.177 (docs/275) — 올린 파일 백업 묶음 상태(deploy/aws/uploads-backup.sh 가 만든 uploads_YYYYMMDD.tar.gz)
 *
 *   운영 화면 「지켜보기」 칸 · 하루 요약(launch_digest)이 씁니다. 읽기만 — 묶음을 만들거나 지우지 않습니다.
 *   찾는 곳은 스크립트와 같습니다: BACKUP_DIR · 없으면 DATA_DIR(기본 ~/sgb-data)/backup/uploads.
 *   묶음이 하나도 없으면 아직 예약(cron)을 걸지 않은 것으로 보고 경고하지 않습니다(stale=false).
 * ------------------------------------------------------------------- */
export const UPLOADS_BACKUP_STALE_HOURS = 36;

export function uploadsBackupDir(): string {
  return process.env.BACKUP_DIR || join(process.env.DATA_DIR || join(homedir(), 'sgb-data'), 'backup', 'uploads');
}

export function uploadsBackupState(dir = uploadsBackupDir(), now = Date.now()) {
  let files: Array<{ name: string; at: number; kb: number }> = [];
  try {
    files = readdirSync(dir).filter((f) => /^uploads_\d{8}\.tar\.gz$/.test(f)).map((name) => {
      const s = statSync(join(dir, name));
      return { name, at: s.mtimeMs, kb: Math.round(s.size / 1024) };
    }).sort((a, b) => b.at - a.at);
  } catch { /* 폴더 없음 = 아직 백업을 돌린 적 없음 */ }
  const last = files[0];
  const ageHours = last ? Math.floor((now - last.at) / 3600_000) : null;
  return {
    count: files.length,
    last: last ? last.name : null,
    lastAt: last ? new Date(last.at).toISOString() : null,
    lastKB: last ? last.kb : null,
    ageHours,
    stale: ageHours !== null && ageHours > UPLOADS_BACKUP_STALE_HOURS,
  };
}

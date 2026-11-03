import { existsSync, lstatSync, readFileSync, readdirSync, statfsSync } from 'node:fs';
import { freemem, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { uploadsBackupDir } from './uploads-backup-state';

/* ---------------------------------------------------------------------
 * v10.182 (D171 · docs/285) — 서버 디스크 · 메모리 지켜보기
 *
 *   정기 작업 launch_watch(10분)가 measureServerHealth() 로 재고, 운영 화면 「지켜보기」 · 하루 요약은 마지막 값을 읽습니다.
 *   Node 내장 기능만 씀(새 패키지 · 외부 호출 없음). 읽기만 — 아무것도 지우지 않습니다.
 *   디스크는 올린 파일 폴더가 있는 곳(운영 /home/ubuntu/sgb-data/uploads → 루트 디스크) 기준.
 *   폴더 크기는 파일을 세어 더하므로 오래 걸리지 않게 파일 20만 개 · 5초에서 멈추고 「대략」으로 표시합니다.
 * ------------------------------------------------------------------- */
export interface ServerHealth {
  at: string;
  disk: { path: string; totalGB: number; freeGB: number; usedPct: number } | null;
  mem: { totalMB: number; availMB: number; usedPct: number };
  uploads: { path: string; MB: number; files: number; partial: boolean } | null;
  backup: { path: string; MB: number; files: number; partial: boolean } | null;
}

let cache: ServerHealth | null = null;

export function uploadDir(): string {
  return resolve(process.env.UPLOAD_DIR || './uploads');
}

function diskOf(path: string): ServerHealth['disk'] {
  try {
    let p = path;
    while (!existsSync(p) && p !== '/') p = resolve(p, '..');
    const s = statfsSync(p);
    const total = s.blocks * s.bsize; const free = s.bavail * s.bsize;
    const gb = (n: number) => Math.round((n / 1024 ** 3) * 10) / 10;
    return { path: p, totalGB: gb(total), freeGB: gb(free), usedPct: total ? Math.round(((total - free) / total) * 100) : 0 };
  } catch { return null; }
}

function memNow(): ServerHealth['mem'] {
  const total = totalmem();
  let avail = freemem();
  try {   // 리눅스는 캐시를 빼고 실제로 쓸 수 있는 양(MemAvailable)
    const m = readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+) kB/m);
    if (m) avail = Number(m[1]) * 1024;
  } catch { /* 리눅스가 아님 */ }
  return { totalMB: Math.round(total / 1024 ** 2), availMB: Math.round(avail / 1024 ** 2), usedPct: Math.round(((total - avail) / total) * 100) };
}

/** 폴더 크기(바로가기는 따라가지 않음) — 파일 maxFiles 개 · maxMs 넘으면 멈추고 partial */
export function folderSize(path: string, maxFiles = 200_000, maxMs = 5000): { path: string; MB: number; files: number; partial: boolean } | null {
  if (!existsSync(path)) return null;
  const t0 = Date.now(); let bytes = 0; let files = 0; let partial = false;
  const stack = [path];
  while (stack.length) {
    if (files >= maxFiles || Date.now() - t0 > maxMs) { partial = true; break; }
    const d = stack.pop()!;
    let names: string[] = [];
    try { names = readdirSync(d); } catch { continue; }
    for (const n of names) {
      const f = join(d, n);
      try {
        const s = lstatSync(f);
        if (s.isDirectory()) stack.push(f);
        else if (s.isFile()) { bytes += s.size; files += 1; }
      } catch { /* 지워진 파일 */ }
    }
  }
  return { path, MB: Math.round((bytes / 1024 ** 2) * 10) / 10, files, partial };
}

export function measureServerHealth(): ServerHealth {
  const up = uploadDir();
  cache = {
    at: new Date().toISOString(),
    disk: diskOf(up),
    mem: memNow(),
    uploads: folderSize(up),
    backup: folderSize(uploadsBackupDir()),
  };
  return cache;
}

/** 마지막으로 잰 값(없거나 20분 넘었으면 지금 잼) */
export function serverHealth(now = Date.now()): ServerHealth {
  if (!cache || now - Date.parse(cache.at) > 20 * 60_000) return measureServerHealth();
  return cache;
}

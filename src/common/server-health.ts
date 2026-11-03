import { existsSync, lstatSync, readFileSync, readdirSync, statfsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { freemem, homedir, totalmem } from 'node:os';
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
  top: DiskTop | null;   // v10.186 — 많이 차지하는 폴더 5개(1시간마다)
}

/* v10.186 (docs/292) — 디스크를 많이 차지하는 폴더 5개
 *   집 폴더 바로 아래 · 시스템 몇 곳을 du(-x 같은 디스크만)로 잽니다. 무거우므로 1시간에 한 번 · 30초에서 멈춤 · 따로 돌려 API 를 막지 않음.
 *   읽기만 — 지우는 일은 사람이 deploy/aws/cleanup.sh 로(먼저 목록 보기). 권한이 없는 곳은 읽힌 만큼만(대략). */
export interface DiskTop { at: string; items: Array<{ path: string; GB: number; hint: string }>; partial: boolean }
let topCache: DiskTop | null = null;

const HINTS: Array<[RegExp, string]> = [
  [/\/sgb-releases$/, '판 폴더 — apply 가 지금 · 직전 판만 남김'],
  [/\/sgb-data$/, '올린 파일 · 백업 묶음 · 기록 — 기록은 cleanup.sh'],
  [/\/\.npm$/, 'npm 캐시 — cleanup.sh'],
  [/\/\.pm2$/, 'pm2 로그 — cleanup.sh'],
  [/\/\.cache$/, '프로그램 캐시 — cleanup.sh'],
  [/\/SGB_DevDocker_[^/]*$/, '푼 킷 — 적용 뒤 지워도 됨(cleanup.sh)'],
  [/^\/var\/log$/, '시스템 기록 — journalctl --vacuum(sudo)'],
  [/^\/var\/lib\/snapd$/, 'snap 옛 판 — sudo 필요'],
];
const hintOf = (p: string) => HINTS.find(([re]) => re.test(p))?.[1] ?? '';

/** du 출력(「KB<탭>경로」 줄)을 큰 것 5개로 */
export function parseDuTop(out: string): DiskTop['items'] {
  return out.split('\n').map((l) => l.split('\t')).filter((a) => a.length === 2 && /^\d+$/.test(a[0]))
    .map(([kb, path]) => ({ path, GB: Math.round((Number(kb) / 1024 ** 2) * 10) / 10, hint: hintOf(path) }))
    .sort((a, b) => b.GB - a.GB).slice(0, 5);
}

export function measureDiskTop(home = homedir(), extra = ['/var/log', '/var/cache', '/var/lib/snapd', '/usr', '/opt', '/tmp']): Promise<DiskTop | null> {
  let names: string[] = [];
  try { names = readdirSync(home).map((n) => join(home, n)); } catch { return Promise.resolve(null); }
  const paths = [...names, ...extra.filter((p) => existsSync(p))];
  return new Promise((done) => {
    execFile('du', ['-skx', ...paths], { encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      // 권한이 없는 곳이 있으면 du 가 1 로 끝나도 읽힌 줄은 씁니다(partial)
      if (err && !stdout) return done(null);
      done({ at: new Date().toISOString(), items: parseDuTop(String(stdout || '')), partial: !!err });
    });
  });
}
let topBusy = false;

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
    top: topCache,
  };
  if (!topBusy && (!topCache || Date.now() - Date.parse(topCache.at) > 60 * 60_000)) {
    topBusy = true;
    measureDiskTop().then((t) => { topCache = t ?? topCache; if (cache) cache.top = topCache; }).catch(() => undefined).finally(() => { topBusy = false; });
  }
  return cache;
}

/** 마지막으로 잰 값(없거나 20분 넘었으면 지금 잼) */
export function serverHealth(now = Date.now()): ServerHealth {
  if (!cache || now - Date.parse(cache.at) > 20 * 60_000) return measureServerHealth();
  return cache;
}

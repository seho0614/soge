import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { closeSync, lstatSync, openSync, readSync, readdirSync, readFileSync, statSync } from 'fs';
import { homedir, hostname } from 'os';
import { join } from 'path';
import { DatabaseService } from '../../db/database.service';
import { APP_VERSION, PROCESS_STARTED_AT, versionCmp } from '../../common/app-version';
import { PolicyViolation } from '../../core/errors';

/* ---------------------------------------------------------------------
 * v10.244 (D202 · docs/383) — 운영 적용 기록
 *
 *   ① API 가 뜰 때 VERSION 이 ops_release_log 가장 최근 줄과 다르면 한 줄(FIRST · UP · BACK · OTHER).
 *      같은 판으로 다시 뜨면 적지 않음 · 실패해도 API 는 그대로 뜸(기록만 빠짐 · 로그 한 줄).
 *   ② 운영 화면 첫 화면 「지금 판 · 적용 기록」 — 최근 10줄 + 서버에 남은 가장 최근 postcheck 결과 파일
 *      (DATA_DIR(기본 ~/sgb-data)/logs/postcheck_YYYYMMDD_HHMMSS.txt)의 「통과 · 실패 · 확인」 · [11] 「같음 · 바뀜」.
 *      postcheck.sh 는 그대로 읽기만 — 이 화면도 파일을 읽기만 합니다.
 * ------------------------------------------------------------------- */
export type ReleaseKind = 'FIRST' | 'UP' | 'BACK' | 'OTHER';
export type ReleaseRow = { id: number; version: string; prev: string | null; kind: ReleaseKind; host: string | null; at: string };
export type PostcheckSummary = {
  file: string; at: string; version: string | null; pass: number; fail: number; warn: number;
  same: number | null; changed: number | null; ageHours: number;
};
const PC_FILE = /^postcheck_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.txt$/;
/* v10.247 (docs/386) — 운영 화면에서 열어 볼 수 있는 결과 파일(적용 스크립트가 남긴 것만 · 빌드 기록 · precheck_state.txt 는 뺌) */
export const OPS_FILE = /^(precheck|postcheck|apply|cleanup|open-prep)_(\d{8})_(\d{6})\.txt$/;
export const OPS_FILE_MAX = 200_000;
const logsDir = () => join(process.env.DATA_DIR || join(homedir(), 'sgb-data'), 'logs');
export type OpsFile = { name: string; kind: string; at: string; size: number };
/* v10.251 (docs/387) — 가장 최근 precheck 결과 파일 요약(읽기만) */
const PRE_FILE = /^precheck_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.txt$/;
export type PrecheckSummary = {
  file: string; at: string; version: string | null; pass: number; fail: number; warn: number;
  applied: number | null; files: number | null; pending: number | null; drift: number | null; pendingNames: string[];
  rolledBack: boolean; blockers: number | null; termsPublished: number | null; termsDraft: number | null; ageHours: number;
};

/** precheck 결과 파일 한 개를 읽어 숫자만 뽑음(없거나 못 읽으면 null) */
export function readPrecheck(dir = logsDir()): PrecheckSummary | null {
  try {
    const name = readdirSync(dir).filter((f) => PRE_FILE.test(f)).sort().pop();
    if (!name) return null;
    const p = join(dir, name);
    const st = lstatSync(p);
    if (!st.isFile() || st.size > 2_000_000) return null;
    const txt = readFileSync(p, 'utf8');
    const sum = txt.match(/적용 전 점검 — 통과 (\d+) · 실패 (\d+) · 확인 (\d+)/);
    if (!sum) return null;
    const num = (re: RegExp) => { const m = txt.match(re); return m ? Number(m[1]) : null; };
    const mig = txt.match(/마이그레이션 — 적용됨 (\d+|\?) · 새 킷의 파일 (\d+) · 올릴 것 (\d+) · 바뀐 파일 (\d+)/);
    const names = [...txt.matchAll(/^\s+올릴 것: (.+)$/gm)].flatMap((m) => m[1]!.trim().split(/\s+/)).filter(Boolean).slice(0, 30);
    const head = txt.split('\n', 1)[0] ?? '';
    const ver = head.match(/올릴 판 (v[\w.\-]{1,20})\s*$/);
    const m = name.match(PRE_FILE)!;
    return {
      file: name, at: `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`, version: ver ? ver[1]! : null,
      pass: Number(sum[1]), fail: Number(sum[2]), warn: Number(sum[3]),
      applied: mig && mig[1] !== '?' ? Number(mig[1]) : null, files: mig ? Number(mig[2]) : null,
      pending: mig ? Number(mig[3]) : null, drift: mig ? Number(mig[4]) : null, pendingNames: names,
      rolledBack: /확인  되돌린 상태/.test(txt), blockers: num(/오픈 차단 (\d+)건/),
      termsPublished: num(/약관: 게시 (\d+)\(/), termsDraft: num(/약관: 게시 \d+\(.*?\) · 초안 (\d+)/),
      ageHours: Math.max(0, Math.floor((Date.now() - st.mtimeMs) / 3_600_000)),
    };
  } catch { return null; }
}

export function releaseKind(prev: string | null, now: string): ReleaseKind {
  if (!prev) return 'FIRST';
  if (!/\d/.test(prev) || !/\d/.test(now)) return 'OTHER';
  const c = versionCmp(now, prev);
  return c > 0 ? 'UP' : c < 0 ? 'BACK' : 'OTHER';
}

/** postcheck 결과 파일 한 개를 읽어 숫자만 뽑음(없거나 못 읽으면 null) */
export function readPostcheck(dir = logsDir()): PostcheckSummary | null {
  try {
    const name = readdirSync(dir).filter((f) => PC_FILE.test(f)).sort().pop();
    if (!name) return null;
    const p = join(dir, name);
    if (statSync(p).size > 2_000_000) return null;
    const txt = readFileSync(p, 'utf8');
    const sum = txt.match(/적용 후 확인 — 통과 (\d+) · 실패 (\d+) · 확인 (\d+)/);
    if (!sum) return null;
    const head = txt.split('\n', 1)[0] ?? '';
    const ver = head.match(/— (v[\w.\-]{1,20})\s*$/);
    const cmp = txt.match(/같음 (\d+)개 · 바뀜 (\d+)개/);
    const m = name.match(PC_FILE)!;
    return {
      file: name, at: `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`, version: ver ? ver[1]! : null,
      pass: Number(sum[1]), fail: Number(sum[2]), warn: Number(sum[3]),
      same: cmp ? Number(cmp[1]) : null, changed: cmp ? Number(cmp[2]) : null,
      ageHours: Math.max(0, Math.floor((Date.now() - statSync(p).mtimeMs) / 3_600_000)),
    };
  } catch { return null; }
}

@Injectable()
export class ReleaseLogService implements OnApplicationBootstrap {
  private readonly log = new Logger(ReleaseLogService.name);
  constructor(private readonly db: DatabaseService) {}

  /* DB 연결(DatabaseService.onModuleInit)이 만들어진 뒤 · 띄울 때 DB 가 잠깐 끊기면 몇 번 다시 */
  async onApplicationBootstrap() {
    for (let i = 0; i < 3; i++) {
      try { await this.record(); return; } catch (e) {
        if (i === 2) this.log.warn(`운영 적용 기록을 적지 못함(API 는 그대로 뜸) — ${(e as Error).message?.slice(0, 120)}`);
        else await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  /** 판이 가장 최근 줄과 다르면 한 줄 — 적었으면 그 줄, 아니면 null */
  async record(version = APP_VERSION): Promise<{ kind: ReleaseKind; prev: string | null } | null> {
    if (!version || version === '?') return null;
    const [last] = await this.db.query<{ version: string }>(`SELECT version FROM ops_release_log ORDER BY id DESC LIMIT 1`);
    const prev = last?.version ?? null;
    if (prev === version) return null;
    const kind = releaseKind(prev, version);
    /* 같은 판을 두 번 적지 않게 — 그 사이 다른 프로세스가 먼저 적었으면 넣지 않음 */
    const ins = await this.db.query<{ id: number }>(
      `INSERT INTO ops_release_log (version, prev_version, kind, host)
       SELECT $1, $2, $3, $4 WHERE NOT EXISTS (SELECT 1 FROM (SELECT version FROM ops_release_log ORDER BY id DESC LIMIT 1) l WHERE l.version = $1)
       RETURNING id`, [version, prev, kind, hostname().slice(0, 100)]);
    if (!ins.length) return null;
    this.log.log(`운영 적용 기록 — ${prev ?? '(처음)'} → ${version} (${kind})`);
    return { kind, prev };
  }

  /** 운영 화면 첫 화면 카드 — 지금 판 · 최근 10줄 · 가장 최근 postcheck 결과(읽기만) */
  async list() {
    const rows = await this.db.query<ReleaseRow>(
      `SELECT id::int, version, prev_version AS prev, kind, host,
              to_char(booted_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS at
         FROM ops_release_log ORDER BY booted_at DESC, id DESC LIMIT 10`);
    return {
      now: { version: APP_VERSION, startedAt: PROCESS_STARTED_AT.toISOString() },
      rows, postcheck: readPostcheck(), precheck: readPrecheck(),
    };
  }

  /** 하루 요약 한 줄 — 「운영 판 v10.244 · 마지막 바뀜 11-12 13:20(올림 · 앞 판 v10.243)」 */
  async digestLine(): Promise<string> {
    const [r] = await this.db.query<ReleaseRow>(
      `SELECT version, prev_version AS prev, kind, to_char(booted_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') AS at
         FROM ops_release_log ORDER BY id DESC LIMIT 1`);
    const KO: Record<ReleaseKind, string> = { FIRST: '첫 기록', UP: '올림', BACK: '되돌림', OTHER: '바뀜' };
    return r ? `운영 판 ${APP_VERSION} · 마지막 바뀜 ${r.at}(${KO[r.kind]}${r.prev ? ` · 앞 판 ${r.prev}` : ''})` : `운영 판 ${APP_VERSION} · 적용 기록 없음`;
  }

  /** v10.247 — 결과 파일 최근 10개(파일 이름의 날짜 · 시각 순 · 읽기만) */
  files(dir = logsDir()): { dir: string; files: OpsFile[] } {
    let names: string[] = [];
    try { names = readdirSync(dir).filter((f) => OPS_FILE.test(f)); } catch { return { dir, files: [] }; }
    const stamp = (f: string) => { const m = f.match(OPS_FILE)!; return m[2]! + m[3]!; };
    const files = names.sort((a, b) => stamp(b).localeCompare(stamp(a)) || a.localeCompare(b)).slice(0, 10).map((name) => {
      const m = name.match(OPS_FILE)!; const d = m[2]!, h = m[3]!;
      let size = 0; try { size = statSync(join(dir, name)).size; } catch { /* 지워진 파일 */ }
      return { name, kind: m[1]!, at: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)} ${h.slice(0, 2)}:${h.slice(2, 4)}:${h.slice(4, 6)}`, size };
    });
    return { dir, files };
  }

  /** v10.247 — 결과 파일 본문(이름 형식이 맞는 것만 · 앞 200KB · 읽기만) */
  file(name: unknown, dir = logsDir()): { name: string; size: number; truncated: boolean; text: string } {
    if (typeof name !== 'string' || !OPS_FILE.test(name)) throw new PolicyViolation('OPS_FILE_NAME', '적용 스크립트 결과 파일(precheck · postcheck · apply · cleanup · open-prep)만 열 수 있습니다.');
    const p = join(dir, name);
    let size: number;
    try { const st = lstatSync(p); if (!st.isFile()) throw new Error('not file'); size = st.size; }
    catch { throw new PolicyViolation('OPS_FILE_MISSING', '그 결과 파일이 서버에 없습니다(지워졌을 수 있음).'); }
    const fd = openSync(p, 'r');
    try {
      const buf = Buffer.alloc(Math.min(size, OPS_FILE_MAX));
      const n = readSync(fd, buf, 0, buf.length, 0);
      return { name, size, truncated: size > OPS_FILE_MAX, text: buf.subarray(0, n).toString('utf8') };
    } finally { closeSync(fd); }
  }
}

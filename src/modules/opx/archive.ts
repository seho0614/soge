import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, statfsSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createGzip, gunzipSync } from 'node:zlib';
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { AwsCredentialChain } from '../file/storage';
import { presign } from '../file/sigv4';

/* ---------------------------------------------------------------------
 * v10.509 (D275 · docs/647) 감사 · 접속 기록 장기 보관 — 대표 11/20 「㊺ ①」 · 「감사 · 접속기록은 3년 보관」
 *
 *   묶음: 종류(AUDIT 감사 기록 · PII 개인정보 접속기록 · ALERT 운영 알림 · SETTING 설정 바뀐 기록 · LOGIN 운영자 로그인) × 지난 달(한국 달)
 *         → gzip JSON 줄(첫 줄 머리) · 서버 디스크(ARCHIVE_DIR · 없으면 DATA_DIR/backup/log-archive — 앱 폴더 밖 · 올린 파일 백업 폴더 옆) · 쓰기 한 번(wx · 읽기만 권한)
 *   지문: 묶음 sha256 · 목록 지문 = sha256(앞 묶음 목록 지문 | 종류 | 달 | 줄 수 | 첫 · 끝 번호 | sha256 | 감사 사슬 머리 순번 | 머리 지문)
 *         + 감사 기록 OPX_ARCHIVE_BUNDLE 한 줄(목록 지문) — 그 줄도 D235 사슬에 들어가 목록이 사슬에 묶임
 *   IP · User-Agent 는 묶지 않음(1년 뒤 마스킹 규칙 · 사슬 본문과 같음) · 운영자 로그인은 가린 IP 만(원래 표 그대로)
 *   디스크 밖: opx.archive_s3 on + .env BACKUP_S3_BUCKET(올린 파일 백업과 같은 버킷 · ARCHIVE_S3_PREFIX 처음 log-archive) — 없으면 NOT_READY · 화면 「디스크 밖 보관 아님」
 *   복원 확인: 파일(없으면 S3) 다시 읽어 sha256 · 압축 풀기 · 줄 수 · 첫 · 끝 번호 · 목록 지문 다시 셈 · (DB 줄이 남아 있으면) 줄 수 · 감사 끝 줄 사슬 지문 대조
 *   파기: 보관 개월(opx.archive_keep_months 처음 36 · 최소 12 — 서버 · DB 무늬 둘 다) 지난 묶음 → 파기 사건(파일 · sha256 · 줄 수) · 감사 한 줄 → 파일 · S3 지움(목록 줄은 남음)
 *   DB 원래 줄 정리: opx.archive_db_purge_months(처음 0 = 안 함) — DB 함수 fn_opx_purge_month 가 확인 끝난 달만
 *     (보안 검토 B-1 ~ B-3: S3 올림 성공 묶음만 · 13개월 미만이면 함수가 막음 · 지우기 트리거도 같은 조건을 다시 봄)
 * ------------------------------------------------------------------- */

export const ARCHIVE_SOURCES = ['AUDIT', 'PII', 'ALERT', 'SETTING', 'LOGIN'] as const;
export type ArchiveSource = (typeof ARCHIVE_SOURCES)[number];
export const ARCHIVE_SOURCE_KO: Record<string, string> = { AUDIT: '감사 기록', PII: '개인정보 접속기록', ALERT: '운영 알림', SETTING: '설정 바뀐 기록', LOGIN: '운영자 로그인' };
/** 보관 개월 무늬 — DB 설정 무늬(value_pattern)와 같음 · 법정 최소 12개월 */
export const KEEP_MONTHS_RE = /^(1[2-9]|[2-9][0-9]|1[01][0-9]|120)$/;
export const PURGE_MONTHS_RE = /^(0|1[3-9]|[2-9][0-9]|1[01][0-9]|120)$/;
const S3_BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const S3_PREFIX_RE = /^[A-Za-z0-9._/-]{1,100}$/;
const PAGE = 2000;
const STAFF_ROLES = ['ADMIN', 'SUPER', 'REVIEWER', 'PAYOUT', 'PARTNER_MAL', 'PARTNER_AFF', 'ACCOUNTANT'];

/* 종류마다 쪽 읽기 SQL(값은 $n · 시각 범위 $1 ~ $2 · 지난 번호 $3 · 쪽 크기 $4) */
const PAGE_SQL: Record<ArchiveSource, string> = {
  AUDIT: `SELECT id, actor_account_id, actor_role, action, target_type, target_id, before_data, after_data, occurred_at, chain_seq, chain_prev, chain_hash
            FROM audit.audit_logs WHERE occurred_at >= $1 AND occurred_at < $2 AND id > $3::bigint ORDER BY id LIMIT $4::int`,
  PII: `SELECT id, actor_account_id, lead_id, access_type, reason, target_type, target_account_id, occurred_at
          FROM audit.pii_access_logs WHERE occurred_at >= $1 AND occurred_at < $2 AND id > $3::bigint ORDER BY id LIMIT $4::int`,
  ALERT: `SELECT id, alert_code, severity, title, detail, raised_at, acknowledged_by, acknowledged_at
            FROM ops_alerts WHERE raised_at >= $1 AND raised_at < $2 AND id > $3::bigint ORDER BY id LIMIT $4::int`,
  SETTING: `SELECT id, key, before_val, after_val, secret, changed_by, via, db_user, reason, at
              FROM site_setting_changes WHERE at >= $1 AND at < $2 AND id > $3::bigint ORDER BY id LIMIT $4::int`,
  LOGIN: `SELECT h.id, h.account_id, h.at, h.ok, h.ip_masked, h.ua_kind
            FROM login_history h WHERE h.at >= $1 AND h.at < $2 AND h.id > $3::bigint
             AND EXISTS (SELECT 1 FROM account_roles r WHERE r.account_id = h.account_id AND r.role = ANY($5::text[]))
           ORDER BY h.id LIMIT $4::int`,
};
/* 종류마다 그 달 줄 수 · 가장 작은 달(한국) */
const COUNT_SQL: Record<ArchiveSource, string> = {
  AUDIT: `SELECT count(*)::int AS n, max(id)::text AS mx FROM audit.audit_logs WHERE occurred_at >= $1 AND occurred_at < $2`,
  PII: `SELECT count(*)::int AS n, max(id)::text AS mx FROM audit.pii_access_logs WHERE occurred_at >= $1 AND occurred_at < $2`,
  ALERT: `SELECT count(*)::int AS n, max(id)::text AS mx FROM ops_alerts WHERE raised_at >= $1 AND raised_at < $2`,
  SETTING: `SELECT count(*)::int AS n, max(id)::text AS mx FROM site_setting_changes WHERE at >= $1 AND at < $2`,
  LOGIN: `SELECT count(*)::int AS n, max(h.id)::text AS mx FROM login_history h WHERE h.at >= $1 AND h.at < $2
            AND EXISTS (SELECT 1 FROM account_roles r WHERE r.account_id = h.account_id AND r.role = ANY($3::text[]))`,
};
const FIRST_SQL: Record<ArchiveSource, string> = {
  AUDIT: `SELECT to_char(min(occurred_at) AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') AS m FROM audit.audit_logs`,
  PII: `SELECT to_char(min(occurred_at) AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') AS m FROM audit.pii_access_logs`,
  ALERT: `SELECT to_char(min(raised_at) AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') AS m FROM ops_alerts`,
  SETTING: `SELECT to_char(min(at) AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') AS m FROM site_setting_changes`,
  LOGIN: `SELECT to_char(min(at) AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') AS m FROM login_history`,
};

const n = (v: unknown) => Number(v ?? 0);
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const kstMonth = (add = 0) => { const d = new Date(Date.now() + 9 * 3600e3); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + add); return d.toISOString().slice(0, 7); };
const nextMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number) as [number, number]; return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };
/** 한국 달 첫날 00:00 의 UTC ISO */
const kstStart = (ym: string) => new Date(`${ym}-01T00:00:00+09:00`).toISOString();

export function archiveDir(): string {
  return process.env.ARCHIVE_DIR || join(process.env.DATA_DIR || join(homedir(), 'sgb-data'), 'backup', 'log-archive');
}

async function settingsOf(db: DatabaseService) {
  const rows = await db.query<{ key: string; value: string | null }>(
    `SELECT key, value FROM site_settings WHERE key IN ('opx.archive', 'opx.archive_s3', 'opx.archive_keep_months', 'opx.archive_db_purge_months')`);
  const g = (k: string) => rows.find((r) => r.key === k)?.value ?? '';
  const keepRaw = g('opx.archive_keep_months'); const purgeRaw = g('opx.archive_db_purge_months');
  return {
    on: g('opx.archive') === 'on', s3On: g('opx.archive_s3') === 'on',
    /* 무늬가 틀리면(DB 를 손으로 고친 경우) 처음 값 · 정리는 끔 — 최소보다 짧게 지우는 일은 없음 */
    keepMonths: KEEP_MONTHS_RE.test(keepRaw) ? Number(keepRaw) : 36,
    purgeMonths: PURGE_MONTHS_RE.test(purgeRaw) ? Number(purgeRaw) : 0,
  };
}

/* ── 디스크 밖(S3) ── */
export function s3Conf() {
  const bucket = process.env.BACKUP_S3_BUCKET || '';
  const prefix = (process.env.ARCHIVE_S3_PREFIX || 'log-archive').replace(/^\/+|\/+$/g, '');
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'ap-northeast-2';
  const ready = S3_BUCKET_RE.test(bucket) && S3_PREFIX_RE.test(prefix);
  return { bucket, prefix, region, ready };
}
const s3Key = (prefix: string, source: string, file: string) => `${prefix}/${source.toLowerCase()}/${file}`;
let creds: AwsCredentialChain | null = null;
async function s3Signed(method: 'PUT' | 'GET' | 'DELETE', key: string, headers?: Record<string, string>) {
  const c = s3Conf();
  if (!c.ready) throw new StateConflict('NOT_READY', '디스크 밖(S3) 보관 준비가 안 됨 — .env BACKUP_S3_BUCKET 을 확인하십시오.');
  creds ??= new AwsCredentialChain();
  return presign({ method, url: `https://${c.bucket}.s3.${c.region}.amazonaws.com/${key}`, region: c.region, credentials: await creds.get(), expiresIn: 300, signedHeaders: headers }).url;
}
/** 실제 외부 호출 — 점검판에서는 opx.archive_s3 가 꺼져 있어 부르지 않음 */
async function s3Put(key: string, body: Buffer) {
  const url = await s3Signed('PUT', key, { 'content-type': 'application/gzip' });
  const r = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/gzip' }, body: new Uint8Array(body), signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error(`S3 PUT ${r.status}`);
}
async function s3Get(key: string): Promise<Buffer | null> {
  const r = await fetch(await s3Signed('GET', key), { signal: AbortSignal.timeout(120_000) });
  if (r.status === 404 || r.status === 403) return null;
  if (!r.ok) throw new Error(`S3 GET ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
async function s3Delete(key: string) {
  const r = await fetch(await s3Signed('DELETE', key), { method: 'DELETE', signal: AbortSignal.timeout(30_000) });
  if (!r.ok && r.status !== 404) throw new Error(`S3 DELETE ${r.status}`);
}

/* ── 묶음 만들기 ── */
export interface BundleRow { id: string; source: ArchiveSource; month: string; rows: number; first_id: string | null; last_id: string | null; file_name: string; bytes: string; sha256: string;
  audit_seq: string | null; audit_hash: string | null; prev_manifest: string | null; manifest_hash: string; created_at: string }

export function manifestOf(b: { prev: string | null; source: string; month: string; rows: number; firstId: string | null; lastId: string | null; sha256: string; auditSeq: string | null; auditHash: string | null }) {
  return sha([b.prev ?? 'GENESIS', b.source, b.month, String(b.rows), b.firstId ?? '', b.lastId ?? '', b.sha256, b.auditSeq ?? '', b.auditHash ?? ''].join('|'));
}

async function hashFile(p: string): Promise<{ sha: string; bytes: number }> {
  const h = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(p)) { h.update(chunk as Buffer); bytes += (chunk as Buffer).length; }
  return { sha: h.digest('hex'), bytes };
}

/** 한 종류 · 한 달 묶음 — 이미 있으면 409 · 지난 달까지만 */
export async function makeBundle(db: DatabaseService, source: ArchiveSource, ym: string, actor: string | null) {
  if (!(ARCHIVE_SOURCES as readonly string[]).includes(source)) throw new PolicyViolation('OPX_ARCHIVE_SOURCE', '묶을 기록 종류가 올바르지 않습니다.');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym) || ym >= kstMonth()) throw new PolicyViolation('OPX_ARCHIVE_MONTH', '지난 달까지만 묶습니다.');
  const [dup] = await db.query(`SELECT 1 FROM opx_archive_bundles WHERE source = $1 AND month = $2::date`, [source, `${ym}-01`]);
  if (dup) throw new StateConflict('OPX_ARCHIVE_EXISTS', '이미 묶은 달입니다.');
  const f = kstStart(ym), t = kstStart(nextMonth(ym));
  const dir = archiveDir();
  await fsp.mkdir(dir, { recursive: true, mode: 0o750 });
  const file = `${source.toLowerCase()}_${ym}.jsonl.gz`;
  const full = join(dir, file);
  if (existsSync(full)) throw new StateConflict('OPX_ARCHIVE_FILE', '같은 이름의 묶음 파일이 이미 있습니다 — 보관 폴더를 확인하십시오(덮어쓰지 않음).');
  const tmp = `${full}.part`;
  const gz = createGzip({ level: 9 });
  const out = createWriteStream(tmp, { flags: 'w', mode: 0o640 });
  gz.pipe(out);
  const put = async (line: string) => { if (!gz.write(line + '\n')) await once(gz, 'drain'); };
  await put(JSON.stringify({ sgb: 'log-archive', v: 1, source, month: ym, from: f, to: t, made: new Date().toISOString() }));
  let last = '0', rows = 0, firstId: string | null = null;
  for (;;) {
    const page = await db.query<Record<string, unknown> & { id: string }>(PAGE_SQL[source], source === 'LOGIN' ? [f, t, last, PAGE, STAFF_ROLES] : [f, t, last, PAGE]);
    for (const r of page) { const id = String(r.id); await put(JSON.stringify({ ...r, id })); firstId ??= id; last = id; rows++; }
    if (page.length < PAGE) break;
  }
  gz.end();
  await finished(out);
  const { sha: fileSha, bytes } = await hashFile(tmp);
  await fsp.rename(tmp, full);
  await fsp.chmod(full, 0o440).catch(() => undefined);
  return db.transaction(async () => {
    await db.query(`SELECT pg_advisory_xact_lock(7426275)`);
    const [prev] = await db.query<{ m: string }>(`SELECT manifest_hash AS m FROM opx_archive_bundles ORDER BY id DESC LIMIT 1`);
    const [head] = await db.query<{ seq: string; hash: string }>(`SELECT chain_seq::text AS seq, chain_hash AS hash FROM audit.audit_logs WHERE chain_seq IS NOT NULL ORDER BY chain_seq DESC LIMIT 1`);
    const m = { prev: prev?.m ?? null, source, month: ym, rows, firstId, lastId: rows ? last : null, sha256: fileSha, auditSeq: head?.seq ?? null, auditHash: head?.hash ?? null };
    const manifest = manifestOf(m);
    const [b] = await db.query<{ id: string }>(
      `INSERT INTO opx_archive_bundles (source, month, rows, first_id, last_id, file_name, bytes, sha256, audit_seq, audit_hash, prev_manifest, manifest_hash, created_by)
       VALUES ($1, $2::date, $3::int, $4::bigint, $5::bigint, $6, $7::bigint, $8, $9::bigint, $10, $11, $12, $13) RETURNING id::text AS id`,
      [source, `${ym}-01`, rows, m.firstId, m.lastId, file, bytes, fileSha, m.auditSeq, m.auditHash, m.prev, manifest, actor]);
    await db.query(
      `INSERT INTO audit.audit_logs (actor_account_id, actor_role, action, target_type, target_id, after_data) VALUES ($1, $2, 'OPX_ARCHIVE_BUNDLE', 'ARCHIVE', NULL, $3::jsonb)`,
      [actor, actor ? 'SUPER' : 'SYSTEM', JSON.stringify({ bundleId: b!.id, source, month: ym, rows, sha256: fileSha, manifest, auditSeq: m.auditSeq })]);
    return { id: b!.id, source, month: ym, rows, bytes, sha256: fileSha, manifest };
  });
}

/* ── 복원 확인 ── */
async function bundleOf(db: DatabaseService, id: string): Promise<BundleRow> {
  if (!/^\d{1,18}$/.test(id)) throw new NotFound('없는 묶음입니다.');
  const [b] = await db.query<BundleRow>(
    `SELECT id::text AS id, source, to_char(month, 'YYYY-MM') AS month, rows, first_id::text AS first_id, last_id::text AS last_id, file_name, bytes::text AS bytes, sha256,
            audit_seq::text AS audit_seq, audit_hash, prev_manifest, manifest_hash, created_at FROM opx_archive_bundles WHERE id = $1::bigint`, [id]);
  if (!b) throw new NotFound('없는 묶음입니다.');
  return b;
}
async function disposed(db: DatabaseService, id: string) {
  const [d] = await db.query(`SELECT 1 FROM opx_archive_events WHERE bundle_id = $1::bigint AND kind = 'DISPOSE'`, [id]);
  return !!d;
}

export async function verifyBundle(db: DatabaseService, id: string, actor: string | null) {
  const b = await bundleOf(db, id);
  if (await disposed(db, id)) throw new StateConflict('OPX_ARCHIVE_DISPOSED', '파기한 묶음입니다.');
  const c = s3Conf();
  let buf: Buffer | null = null; let from = 'DISK';
  const p = join(archiveDir(), b.file_name);
  if (existsSync(p)) buf = await fsp.readFile(p);
  else if (c.ready) {
    const [up] = await db.query(`SELECT 1 FROM opx_archive_events WHERE bundle_id = $1::bigint AND kind = 'S3_PUT' AND ok`, [id]);
    if (up) { buf = await s3Get(s3Key(c.prefix, b.source, b.file_name)).catch(() => null); from = 'S3'; }
  }
  const d: Record<string, unknown> = { from, file: b.file_name };
  let ok = false;
  if (!buf) d.why = '묶음 파일이 없음(디스크 · S3)';
  else {
    d.shaOk = sha(buf) === b.sha256; d.bytesOk = buf.length === Number(b.bytes);
    let lines: string[] = [];
    try { lines = gunzipSync(buf).toString('utf8').split('\n').filter((x) => x.length); d.gzipOk = true; } catch { d.gzipOk = false; }
    let head: Record<string, unknown> = {}; let rowsIn: Array<Record<string, unknown>> = [];
    try { head = JSON.parse(lines[0] ?? '{}'); rowsIn = lines.slice(1).map((x) => JSON.parse(x) as Record<string, unknown>); d.jsonOk = true; } catch { d.jsonOk = false; }
    d.headOk = head.source === b.source && head.month === b.month;
    d.rowsOk = rowsIn.length === b.rows;
    d.idsOk = (rowsIn[0]?.id ?? null) === b.first_id && (rowsIn[rowsIn.length - 1]?.id ?? null) === b.last_id;
    d.manifestOk = manifestOf({ prev: b.prev_manifest, source: b.source, month: b.month, rows: b.rows, firstId: b.first_id, lastId: b.last_id, sha256: b.sha256, auditSeq: b.audit_seq, auditHash: b.audit_hash }) === b.manifest_hash;
    const [pv] = await db.query<{ m: string | null }>(`SELECT manifest_hash AS m FROM opx_archive_bundles WHERE id < $1::bigint ORDER BY id DESC LIMIT 1`, [id]);
    d.prevOk = (pv?.m ?? null) === (b.prev_manifest ?? null);
    /* DB 줄이 남아 있으면 줄 수 · (감사) 끝 줄 사슬 지문 대조 */
    const f = kstStart(b.month), t = kstStart(nextMonth(b.month));
    const [cnt] = await db.query<{ n: number }>(COUNT_SQL[b.source], b.source === 'LOGIN' ? [f, t, STAFF_ROLES] : [f, t]);
    if (n(cnt?.n) > 0) {
      d.dbRows = n(cnt?.n); d.dbMatch = n(cnt?.n) === b.rows;
      if (b.source === 'AUDIT' && b.last_id) {
        const [lr] = await db.query<{ h: string | null }>(`SELECT chain_hash AS h FROM audit.audit_logs WHERE id = $1::bigint`, [b.last_id]);
        d.chainOk = (lr?.h ?? null) === ((rowsIn[rowsIn.length - 1]?.chain_hash as string | null | undefined) ?? null);
      }
    } else d.dbMatch = null;
    ok = !!(d.shaOk && d.bytesOk && d.gzipOk && d.jsonOk && d.headOk && d.rowsOk && d.idsOk && d.manifestOk && d.prevOk && d.dbMatch !== false && d.chainOk !== false);
  }
  await db.query(`INSERT INTO opx_archive_events (bundle_id, kind, ok, detail, created_by) VALUES ($1::bigint, 'VERIFY', $2, $3::jsonb, $4)`, [id, ok, JSON.stringify(d), actor]);
  if (!ok) {
    await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at) VALUES ('OPX_ARCHIVE_BAD', 'CRITICAL', $1, $2::jsonb, clock_timestamp()) ON CONFLICT DO NOTHING`,
      [`기록 묶음 복원 확인 실패 — ${ARCHIVE_SOURCE_KO[b.source]} ${b.month} — 위험감지 › 기록 장기 보관`, JSON.stringify({ bundleId: id, ...d })]);
  }
  return { id, ok, ...d };
}

/* ── 디스크 밖 올리기 · 파기 · 정리 ── */
async function uploadPending(db: DatabaseService, max: number) {
  const c = s3Conf();
  const rows = await db.query<{ id: string; source: string; file_name: string }>(
    `SELECT b.id::text AS id, b.source, b.file_name FROM opx_archive_bundles b
      WHERE NOT EXISTS (SELECT 1 FROM opx_archive_events e WHERE e.bundle_id = b.id AND (e.kind = 'DISPOSE' OR (e.kind = 'S3_PUT' AND e.ok)))
      ORDER BY b.id LIMIT $1::int`, [max]);
  let up = 0, fail = 0;
  for (const r of rows) {
    const key = s3Key(c.prefix, r.source, r.file_name);
    try {
      await s3Put(key, await fsp.readFile(join(archiveDir(), r.file_name)));
      await db.query(`INSERT INTO opx_archive_events (bundle_id, kind, ok, detail) VALUES ($1::bigint, 'S3_PUT', true, $2::jsonb)`, [r.id, JSON.stringify({ bucket: c.bucket, key })]);
      up++;
    } catch (e) {
      fail++;
      await db.query(`INSERT INTO opx_archive_events (bundle_id, kind, ok, detail) VALUES ($1::bigint, 'S3_PUT', false, $2::jsonb)`, [r.id, JSON.stringify({ key, error: String((e as Error).message).slice(0, 200) })]);
    }
  }
  if (fail) {
    await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
       SELECT 'OPX_ARCHIVE_S3_FAIL', 'WARN', '기록 묶음을 디스크 밖(S3)에 올리지 못함 — 서버 역할 권한 · 버킷 확인', $1::jsonb, clock_timestamp()
        WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'OPX_ARCHIVE_S3_FAIL' AND raised_at > now() - interval '20 hours')
       ON CONFLICT DO NOTHING`, [JSON.stringify({ fail, bucket: c.bucket })]);
  }
  return { up, fail };
}

/** 보관 개월 지난 묶음 파기 — 파기 사건(목록 · 지문) · 감사 한 줄을 먼저 남기고 파일 · S3 를 지움 */
async function disposeExpired(db: DatabaseService, keepMonths: number) {
  const cut = (() => { const [y, m] = kstMonth().split('-').map(Number) as [number, number]; const k = y * 12 + (m - 1) - keepMonths; return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, '0')}-01`; })();
  const rows = await db.query<{ id: string; source: string; month: string; rows: number; file_name: string; sha256: string; manifest_hash: string }>(
    `SELECT b.id::text AS id, b.source, to_char(b.month, 'YYYY-MM') AS month, b.rows, b.file_name, b.sha256, b.manifest_hash FROM opx_archive_bundles b
      WHERE b.month < $1::date AND NOT EXISTS (SELECT 1 FROM opx_archive_events e WHERE e.bundle_id = b.id AND e.kind = 'DISPOSE') ORDER BY b.id LIMIT 24`, [cut]);
  const c = s3Conf(); let done = 0;
  for (const r of rows) {
    const [s3] = await db.query(`SELECT 1 FROM opx_archive_events WHERE bundle_id = $1::bigint AND kind = 'S3_PUT' AND ok`, [r.id]);
    const info = { bundleId: r.id, source: r.source, month: r.month, rows: n(r.rows), file: r.file_name, sha256: r.sha256, manifest: r.manifest_hash, keepMonths, s3: !!s3 };
    await db.transaction(async () => {
      await db.query(`INSERT INTO opx_archive_events (bundle_id, kind, ok, detail) VALUES ($1::bigint, 'DISPOSE', true, $2::jsonb)`, [r.id, JSON.stringify(info)]);
      await db.query(`INSERT INTO audit.audit_logs (actor_account_id, actor_role, action, target_type, target_id, after_data) VALUES (NULL, 'SYSTEM', 'OPX_ARCHIVE_DISPOSE', 'ARCHIVE', NULL, $1::jsonb)`, [JSON.stringify(info)]);
    });
    const p = join(archiveDir(), r.file_name);
    await fsp.chmod(p, 0o640).catch(() => undefined);
    await fsp.rm(p, { force: true });
    if (s3 && c.ready) await s3Delete(s3Key(c.prefix, r.source, r.file_name)).catch(() => undefined);
    done++;
  }
  return done;
}

/** DB 원래 줄 정리 — 13개월 이상 · 복원 확인 성공 · 디스크 밖(S3) 올림 성공한 묶음만(보안 검토 B-2 · S3 사본이 없으면 DB 줄은 지우지 않음 · DB 함수도 다시 봄) */
async function purgeDb(db: DatabaseService, purgeMonths: number) {
  if (purgeMonths < 13) return { purged: 0, rows: 0 };
  const rows = await db.query<{ id: string }>(
    `SELECT b.id::text AS id FROM opx_archive_bundles b
      WHERE b.source IN ('AUDIT', 'PII', 'ALERT', 'SETTING')
        AND b.month < (date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') - make_interval(months => $1::int))::date
        AND EXISTS (SELECT 1 FROM opx_archive_events e WHERE e.bundle_id = b.id AND e.kind = 'VERIFY' AND e.ok)
        AND EXISTS (SELECT 1 FROM opx_archive_events e WHERE e.bundle_id = b.id AND e.kind = 'S3_PUT' AND e.ok)
        AND NOT EXISTS (SELECT 1 FROM opx_archive_events e WHERE e.bundle_id = b.id AND (e.kind = 'DISPOSE' OR e.kind = 'PURGE'))
      ORDER BY b.id LIMIT 3`, [purgeMonths]);
  let purged = 0, total = 0;
  for (const r of rows) {
    /* 정리 직전에 한 번 더 복원 확인 — 실패하면 DB 함수가 막음(마지막 확인 실패) */
    const v = await verifyBundle(db, r.id, null);
    if (!v.ok) continue;
    try {
      const [x] = await db.transaction(() => db.query<{ n: number }>(`SELECT fn_opx_purge_month($1::bigint) AS n`, [r.id]));
      if (n(x?.n) >= 0) { purged++; total += n(x?.n); }
    } catch { /* DB 함수가 막은 달 — 지우지 않고 다음 날 다시 봄 */ }
  }
  return { purged, rows: total };
}

/** 정기 작업 opx_archive(매일 04:20) · 운영 화면 「지금 돌리기」 */
export async function archiveJob(db: DatabaseService, actor: string | null = null) {
  const s = await settingsOf(db);
  if (!s.on) return { skipped: 'OFF', made: 0 };
  const made: Array<{ source: string; month: string; rows: number }> = [];
  const errors: string[] = [];
  const lastClosed = kstMonth(-1);
  for (const src of ARCHIVE_SOURCES) {
    if (made.length >= 6) break;
    const [lb] = await db.query<{ m: string | null }>(`SELECT to_char(max(month), 'YYYY-MM') AS m FROM opx_archive_bundles WHERE source = $1`, [src]);
    let ym = lb?.m ? nextMonth(lb.m) : ((await db.query<{ m: string | null }>(FIRST_SQL[src]))[0]?.m ?? null);
    while (ym && ym <= lastClosed && made.length < 6) {
      const f = kstStart(ym), t = kstStart(nextMonth(ym));
      const [cnt] = await db.query<{ n: number }>(COUNT_SQL[src], src === 'LOGIN' ? [f, t, STAFF_ROLES] : [f, t]);
      if (n(cnt?.n) > 0) {
        try { const b = await makeBundle(db, src, ym, actor); made.push({ source: src, month: ym, rows: b.rows }); }
        catch (e) { errors.push(`${src} ${ym}: ${String((e as Error).message).slice(0, 120)}`); break; }
      }
      ym = nextMonth(ym);
    }
  }
  let s3 = { up: 0, fail: 0 }; const c = s3Conf();
  if (s.s3On && c.ready) s3 = await uploadPending(db, 10);
  /* 복원 확인 한 묶음 — 가장 오래 확인하지 않은 것 */
  const [vt] = await db.query<{ id: string }>(
    `SELECT b.id::text AS id FROM opx_archive_bundles b
      WHERE NOT EXISTS (SELECT 1 FROM opx_archive_events e WHERE e.bundle_id = b.id AND e.kind = 'DISPOSE')
      ORDER BY (SELECT max(e.at) FROM opx_archive_events e WHERE e.bundle_id = b.id AND e.kind = 'VERIFY') NULLS FIRST, b.id LIMIT 1`);
  const verified = vt ? (await verifyBundle(db, vt.id, actor)).ok : null;
  const disposedN = await disposeExpired(db, s.keepMonths);
  const purge = await purgeDb(db, s.purgeMonths);
  if (errors.length) {
    await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
       SELECT 'OPX_ARCHIVE_FAIL', 'WARN', '기록 묶음 만들기 실패 — 보관 폴더 · 디스크 여유 확인(위험감지 › 기록 장기 보관)', $1::jsonb, clock_timestamp()
        WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'OPX_ARCHIVE_FAIL' AND raised_at > now() - interval '20 hours')
       ON CONFLICT DO NOTHING`, [JSON.stringify({ errors })]);
  }
  return { made: made.length, bundles: made, errors, s3, s3State: !s.s3On ? 'OFF' : c.ready ? 'ON' : 'NOT_READY', verified, disposed: disposedN, purge };
}

/** GET /admin/opx/archive — 상태 · 묶음 목록 · 경고 */
export async function archiveState(db: DatabaseService) {
  const s = await settingsOf(db); const c = s3Conf(); const dir = archiveDir();
  let freeMB: number | null = null;
  try { const st = statfsSync(existsSync(dir) ? dir : homedir()); freeMB = Math.floor((Number(st.bavail) * Number(st.bsize)) / 1048576); } catch { /* 모름 */ }
  const items = await db.query<Record<string, unknown>>(
    `SELECT b.id::text AS id, b.source, to_char(b.month, 'YYYY-MM') AS month, b.rows, b.bytes::text AS bytes, b.sha256, b.manifest_hash AS manifest, b.audit_seq::text AS "auditSeq", b.created_at AS "createdAt",
            (SELECT e.ok FROM opx_archive_events e WHERE e.bundle_id = b.id AND e.kind = 'VERIFY' ORDER BY e.id DESC LIMIT 1) AS "verifyOk",
            (SELECT max(e.at) FROM opx_archive_events e WHERE e.bundle_id = b.id AND e.kind = 'VERIFY') AS "verifiedAt",
            EXISTS (SELECT 1 FROM opx_archive_events e WHERE e.bundle_id = b.id AND e.kind = 'S3_PUT' AND e.ok) AS s3,
            (SELECT max(e.at) FROM opx_archive_events e WHERE e.bundle_id = b.id AND e.kind = 'DISPOSE') AS "disposedAt",
            (SELECT max(e.at) FROM opx_archive_events e WHERE e.bundle_id = b.id AND e.kind = 'PURGE' AND e.ok) AS "purgedAt"
       FROM opx_archive_bundles b ORDER BY b.month DESC, b.source LIMIT 300`);
  const live = items.filter((r) => !r.disposedAt);
  const s3State = !s.s3On ? 'OFF' : c.ready ? 'ON' : 'NOT_READY';
  const offsite = s3State === 'ON' && live.length > 0 && live.every((r) => r.s3 === true);
  const warnings: string[] = [];
  if (!s.on) warnings.push('기록 장기 보관이 꺼져 있습니다(opx.archive = off) — 켜기 SUPER.');
  if (s.on && !offsite) warnings.push(s3State === 'NOT_READY' ? '디스크 밖 보관 아님 — opx.archive_s3 는 켜졌지만 .env BACKUP_S3_BUCKET 이 없습니다(서버 디스크에만 있음).' : '디스크 밖 보관 아님 — 묶음이 서버 디스크에만 있습니다(S3 버킷을 만들고 opx.archive_s3 를 켜면 올립니다).');
  if (live.some((r) => r.verifyOk === false)) warnings.push('복원 확인이 실패한 묶음이 있습니다 — 운영 알림 OPX_ARCHIVE_BAD.');
  if (s.keepMonths < 24) warnings.push('보관 개월이 24개월보다 짧습니다 — 이용자 5만 명 이상 · 고유식별정보 처리 등이면 개인정보 접속기록은 2년 이상(안전성 확보조치 기준 제8조 · 법무 확인).');
  return {
    on: s.on, keepMonths: s.keepMonths, purgeMonths: s.purgeMonths, minMonths: 12, dir, freeMB,
    s3: { state: s3State, bucket: c.ready ? c.bucket : null, prefix: c.prefix }, offsite,
    counts: { bundles: live.length, disposed: items.length - live.length, rows: live.reduce((a, r) => a + n(r.rows), 0) },
    items: items.map((r) => ({ ...r, rows: n(r.rows), bytes: n(r.bytes), sourceKo: ARCHIVE_SOURCE_KO[String(r.source)] })), warnings,
    note: '앱은 묶음 파일을 보관 개월이 지나기 전에는 지우지 않습니다(파기는 정기 작업이 파기 기록 · 감사 한 줄 뒤). 운영 DB 원래 줄은 opx.archive_db_purge_months 가 0 이면 그대로입니다.',
  };
}

/** GET /admin/opx/archive/{id} — 묶음 한 개 · 사건 */
export async function archiveDetail(db: DatabaseService, id: string) {
  const b = await bundleOf(db, id);
  const events = await db.query(`SELECT id::text AS id, kind, ok, detail, at FROM opx_archive_events WHERE bundle_id = $1::bigint ORDER BY id DESC LIMIT 100`, [id]);
  return { ...b, rows: n(b.rows), bytes: n(b.bytes), sourceKo: ARCHIVE_SOURCE_KO[b.source], events };
}

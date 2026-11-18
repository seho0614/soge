import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash, randomInt } from 'crypto';

/* ---------------------------------------------------------------------
 * v10.348 (docs/482) — 운영 화면 허용 IP → Nginx 반영 스크립트 만들기(글자만 · 서버를 바꾸지 않음)
 *
 *   대표 11/18 「관리자 접속 ip 관리 화면 · 적용」 → 「화면은 목록만 보여주고, 반영 스크립트를 보여준다 · 수퍼(SUPER)」 · 허용 IP 목록은 하나(접속 인증 목록).
 *   사람이 운영 서버 ubuntu 창에 붙여 넣습니다. 처음 한 번 deploy/aws/nginx-admin-allow-setup.sh 로 include 를 만든 뒤에만 돕니다.
 *   허용 파일만 새로 씀 → nginx -t → 통과하면 다시 읽기 · 실패하면 옛 파일로 되돌림. 목록이 비면 만들지 않습니다.
 *   대표 11/18 다시 「적용 버튼으로 엔진엑스 구동하여 적용」 → 「단추로 바로 적용 · 감시 서비스」: 프로그램은 요청 파일만 씀(buildRequestText) ·
 *   운영 서버 루트 서비스(deploy/aws/nginx-allow-apply.sh)가 다시 검사해 적용하고 결과를 /var/lib/sgb-nginx-allow/result.json 에 씀. 스크립트 복사는 비상용.
 * ------------------------------------------------------------------- */

export const NGINX_ALLOW_FILE = '/etc/nginx/snippets/sgb-admin-allow.conf';
export const NGINX_SITE_FILE = '/etc/nginx/sites-enabled/sgb';
const IP_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$|^[0-9a-fA-F:]{2,39}$/;

export interface AllowIp { ip: string; memo: string }

/** 메모는 주석으로만 들어갑니다 — 줄바꿈 · 따옴표 · $ · ` 같은 글자를 빼고 40자까지 */
export const safeMemo = (m: string) => (m ?? '').replace(/[^0-9A-Za-z가-힣 ·._()-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
export const validIp = (ip: string) => IP_RE.test(ip);

/** 목록의 짧은 지문(sha256 앞 12자) — 화면 「반영했음」과 스크립트 첫 줄이 같은 목록인지 */
export function listHash(ips: string[], sha: (s: string) => string): string {
  return sha([...ips].sort().join('\n')).slice(0, 12);
}

export function buildNginxAllowScript(list: AllowIp[], hash: string, madeAt: string): string {
  const rows = list.filter((x) => validIp(x.ip));
  if (!rows.length) return '';
  const allow = rows.map((x) => `allow ${x.ip};${safeMemo(x.memo) ? `   # ${safeMemo(x.memo)}` : ''}`).join('\n');
  return [
    '#!/usr/bin/env bash',
    `# 소개뱅크 운영 화면 허용 IP → Nginx 반영 (v10.348 · 만든 때 ${madeAt} · ${rows.length}곳 · 목록 ${hash})`,
    '# 운영 서버 ubuntu 창에 그대로 붙여 넣습니다. 처음 한 번 nginx-admin-allow-setup.sh --apply 를 마친 뒤에만 됩니다.',
    'set -uo pipefail',
    `F=${NGINX_ALLOW_FILE}`,
    `grep -q 'include ${NGINX_ALLOW_FILE};' ${NGINX_SITE_FILE} || { echo '!! 준비가 안 됨 — 먼저 bash ~/sgb/deploy/aws/nginx-admin-allow-setup.sh admin.sogaebank.com --apply'; exit 1; }`,
    'NEW=$(mktemp)',
    "cat > \"$NEW\" <<'SGB_ALLOW_END'",
    `# sgb-admin-allow ${hash} — 운영 화면 › 권한 계층 › 접속 인증 에서 만듦(손으로 고치지 마십시오)`,
    allow,
    'access_log /var/log/nginx/sgb-admin-access.log;',
    'deny all;',
    'SGB_ALLOW_END',
    'echo "== 바뀌는 줄 (< 빠짐 · > 더함)"',
    "diff <(grep -o '^allow [^;]*' \"$F\" 2>/dev/null | sort) <(grep -o '^allow [^;]*' \"$NEW\" | sort) && echo '(바뀐 줄 없음)'",
    'sudo cp -p "$F" "$F.bak"',
    'sudo install -m 644 "$NEW" "$F"; rm -f "$NEW"',
    'if sudo nginx -t; then',
    `  sudo systemctl reload nginx && echo "== 반영함 — 목록 ${hash} · ${rows.length}곳. 운영 화면 「접속 인증」에서 「반영했음」을 누르십시오."`,
    'else',
    '  echo "!! nginx -t 실패 — 옛 파일로 되돌립니다"; sudo cp -p "$F.bak" "$F"; sudo nginx -t && echo "되돌림 끝(Nginx 는 다시 읽지 않았음 — 지금 그대로 돎). 출력을 Claude 에게 보내 주십시오."',
    'fi',
    '',
  ].join('\n');
}

/** 「적용」 요청 파일 — 첫 줄 `# sgb-admin-allow <지문> id=<요청 번호>` · allow 줄(메모는 주석 · 루트 서비스가 버림) · deny all; */
export function buildRequestText(list: AllowIp[], hash: string, id: string): string {
  const rows = list.filter((x) => validIp(x.ip));
  return [`# sgb-admin-allow ${hash} id=${id}`, ...rows.map((x) => `allow ${x.ip};${safeMemo(x.memo) ? `   # ${safeMemo(x.memo)}` : ''}`), 'deny all;', ''].join('\n');
}

/* ---------------------------------------------------------------------
 * v10.349 · 350 (docs/483 · 484) — 화면(StaffIpService)과 정기 작업(scheduler)이 함께 쓰는 상태 읽기 · 요청 쓰기
 * ------------------------------------------------------------------- */
interface Q { query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> }
export interface WatchResult { id: string; hash: string; ok: boolean; at: string; message: string }

/** 요청 폴더(ubuntu) · 결과 폴더(root) — .env 로 바꿀 수 있음(점검판 시험) */
export function nginxWatchDirs() {
  return {
    req: process.env.NGINX_ALLOW_REQ_DIR || path.join(os.homedir(), 'sgb-state', 'nginx-allow'),
    out: process.env.NGINX_ALLOW_OUT_DIR || '/var/lib/sgb-nginx-allow',
  };
}

/** 감시 서비스 — 설치 표시 · 마지막 결과 · 기다리는 요청(결과가 아직 없는 요청 번호) */
export function nginxWatcher(): { installed: boolean; last: WatchResult | null; pending: { id: string; at: string } | null } {
  const d = nginxWatchDirs();
  const installed = fs.existsSync(path.join(d.out, 'installed'));
  let last: WatchResult | null = null;
  try { last = JSON.parse(fs.readFileSync(path.join(d.out, 'result.json'), 'utf8').slice(0, 2000)); } catch { last = null; }
  let pending: { id: string; at: string } | null = null;
  try {
    const f = path.join(d.req, 'request.conf');
    const m = /^# sgb-admin-allow [0-9a-f]{12} id=([0-9A-Za-z-]{8,40})/.exec(fs.readFileSync(f, 'utf8').slice(0, 200));
    if (m && m[1] !== last?.id) pending = { id: m[1]!, at: fs.statSync(f).mtime.toISOString() };
  } catch { pending = null; }
  return { installed, last, pending };
}

const sha = (t: string) => createHash('sha256').update(t).digest('hex');

/** 지금 허용 IP(기한 지난 것 뺌) · 지문 · 마지막으로 고친 때 · 마지막 「반영했음」 · 반영한 목록과 같은가(반영했음 또는 감시 서비스 성공) */
export async function nginxListState(db: Q) {
  const list = await db.query<{ ip: string; memo: string; expiresAt: string | null }>(
    `SELECT host(ip) AS ip, memo, expires_at AS "expiresAt" FROM staff_ip_allow
      WHERE expires_at IS NULL OR expires_at > now() ORDER BY ip`);
  const ips = list.map((x) => x.ip);
  const hash = listHash(ips, sha);
  const [c] = await db.query<{ added: string | null; removed: string | null }>(
    `SELECT (SELECT max(created_at) FROM staff_ip_allow) AS added,
            (SELECT max(occurred_at) FROM audit.audit_logs WHERE action IN ('STAFF_IP_ALLOW_REMOVE', 'STAFF_IP_ALLOW_EXPIRE')) AS removed`);
  const [ap] = await db.query<{ hash: string | null; at: string | null; by: string | null }>(
    `SELECT l.after_data->>'hash' AS hash, l.occurred_at AS at, a.email::text AS by
       FROM audit.audit_logs l LEFT JOIN accounts a ON a.id = l.actor_account_id
      WHERE l.action = 'STAFF_IP_NGINX_APPLIED' ORDER BY l.occurred_at DESC LIMIT 1`);
  const watch = nginxWatcher();
  const changes = [c?.added, c?.removed].filter(Boolean).map((x) => new Date(String(x)).getTime());
  return {
    list, ips, hash, watch, applied: ap ?? null,
    lastChangedAt: changes.length ? new Date(Math.max(...changes)).toISOString() : null,
    appliedSame: (!!ap && ap.hash === hash) || (!!watch.last?.ok && watch.last.hash === hash),
  };
}

/** 요청 파일을 씀(임시 파일 → 이름 바꾸기 · 600). 돌려주는 값은 요청 번호 */
export function writeNginxRequest(list: AllowIp[], hash: string): string {
  const id = `req-${Date.now().toString(36)}${randomInt(36 ** 4).toString(36).padStart(4, '0')}`;
  const d = nginxWatchDirs();
  fs.mkdirSync(d.req, { recursive: true, mode: 0o700 });
  const tmp = path.join(d.req, `.request.${id}`);
  fs.writeFileSync(tmp, buildRequestText(list, hash, id), { mode: 0o600 });
  fs.renameSync(tmp, path.join(d.req, 'request.conf'));
  return id;
}

/* ---------------------------------------------------------------------
 * v10.353 (docs/487) — 막힌 접속 기록: 루트 타이머(sgb-nginx-deny)가 10분마다 쓴 요약 파일을 읽기만
 *   운영 화면 전용 접속 기록(/var/log/nginx/sgb-admin-access.log)에서 Nginx 가 막은 403(화면 · 파일 주소 — /api/ 는 뺌)
 * ------------------------------------------------------------------- */
export interface DeniedRow { ip: string; n7: number; n24: number; last: string; paths: string[] }
export function nginxDenied(): { installed: boolean; at: string | null; total7: number; rows: DeniedRow[] } {
  const d = nginxWatchDirs();
  try {
    const j = JSON.parse(fs.readFileSync(path.join(d.out, 'denied.json'), 'utf8').slice(0, 200_000));
    const rows: DeniedRow[] = Array.isArray(j.rows) ? j.rows.filter((r: DeniedRow) => validIp(String(r?.ip ?? ''))).slice(0, 50) : [];
    return { installed: true, at: typeof j.at === 'string' ? j.at : null, total7: Number(j.total7) || 0, rows };
  } catch {
    return { installed: false, at: null, total7: 0, rows: [] };
  }
}

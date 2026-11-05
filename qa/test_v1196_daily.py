"""v10.196 시험(서버에서 직접 · node · psql) — 올린 파일 백업 cron 없이 · mfa-reset.sh 알림 출처(docs/308)

  cd qa && KIT=$K DB=postgresql://sgb:sgb@localhost:15432/sgb python3 -I test_v1196_daily.py
  (run_regression.sh 의 HOST 목록 — 시험 컨테이너(sgb-qa:v1)에는 node 가 없음)

  ① 코드 — 배치 호출기가 매분 백업 확인 · run-jobs.sh 기본 04:30(.env 를 먼저 읽어 덮을 수 있음) · uploads-backup.sh 설명 ·
     mfa-reset.sh(updated_by 비움 · 사유) · docs/308 · 판
  ② (node) 시각 읽기 · 한국 시간 하루 한 번 · 꺼짐이면 안 부름 · 가짜 백업 스크립트를 하루 한 번만 부름
  ③ (DB) mfa-reset.sh 의 끄기 SQL 을 그대로 → SETTING_CHANGED via DB · by 없음 · 사유 · 되돌림
"""
import json, os, re, shutil, subprocess, tempfile, time

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
DB = os.environ.get('DB')
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
SD = rd('scripts/scheduler-daemon.js'); UD = rd('scripts/uploads-backup-daily.js'); RJ = rd('deploy/aws/run-jobs.sh'); UB = rd('deploy/aws/uploads-backup.sh')
ok('① 배치 호출기 — 매분 tick 과 함께 백업 확인 · UPLOADS_BACKUP_DAILY 있을 때만 · 끝을 기다리지 않음',
   "const daily = require('./uploads-backup-daily').createDailyBackup();" in SD and 'setInterval(() => { tick(); daily.check(); }, EVERY_MS);' in SD
   and 'const atMin = parseAt(env.UPLOADS_BACKUP_DAILY);' in UD and "path.join(root, 'deploy/aws/uploads-backup.sh')" in UD
   and 'if (running || !due(now, atMin, lastDay)) return false;' in UD, '')
ok('① run-jobs.sh — 기본 04:30 · .env 를 먼저 읽어(load_env) 덮을 수 있음 · 문법',
   'export UPLOADS_BACKUP_DAILY="${UPLOADS_BACKUP_DAILY:-04:30}"' in RJ and 0 <= RJ.find('load_env .env') < RJ.find('UPLOADS_BACKUP_DAILY=')
   and subprocess.run(['bash', '-n', os.path.join(K, 'deploy/aws/run-jobs.sh')]).returncode == 0, '')
MR = rd('deploy/aws/mfa-reset.sh')
ok('① uploads-backup.sh 설명(cron 필요 없음) · mfa-reset.sh(updated_by 비움 · 사유 SET LOCAL) · 문법',
   'cron 필요 없음' in UB and "SET LOCAL app.setting_reason = 'mfa-reset.sh off (서버에서 비상 끄기)';" in MR
   and "UPDATE site_settings SET value = 'off', updated_by = NULL, updated_at = now() WHERE key = 'admin.mfa_required';" in MR
   and all(subprocess.run(['bash', '-n', os.path.join(K, f)]).returncode == 0 for f in ('deploy/aws/mfa-reset.sh', 'deploy/aws/uploads-backup.sh')), '')
ok('① 문서 · 판 — docs/308 · v10.196 이상', any(f.startswith('308_') for f in os.listdir(os.path.join(K, 'docs')))
   and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 196), rd('VERSION').strip())

# ── ② node ────────────────────────────────────────────────────────────
T = tempfile.mkdtemp(prefix='t1196_')
try:
    os.makedirs(os.path.join(T, 'deploy/aws'))
    with open(os.path.join(T, 'deploy/aws/uploads-backup.sh'), 'w') as f:
        f.write('#!/usr/bin/env bash\necho x >> "$(dirname "$0")/ran.txt"\necho "   만듦 — 가짜 묶음"\n')
    js = r"""
const m = require(process.argv[1]); const ROOT = process.argv[2]; const t = (s) => new Date(s);
const r = {
  parse: [m.parseAt('04:30') === 270, m.parseAt(' 00:00 ') === 0, m.parseAt('off') === null, m.parseAt('') === null, m.parseAt(undefined) === null, m.parseAt('24:00') === null, m.parseAt('4:30') === null],
  kst: m.kst(t('2026-11-05T19:30:00Z')),
  due: [m.due(t('2026-11-05T19:29:00Z'), 270, null), m.due(t('2026-11-05T19:30:00Z'), 270, null), m.due(t('2026-11-05T19:30:00Z'), 270, '20261106'),
        m.due(t('2026-11-06T14:59:00Z'), 270, '20261106'), m.due(t('2026-11-06T19:30:00Z'), 270, '20261106'), m.due(t('2026-11-05T19:30:00Z'), null, null)],
};
const off = m.createDailyBackup({ UPLOADS_BACKUP_DAILY: 'off' }, ROOT);
r.off = [off.enabled, off.check(t('2026-11-05T20:00:00Z'))];
const d = m.createDailyBackup({ UPLOADS_BACKUP_DAILY: '04:30' }, ROOT);
r.calls = [d.enabled, d.check(t('2026-11-05T19:29:00Z')), d.check(t('2026-11-05T19:30:00Z')), d.check(t('2026-11-05T19:31:00Z'))];
setTimeout(() => { r.calls.push(d.check(t('2026-11-05T22:00:00Z')), d.check(t('2026-11-06T19:30:00Z'))); setTimeout(() => console.log('R=' + JSON.stringify(r)), 1500); }, 1500);
"""
    p = subprocess.run(['node', '-e', js, os.path.join(K, 'scripts/uploads-backup-daily.js'), T], capture_output=True, text=True, timeout=60)
    line = next((l for l in p.stdout.splitlines() if l.startswith('R=')), 'R={}')
    r = json.loads(line[2:])
    ran = open(os.path.join(T, 'deploy/aws/ran.txt')).read().count('x') if os.path.exists(os.path.join(T, 'deploy/aws/ran.txt')) else 0
    ok('② 시각 읽기(HH:MM 만 · 그 밖은 꺼짐) · 한국 시간 날짜 · 하루 한 번(04:29 아님 · 04:30 맞음 · 같은 날 다시 아님 · 다음 날 맞음 · 꺼짐 아님)',
       all(r.get('parse', [False])) and r.get('kst') == {'day': '20261106', 'min': 270}
       and r.get('due') == [False, True, False, False, True, False], f"{r.get('kst')} {r.get('due')}")
    ok('② 꺼짐이면 안 부름 · 켜짐이면 하루 한 번만 부름(가짜 스크립트 2번 = 이틀) · 끝 줄을 기록',
       r.get('off') == [False, False] and r.get('calls') == [True, False, True, False, False, True] and ran == 2
       and '올린 파일 백업 끝 (종료 값 0) — 만듦 — 가짜 묶음' in p.stdout, f"{r.get('calls')} · 부른 수 {ran} · {p.stderr.strip()[:120]}")
finally:
    shutil.rmtree(T, ignore_errors=True)


# ── ③ DB ──────────────────────────────────────────────────────────────
def psql(sql, quiet=False):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode and not quiet: print('  psql:', r.stderr.strip()[:200])
    return r.stdout.strip() if not r.returncode else ('!' + r.stderr.strip())


if DB:
    m = re.search(r'db -v ON_ERROR_STOP=1 -q -c "(BEGIN;\s*SET LOCAL app\.setting_reason.*?COMMIT;)"', MR, re.S)
    off_sql = m.group(1).replace('\\"', '"') if m else ''
    keep = psql("SELECT value FROM site_settings WHERE key = 'admin.mfa_required'")
    adm = psql("SELECT id FROM accounts WHERE email = 'admin@x.com'")
    try:
        r0 = psql(f"UPDATE site_settings SET value = 'SUPER', updated_by = '{adm}', updated_at = now() WHERE key = 'admin.mfa_required'")
        mark = psql('SELECT coalesce(max(id), 0) FROM ops_alerts')
        r1 = psql(off_sql) if off_sql else '!스크립트에서 SQL 을 찾지 못함'
        got = psql(f"SELECT coalesce(string_agg((detail->>'from') || '>' || (detail->>'to') || ':' || (detail->>'via') || ':' || coalesce(detail->>'by', '-') || ':' || coalesce(detail->>'reason', '-'), ','), '') FROM ops_alerts WHERE id > {mark} AND alert_code = 'SETTING_CHANGED' AND detail->>'key' = 'admin.mfa_required'")
        ok('③ mfa-reset.sh 끄기 SQL(스크립트 글 그대로) — 전에 운영 화면에서 바꾼 사람이 있어도 via DB · by 없음 · 사유',
           not r0.startswith('!') and not r1.startswith('!') and got == 'SUPER>off:DB:-:mfa-reset.sh off (서버에서 비상 끄기)', f'{r1[:80]} · {got}')
    finally:
        if keep and not keep.startswith('!'):
            psql(f"UPDATE site_settings SET value = '{keep}' WHERE key = 'admin.mfa_required'", quiet=True)
        time.sleep(35)   # API 가 이 설정을 30초 기억함 — 다음 시험의 운영자 로그인이 2단계 화면에 걸리지 않게
    ok('끝 — 되돌림(admin.mfa_required)', psql("SELECT value FROM site_settings WHERE key = 'admin.mfa_required'") == keep, keep)
else:
    print('  (DB 없음 — ③ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)

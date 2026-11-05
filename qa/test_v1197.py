"""v10.197 시험 — 급한 운영 알림 메일(D175) · 올린 파일 백업 디스크 밖(S3) · 개발 킷 3판만(docs/310)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e ADMIN_WEB=http://localhost:15173 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1197.py

  ① 코드 — D175(mailed_at · fn_ops_alert_mail_pending · 지우는 문장 없음 · 213) · 정기 작업 launch_watch 메일 · 운영 화면 「메일 보냄」 ·
     uploads-backup.sh(BACKUP_S3_BUCKET · 표시 파일 · 종료 값 3 · 알림) · postcheck 줄 · sgb-check.sh 킷 3판 · docs/310 · 판
  ② (DB) 보낼 것 고르기 — CRITICAL · SETTING_CHANGED 만 · WARN 아님 · 확인한 것 아님 · 24시간 넘은 것 아님 · 같은 종류 1시간 안에 보냈으면 미룸 ·
     mailed_at 은 확인한 알림에도 적힘
  ③ (API · 화면) launch_watch → 메일 준비 전이면 보낸 것으로 안 적힘(MAIL_NOT_READY · NO_TO) · 목록 mailedAt · 운영 알림 화면 「메일 보냄」
  ④ (스크립트) 가짜 aws — 올림 · 표시 파일 · 다시 돌리면 「이미 올림」 · 실패 = 종료 값 3 · 운영 알림 하루 한 번 · 값 없으면 꺼짐
  ⑤ (스크립트) 킷 정리 — 판 번호가 큰 3판만 · 킷 아닌 파일은 그대로
"""
import json, os, re, shutil, subprocess, tempfile, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel, base=None):
    p = os.path.join(base or K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
MD = os.path.join(K, 'prisma/migrations')
mig = sorted(d for d in os.listdir(MD) if os.path.isdir(os.path.join(MD, d)))
M = rd('prisma/migrations/D175_ops_alert_mail/migration.sql')
ok('① D175 — mailed_at · 고르는 함수(CRITICAL · SETTING_CHANGED · 확인 안 함 · 24시간 · 종류마다 1시간 · 50건) · 지우는 문장 없음 · 213',
   'ALTER TABLE public.ops_alerts ADD COLUMN IF NOT EXISTS mailed_at timestamptz;' in M and 'CREATE OR REPLACE FUNCTION public.fn_ops_alert_mail_pending()' in M
   and "(o.severity = 'CRITICAL' OR o.alert_code = 'SETTING_CHANGED')" in M and "o.raised_at > now() - interval '24 hours'" in M
   and "m.mailed_at > now() - interval '1 hour'" in M and 'o.acknowledged_at IS NULL' in M and 'LIMIT 50' in M
   and not re.search(r'\b(DELETE FROM|DROP TABLE|DROP VIEW|DROP FUNCTION|TRUNCATE)\b', M) and len(mig) >= 213 and 'D175_ops_alert_mail' in mig, f'{len(mig)} · {mig[-1]}')
SC = rd('src/worker/scheduler.service.ts'); LW = rd('src/modules/admin/launch-watch.service.ts')
OA = rd('src/modules/admin/ops-alerts.service.ts'); OX = rd('web/src/app/admin/OpsAlerts.tsx')
ok('① 정기 작업 — launch_watch 끝에 메일 · 받는 주소 없음 · 메일 준비 전 · 보내기 실패면 적지 않음 · 보낸 뒤에만 markMailed · 화면 「메일 보냄」',
   'const am = await this.alertMail();' in SC and 'alertMail: am' in SC and "reason: 'NO_TO'" in SC and "reason: 'MAIL_NOT_READY'" in SC
   and SC.find("if (!m.ok) return") < SC.find('await this.launchWatch.markMailed(') and 'FROM fn_ops_alert_mail_pending()' in LW
   and 'SET mailed_at = now() WHERE id = ANY($1::bigint[]) AND mailed_at IS NULL' in LW and 'o.mailed_at AS "mailedAt"' in OA
   and '메일 보냄 {ymdhm(x.mailedAt)}' in OX and 'data-mailed=""' in OX, '')
UB = rd('deploy/aws/uploads-backup.sh'); PC = rd('deploy/aws/postcheck.sh')
ok('① 백업 스크립트 · postcheck — BACKUP_S3_BUCKET(형식 검사) · aws s3 cp · 표시 파일 · 이미 있는 묶음도 올림 · 종료 값 3 · 알림 하루 한 번 · 옛 표시 파일도 지움 · 문법',
   'S3B="${BACKUP_S3_BUCKET:-}"' in UB and 'aws s3 cp "$DEST"' in UB and '"$DEST.s3"' in UB and 'offsite; exit $?; fi' in UB
   and "'UPLOADS_BACKUP_OFFSITE_FAILED'" in UB and 'return 3' in UB and 'rm -f -- "$old" "$old.s3"' in UB
   and '올린 파일 백업 디스크 밖(S3) — 꺼짐' in PC and '배치 호출기(pm2 logs sgb-jobs)' in PC
   and all(subprocess.run(['bash', '-n', os.path.join(K, f)]).returncode == 0 for f in ('deploy/aws/uploads-backup.sh', 'deploy/aws/postcheck.sh')), '')
CK = rd('qa/sgb-check.sh', KIT)
ok('① sgb-check.sh — 킷 3판만(out · release) · 문서 · 판 v10.197 이상', '# kits-keep-begin' in CK and 'sort -uV | head -n -3' in CK
   and any(f.startswith('310_') for f in os.listdir(os.path.join(K, 'docs')))
   and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 197), rd('VERSION').strip())


def call(method, path, tok=None, body=None):
    hd = {'content-type': 'application/json'}
    if tok: hd['Authorization'] = 'Bearer ' + tok
    r = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None, headers=hd, method=method)
    try:
        with urllib.request.urlopen(r, timeout=120) as x:
            b = x.read(); s = x.status
    except urllib.error.HTTPError as e:
        b = e.read(); s = e.code
    try: return s, json.loads(b or b'{}')
    except Exception: return s, {}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return r.stdout.strip() if not r.returncode else ('!' + r.stderr.strip()[:200])


if API and DB:
    MARK = "detail->>'test' = 'v1197'"
    clean = lambda: psql(f"DELETE FROM ops_alerts WHERE alert_code LIKE 'TEST_V1197%' OR (alert_code = 'SETTING_CHANGED' AND {MARK})")
    clean()
    try:
        # ── ② 고르기 ───────────────────────────────────────────────────
        # (alert_code, raised_at) 가 겹치지 않게 시각을 다르게
        r0 = psql(f"""INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at, acknowledged_at, mailed_at) VALUES
          ('TEST_V1197_C',  'CRITICAL', '시험 긴급',            '{{"test":"v1197"}}', now() - interval '5 minutes',  NULL, NULL),
          ('SETTING_CHANGED','WARN',    '시험 설정 바뀜',        '{{"test":"v1197"}}', now() - interval '4 minutes',  NULL, NULL),
          ('TEST_V1197_W',  'WARN',     '시험 경고(대상 아님)',  '{{"test":"v1197"}}', now() - interval '4 minutes',  NULL, NULL),
          ('TEST_V1197_K',  'CRITICAL', '시험 확인함(대상 아님)', '{{"test":"v1197"}}', now() - interval '4 minutes',  now(), NULL),
          ('TEST_V1197_O',  'CRITICAL', '시험 25시간 전(대상 아님)', '{{"test":"v1197"}}', now() - interval '25 hours', NULL, NULL),
          ('TEST_V1197_T',  'CRITICAL', '시험 10분 전에 보냄',   '{{"test":"v1197"}}', now() - interval '20 minutes', now(), now() - interval '10 minutes'),
          ('TEST_V1197_T',  'CRITICAL', '시험 같은 종류 새 것(미룸)', '{{"test":"v1197"}}', now() - interval '3 minutes', NULL, NULL),
          ('TEST_V1197_H',  'CRITICAL', '시험 2시간 전에 보냄',  '{{"test":"v1197"}}', now() - interval '3 hours',  now(), now() - interval '2 hours'),
          ('TEST_V1197_H',  'CRITICAL', '시험 같은 종류 새 것(보냄)', '{{"test":"v1197"}}', now() - interval '2 minutes', NULL, NULL)""")
        # 다른 시험이 남긴 급한 알림이 50건을 넘으면 LIMIT 50 에 밀리므로, 한 묶음 안에서 잠시 2시간 전에 보낸 것으로 두고(1시간 미룸에 안 걸리게) 되돌림
        got = psql(f"BEGIN; UPDATE ops_alerts SET mailed_at = now() - interval '2 hours' WHERE mailed_at IS NULL AND coalesce(detail->>'test', '') <> 'v1197'; "
                   f"SELECT coalesce(string_agg(p.title, '|' ORDER BY p.id), '') FROM fn_ops_alert_mail_pending() p JOIN ops_alerts o ON o.id = p.id WHERE o.{MARK}; ROLLBACK;")
        ok('② 고르기 — 긴급 · 설정 바뀜 · 1시간 지난 종류의 새 것만(경고 · 확인함 · 24시간 넘음 · 1시간 안에 보낸 종류는 빠짐)',
           not r0.startswith('!') and got == '시험 긴급|시험 설정 바뀜|시험 같은 종류 새 것(보냄)', got or r0)
        r1 = psql(f"UPDATE ops_alerts SET mailed_at = now() WHERE alert_code = 'TEST_V1197_K' AND {MARK}")
        k1 = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'TEST_V1197_K' AND mailed_at IS NOT NULL AND acknowledged_at IS NOT NULL")
        r2 = psql(f"UPDATE ops_alerts SET title = '바꿈' WHERE alert_code = 'TEST_V1197_K' AND {MARK}")
        ok('② mailed_at 은 확인한 알림에도 적힘 · 알림 내용은 여전히 못 바꿈(ALERT_FIXED)', not r1.startswith('!') and k1 == '1' and 'ALERT_FIXED' in r2, f'{r1[:40]} · {k1} · {r2[:60]}')

        # ── ③ 정기 작업 · 목록 · 화면 ─────────────────────────────────
        TA = call('POST', '/auth/login', None, {'email': 'admin@x.com', 'password': PW})[1].get('accessToken')
        sj, jj = call('POST', '/admin/jobs', TA, {'job': 'launch_watch'})
        am = (jj.get('detail') or {}).get('alertMail') or {}
        left = psql(f"SELECT count(*) FROM ops_alerts WHERE {MARK} AND mailed_at IS NOT NULL AND alert_code IN ('TEST_V1197_C', 'SETTING_CHANGED')")
        ok('③ launch_watch — 메일 준비 전이면 까닭만(MAIL_NOT_READY · NO_TO) · 남은 수 · 보낸 것으로 안 적힘',
           sj in (200, 201) and am.get('reason') in ('MAIL_NOT_READY', 'NO_TO') and am.get('mailed') == 0 and am.get('pending', 0) >= 3 and left == '0', f'{sj} · {am} · {left}')
        psql(f"UPDATE ops_alerts SET mailed_at = now() WHERE alert_code = 'TEST_V1197_C' AND {MARK}")
        sl, jl = call('GET', '/admin/ops-alerts?code=TEST_V1197_C', TA)
        it = (jl.get('items') or [{}])[0]
        ok('③ 운영 알림 목록 — mailedAt', sl == 200 and it.get('mailedAt') and 'mailedAt' in it, str(it.get('mailedAt')))
        if ADMIN_WEB:
            import sys
            sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
            import consent_ok
            from playwright.sync_api import sync_playwright
            consent_ok.agree('admin@x.com', PW)
            with sync_playwright() as p:
                b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1400, 'height': 1000}); errs = []
                pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                pg.goto(ADMIN_WEB + '/#/ops-alerts', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(1500)
                n = pg.evaluate("() => [...document.querySelectorAll('[data-mailed]')].filter(e => e.textContent.includes('메일 보냄')).length")
                note = pg.evaluate("() => document.body.innerText.includes('10분 안에 하루 요약 받는 주소로 메일')")
                b.close()
            ok('③ 화면 — 운영 알림 「메일 보냄」 표시 · 안내 문구 · 오류 없음', n >= 1 and note and not errs, f'{n} · {note} · {errs[:2]}')
    finally:
        clean()

# ── ④ 백업 디스크 밖(S3) ──────────────────────────────────────────────
BS = os.path.join(K, 'deploy/aws/uploads-backup.sh')
T = tempfile.mkdtemp(prefix='t1197_')
try:
    app, data, up, s3, bin_ = (os.path.join(T, x) for x in ('app', 'data', 'up', 's3', 'bin'))
    for d in (app, os.path.join(up, '2026/11'), s3, bin_): os.makedirs(d)
    open(os.path.join(up, '2026/11/a.jpg'), 'w').write('a'); open(os.path.join(up, '2026/11/b.jpg'), 'w').write('b')
    with open(os.path.join(bin_, 'aws'), 'w') as f:   # 가짜 aws — aws s3 cp SRC s3://버킷/경로/이름 → $FAKE_S3/버킷/경로/이름 · FAKE_AWS_FAIL=1 이면 실패
        f.write('#!/usr/bin/env bash\n[ "${FAKE_AWS_FAIL:-0}" = 1 ] && { echo "fake: AccessDenied" >&2; exit 1; }\n'
                '[ "$1 $2" = "s3 cp" ] || exit 2\nd="$FAKE_S3/${4#s3://}"; mkdir -p "$(dirname "$d")" && cp "$3" "$d"\n')
    os.chmod(os.path.join(bin_, 'aws'), 0o755)

    def env_file(extra=''):
        open(os.path.join(app, '.env'), 'w').write(f'UPLOAD_DIR={up}\n' + (f'DATABASE_URL={DB}\n' if DB else '') + extra)

    def run(*args, **ev):
        r = subprocess.run(['bash', BS, *args], capture_output=True, text=True,
                           env={**os.environ, 'APP_LINK': app, 'DATA_DIR': data, 'PATH': bin_ + ':' + os.environ['PATH'], 'FAKE_S3': s3, **ev})
        return r.returncode, r.stdout + r.stderr

    env_file()
    c0, o0 = run('check')
    a0, oa = run()
    BK = os.path.join(data, 'backup/uploads')
    tars = sorted(f for f in os.listdir(BK) if f.endswith('.tar.gz')) if os.path.isdir(BK) else []
    ok('④ 값 없으면 꺼짐 — check 「꺼짐」 · 묶음만 만들고 올리지 않음 · 종료 값 0',
       c0 == 0 and '디스크 밖(S3): 꺼짐' in o0 and a0 == 0 and len(tars) == 1 and not os.listdir(s3) and not any(f.endswith('.s3') for f in os.listdir(BK)), f'{c0} {a0} · {tars}')
    env_file('BACKUP_S3_BUCKET=sgb-test-backup\n')
    a1, o1 = run()   # 오늘 묶음이 이미 있음 → 아직 안 올렸으니 올림
    up1 = os.path.exists(os.path.join(s3, 'sgb-test-backup/uploads-backup', tars[0])) if tars else False
    a2, o2 = run()
    c3, o3 = run('check')
    ok('④ 켜짐 — 이미 있는 오늘 묶음도 올림 · 표시 파일 · 다시 돌리면 「이미 올림」 · check 에 마지막 올린 묶음',
       a1 == 0 and up1 and '디스크 밖(S3)에 올림' in o1 and os.path.exists(os.path.join(BK, tars[0] + '.s3'))
       and a2 == 0 and '디스크 밖(S3)에 이미 올림' in o2 and c3 == 0 and f'켜짐 s3://sgb-test-backup/uploads-backup/ · 마지막 올린 묶음 {tars[0]}' in o3,
       f'{a1} {up1} {a2} {c3} · {o1.strip().splitlines()[-1][:80] if o1.strip() else ""}')
    os.remove(os.path.join(BK, tars[0] + '.s3'))
    if DB: psql("DELETE FROM ops_alerts WHERE alert_code = 'UPLOADS_BACKUP_OFFSITE_FAILED' AND detail->>'bucket' = 'sgb-test-backup'")
    f1, of1 = run(FAKE_AWS_FAIL='1'); f2, of2 = run(FAKE_AWS_FAIL='1')
    na = psql("SELECT count(*) FROM ops_alerts WHERE alert_code = 'UPLOADS_BACKUP_OFFSITE_FAILED' AND detail->>'bucket' = 'sgb-test-backup'") if DB else '1'
    ok('④ 실패 — 종료 값 3 · 「올리기 실패」 · 표시 파일 없음 · 운영 알림 하루 한 번(두 번 실패해도 1)',
       f1 == 3 and f2 == 3 and '디스크 밖(S3) 올리기 실패' in of1 and not os.path.exists(os.path.join(BK, tars[0] + '.s3')) and na == '1', f'{f1} {f2} · 알림 {na}')
    env_file('BACKUP_S3_BUCKET=Bad_Bucket!\n')
    b1, ob1 = run()
    ok('④ 버킷 이름 형식이 틀리면 건너뜀(올리지 않음 · 종료 값 0)', b1 == 0 and '형식이 틀립니다' in ob1, f'{b1}')
finally:
    if DB: psql("DELETE FROM ops_alerts WHERE alert_code = 'UPLOADS_BACKUP_OFFSITE_FAILED' AND detail->>'bucket' = 'sgb-test-backup'")
    shutil.rmtree(T, ignore_errors=True)

# ── ⑤ 킷 정리 ────────────────────────────────────────────────────────
m = re.search(r'# kits-keep-begin\n(.*?)# kits-keep-end', CK, re.S)
H = tempfile.mkdtemp(prefix='t1197k_')
try:
    for d in ('kits/out', 'kits/release'): os.makedirs(os.path.join(H, d))
    for v in (191, 193, 194, 195, 196, 197):
        for e in ('zip', 'tar.gz'): open(os.path.join(H, f'kits/release/SGB_DevDocker_Integrated_20261002_v10_{v}.{e}'), 'w').close()
    for v in (99, 100): open(os.path.join(H, f'kits/out/SGB_DevDocker_Integrated_20261002_v10_{v}.zip'), 'w').close()
    open(os.path.join(H, 'kits/release/note.txt'), 'w').close()
    r = subprocess.run(['bash', '-c', m.group(1) if m else 'exit 9'], capture_output=True, text=True, env={**os.environ, 'HOME': H})
    rel = sorted(os.listdir(os.path.join(H, 'kits/release'))); out = sorted(os.listdir(os.path.join(H, 'kits/out')))
    ok('⑤ 킷 정리 — release 는 195 · 196 · 197(zip · tar.gz) · 킷 아닌 파일 그대로 · 3판 이하인 out 은 그대로',
       r.returncode == 0 and rel == sorted([f'SGB_DevDocker_Integrated_20261002_v10_{v}.{e}' for v in (195, 196, 197) for e in ('zip', 'tar.gz')] + ['note.txt'])
       and len(out) == 2 and r.stdout.count('옛 킷 지움') == 3, f'{r.returncode} · {len(rel)} · {out}')
finally:
    shutil.rmtree(H, ignore_errors=True)

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)

"""v10.198 시험 — 급한 알림 메일 준비 상태 · 시험 메일 · 백업 실패 바로 알림 · 7일마다 묶음 검사 · 확인 안 한 긴급 다시 메일(D176 · docs/312)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e ADMIN_WEB=http://localhost:15173 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1198.py

  ① 코드 — D176(remailed_at · fn_ops_alert_remail_pending · 백업 실패 종류 · 지우는 문장 없음 · 214) · MailService.status ·
     mail-status · mail-test(SUPER · 1분 · 감사 OPS_MAIL_TEST) · [다시] 메일 · 하루 요약 긴급 줄 · 화면 · 백업 스크립트 · postcheck · 문서 · 판
  ② (DB) 다시 보낼 것 고르기 — CRITICAL · 확인 안 함 · 보낸 지 12시간 넘음 · 한 번만 · 48시간 안 / 백업 실패 · 묶음 깨짐은 처음 보낼 것에 ·
     remailed_at 은 확인한 알림에도 적힘. 다른 시험이 남긴 알림과 섞이지 않게 한 묶음 안에서 고르고 되돌림
  ③ (API · 화면) mail-status(준비 안 됨 · NO_SMTP) · mail-test(받는 주소 없음 / 준비 안 됨 · 1분에 한 번 409 · 감사 기록 · ADMIN 403) ·
     launch_watch 결과 · 목록 remailedAt · 운영 알림 화면 「메일」 줄 · 시험 메일 단추 · 「다시 보냄」
  ④ (스크립트) 묶음 검사 — 처음 · 7일 뒤 · 깨진 묶음 = UPLOADS_BACKUP_BAD 하루 한 번 / 묶기 실패 = UPLOADS_BACKUP_FAILED 하루 한 번
"""
import json, os, re, shutil, subprocess, tempfile, time, urllib.error, urllib.request

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
M = rd('prisma/migrations/D176_ops_alert_remail/migration.sql')
ok('① D176 — remailed_at · 다시 고르는 함수(CRITICAL · 확인 안 함 · 12시간 · 한 번 · 48시간 · 50건) · 백업 실패 종류 · 지우는 문장 없음 · 214',
   'ADD COLUMN IF NOT EXISTS remailed_at timestamptz' in M and 'CREATE OR REPLACE FUNCTION public.fn_ops_alert_remail_pending()' in M
   and "o.mailed_at < now() - interval '12 hours'" in M and 'o.remailed_at IS NULL' in M and "o.raised_at > now() - interval '48 hours'" in M
   and "o.alert_code IN ('SETTING_CHANGED', 'UPLOADS_BACKUP_FAILED', 'UPLOADS_BACKUP_BAD')" in M and M.count('LIMIT 50') == 2
   and not re.search(r'\b(DELETE FROM|DROP TABLE|DROP VIEW|DROP FUNCTION|TRUNCATE)\b', M) and len(mig) >= 214 and 'D176_ops_alert_remail' in mig,
   f'{len(mig)} · {mig[-1]}')
MS = rd('src/common/mail/mail.service.ts'); OA = rd('src/modules/admin/ops-alerts.service.ts'); OC = rd('src/modules/admin/ops-review.controller.ts')
ok('① 메일 준비 상태 · 시험 메일 — status(NO_SMTP · NOT_VERIFIED · NO_FROM) · SUPER · 감사 OPS_MAIL_TEST · 1분 · 받는 주소 가림',
   'async status()' in MS and "reason: 'NO_SMTP'" in MS and "reason: 'NOT_VERIFIED'" in MS and "reason: 'NO_FROM'" in MS
   and 'async mailStatus()' in OA and 'async mailTest()' in OA and "'MAIL_TEST_WAIT'" in OA and "interval '1 minute'" in OA and 'maskMail(to)' in OA
   and 'o.remailed_at AS "remailedAt"' in OA
   and "@Get('ops-alerts/mail-status')" in OC and "@Post('ops-alerts/mail-test')" in OC
   and re.search(r"@Post\('ops-alerts/mail-test'\)\s*@HttpCode\(200\)\s*@Roles\('SUPER'\)\s*@Audit\('OPS_MAIL_TEST'", OC), '')
SC = rd('src/worker/scheduler.service.ts'); LW = rd('src/modules/admin/launch-watch.service.ts'); OX = rd('web/src/app/admin/OpsAlerts.tsx')
SJ = json.loads(rd('spec/screens.json') or '[]')
scr = next((s for s in (SJ if isinstance(SJ, list) else SJ.get('screens', [])) if s.get('id') == 'SB-ADM-OPS-010'), {})
ok('① 다시 메일 · 하루 요약 · 화면 · 화면 목록 — [다시] · markMailed(다시 따로) · alertMail 앞 · 긴급 줄 · 메일 줄 · 단추 · 다시 보냄 · API 2',
   "x.again ? '[다시] ' : ''" in SC and 'markMailed(p.items.filter((x) => !x.again)' in SC and 'detail = { alertMail: am, ...r' in SC
   and 'FROM fn_ops_alert_remail_pending()' in LW and 'SET remailed_at = now() WHERE id = ANY($1::bigint[]) AND remailed_at IS NULL' in LW
   and '"openCritical"' in LW and '확인 안 한 긴급 알림' in LW
   and 'data-mail-status=' in OX and 'data-mail-test=""' in OX and '다시 보냄 {ymdhm(x.remailedAt)}' in OX and "tokenRoles().includes('SUPER')" in OX
   and 'GET /admin/ops-alerts/mail-status' in scr.get('apis', []) and 'POST /admin/ops-alerts/mail-test' in scr.get('apis', []), '')
UB = rd('deploy/aws/uploads-backup.sh'); PC = rd('deploy/aws/postcheck.sh')
ok('① 백업 스크립트 · postcheck — 실패 알림 · 7일 검사(gzip -t) · .verified · check 줄 · postcheck 줄(수에 안 넣음) · 문법 · 문서 · 판',
   'note UPLOADS_BACKUP_FAILED' in UB and 'note UPLOADS_BACKUP_BAD' in UB and 'gzip -t "$f"' in UB and 'find "$VER" -mtime +6' in UB
   and UB.count('verify_weekly') == 3 and '묶음 검사(7일마다 gzip -t):' in UB
   and 'info "올린 파일 백업 묶음 검사(7일마다 gzip -t)' in PC
   and all(subprocess.run(['bash', '-n', os.path.join(K, f)]).returncode == 0 for f in ('deploy/aws/uploads-backup.sh', 'deploy/aws/postcheck.sh'))
   and any(f.startswith('312_') for f in os.listdir(os.path.join(K, 'docs')))
   and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 198), rd('VERSION').strip())


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
    MARK = "detail->>'test' = 'v1198'"
    clean = lambda: psql(f"DELETE FROM ops_alerts WHERE {MARK}")
    keep_to = psql("SELECT coalesce((SELECT value FROM site_settings WHERE key = 'ops.digest_to'), '!none')")
    ADMU = 't1198adm@x.com'
    clean()
    try:
        # ── ② 고르기 ───────────────────────────────────────────────────
        # (alert_code, raised_at) 가 겹치지 않게 시각을 다르게 · 다시 보낼 것은 CRITICAL 만
        r0 = psql(f"""INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at, acknowledged_at, mailed_at, remailed_at) VALUES
          ('TEST_V1198_R', 'CRITICAL', '시험 다시 보낼 것',            '{{"test":"v1198"}}', now() - interval '14 hours',  NULL,  now() - interval '13 hours', NULL),
          ('TEST_V1198_R', 'CRITICAL', '시험 보낸 지 2시간(아직)',       '{{"test":"v1198"}}', now() - interval '3 hours',   NULL,  now() - interval '2 hours',  NULL),
          ('TEST_V1198_R', 'CRITICAL', '시험 확인함(대상 아님)',         '{{"test":"v1198"}}', now() - interval '15 hours',  now(), now() - interval '13 hours', NULL),
          ('TEST_V1198_R', 'CRITICAL', '시험 이미 다시 보냄(대상 아님)', '{{"test":"v1198"}}', now() - interval '16 hours',  NULL,  now() - interval '15 hours', now() - interval '1 hour'),
          ('TEST_V1198_R', 'CRITICAL', '시험 50시간 전(대상 아님)',      '{{"test":"v1198"}}', now() - interval '50 hours',  NULL,  now() - interval '30 hours', NULL),
          ('SETTING_CHANGED', 'WARN',  '시험 설정 바뀜(다시 대상 아님)', '{{"test":"v1198"}}', now() - interval '14 hours 1 minute', NULL, now() - interval '13 hours', NULL),
          ('TEST_V1198_N', 'CRITICAL', '시험 아직 안 보냄(다시 대상 아님)', '{{"test":"v1198"}}', now() - interval '6 minutes', NULL, NULL, NULL),
          ('UPLOADS_BACKUP_FAILED', 'WARN', '시험 백업 실패',            '{{"test":"v1198"}}', now() - interval '3 minutes', NULL,  NULL, NULL),
          ('UPLOADS_BACKUP_BAD',    'WARN', '시험 묶음 깨짐',            '{{"test":"v1198"}}', now() - interval '2 minutes', NULL,  NULL, NULL),
          ('UPLOADS_BACKUP_STALE',  'WARN', '시험 백업 멈춤(메일 대상 아님)', '{{"test":"v1198"}}', now() - interval '1 minutes', NULL, NULL, NULL)""")
        # 다른 시험이 남긴 알림은 한 묶음 안에서 잠시 「2시간 전에 보냄 · 1시간 전에 다시 보냄」으로 두고(50건 · 1시간 미룸에 안 걸리게) 고른 뒤 되돌림
        iso = f"UPDATE ops_alerts SET mailed_at = coalesce(mailed_at, now() - interval '2 hours'), remailed_at = coalesce(remailed_at, now() - interval '1 hour') WHERE coalesce(detail->>'test', '') <> 'v1198'; "
        g1 = psql(f"BEGIN; {iso}SELECT coalesce(string_agg(p.title, '|' ORDER BY p.id), '') FROM fn_ops_alert_remail_pending() p JOIN ops_alerts o ON o.id = p.id WHERE o.{MARK}; ROLLBACK;")
        g2 = psql(f"BEGIN; {iso}SELECT coalesce(string_agg(p.title, '|' ORDER BY p.id), '') FROM fn_ops_alert_mail_pending() p JOIN ops_alerts o ON o.id = p.id WHERE o.{MARK}; ROLLBACK;")
        ok('② 다시 보낼 것 — CRITICAL · 확인 안 함 · 보낸 지 12시간 넘음 · 한 번만 · 48시간 안만', not r0.startswith('!') and g1 == '시험 다시 보낼 것', g1 or r0)
        ok('② 처음 보낼 것 — 긴급 · 백업 실패 · 묶음 깨짐(경고여도) · 백업 멈춤은 아님', g2 == '시험 아직 안 보냄(다시 대상 아님)|시험 백업 실패|시험 묶음 깨짐', g2)
        r1 = psql(f"UPDATE ops_alerts SET remailed_at = now() WHERE title = '시험 확인함(대상 아님)' AND {MARK}")
        r2 = psql(f"UPDATE ops_alerts SET title = '바꿈' WHERE title = '시험 확인함(대상 아님)' AND {MARK}")
        ok('② remailed_at 은 확인한 알림에도 적힘 · 알림 내용은 여전히 못 바꿈(ALERT_FIXED)', not r1.startswith('!') and 'ALERT_FIXED' in r2, f'{r1[:40]} · {r2[:60]}')

        # ── ③ API · 화면 ──────────────────────────────────────────────
        import sys
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import consent_ok
        pw = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
        psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{ADMU}', '시험운영1198', '{pw}', now()) ON CONFLICT DO NOTHING")
        aid = psql(f"SELECT id FROM accounts WHERE email = '{ADMU}'")
        psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 T1198', true); INSERT INTO account_roles(account_id, role) VALUES ('{aid}', 'ADMIN') ON CONFLICT DO NOTHING; COMMIT;")
        for e in (ADMU, 'admin@x.com'): consent_ok.agree(e, PW)
        TS = call('POST', '/auth/login', None, {'email': 'admin@x.com', 'password': PW})[1].get('accessToken')
        TA = call('POST', '/auth/login', None, {'email': ADMU, 'password': PW})[1].get('accessToken')
        s0, m0 = call('GET', '/admin/ops-alerts/mail-status', TS)
        sa, ma = call('GET', '/admin/ops-alerts/mail-status', TA)
        ok('③ mail-status — 개발은 준비 안 됨(NO_SMTP) · 받는 주소 칸 · 마지막 정기 작업(없거나 모양 맞음) · ADMIN 도 봄',
           s0 == 200 and m0.get('ready') is False and m0.get('reason') == 'NO_SMTP' and 'to' in m0
           and (m0.get('lastJob') is None or {'at', 'pending', 'mailed', 'reason'} <= set(m0['lastJob'])) and sa == 200,
           f'{s0} · {m0.get("reason")} · {m0.get("to")} · {m0.get("lastJob")} · {sa}')
        # 받는 주소를 잠시 비웠다가(NO_TO) · 넣고(MAIL_NOT_READY_NO_SMTP) — 1분 제한 때문에 두 번째는 61초 뒤
        # 형식 검사(value_pattern) 트리거가 '' 을 막음 — NULL 은 통과(코드는 coalesce 로 빈 주소)
        u0 = psql("UPDATE site_settings SET value = NULL WHERE key = 'ops.digest_to'")
        assert not u0.startswith('!'), u0
        n0 = psql("SELECT count(*) FROM audit.audit_logs WHERE action = 'OPS_MAIL_TEST'")
        t1, j1 = call('POST', '/admin/ops-alerts/mail-test', TS, {})
        t2, j2 = call('POST', '/admin/ops-alerts/mail-test', TS, {})
        ta, ja = call('POST', '/admin/ops-alerts/mail-test', TA, {})
        time.sleep(1.5)
        n1 = psql("SELECT count(*) FROM audit.audit_logs WHERE action = 'OPS_MAIL_TEST'")
        la = psql("SELECT after_data->>'reason' FROM audit.audit_logs WHERE action = 'OPS_MAIL_TEST' ORDER BY occurred_at DESC LIMIT 1")
        ok('③ mail-test — 받는 주소 없으면 200 · ok false · NO_TO / 곧바로 다시 409 MAIL_TEST_WAIT / ADMIN 403 / 감사 기록 1줄(까닭)',
           t1 == 200 and j1.get('ok') is False and j1.get('reason') == 'NO_TO' and t2 == 409 and j2.get('code') == 'MAIL_TEST_WAIT'
           and ta == 403 and n1.isdigit() and n0.isdigit() and int(n1) - int(n0) == 1 and la == 'NO_TO',
           f'{t1} {j1.get("reason")} · {t2} {j2.get("code")} · {ta} · {n0}→{n1} {la}')
        psql("UPDATE site_settings SET value = 'opsteam@example.com' WHERE key = 'ops.digest_to'")
        time.sleep(61)
        t3, j3 = call('POST', '/admin/ops-alerts/mail-test', TS, {})
        time.sleep(1.5)
        s4, m4 = call('GET', '/admin/ops-alerts/mail-status', TS)
        ok('③ mail-test — 받는 주소가 있어도 메일 준비 전이면 보내지 않음(MAIL_NOT_READY_NO_SMTP · 주소 가림) · mail-status 에 받는 주소 · 마지막 시험',
           t3 == 200 and j3.get('ok') is False and j3.get('reason') == 'MAIL_NOT_READY_NO_SMTP' and j3.get('to') == 'op***@example.com'
           and m4.get('to') == 'op***@example.com' and (m4.get('lastTest') or {}).get('ok') is False and (m4.get('lastTest') or {}).get('reason') == 'MAIL_NOT_READY_NO_SMTP',
           f'{t3} {j3.get("reason")} {j3.get("to")} · {m4.get("to")} · {m4.get("lastTest")}')
        sj, jj = call('POST', '/admin/jobs', TS, {'job': 'launch_watch'})
        am = (jj.get('detail') or {}).get('alertMail') or {}
        rm = psql(f"SELECT count(*) FROM ops_alerts WHERE {MARK} AND title = '시험 다시 보낼 것' AND remailed_at IS NULL")
        ok('③ launch_watch — 메일 준비 전이면 까닭만(MAIL_NOT_READY) · 남은 수 · 다시 보낸 것으로 안 적힘 · alertMail 이 detail 맨 앞',
           sj in (200, 201) and am.get('reason') == 'MAIL_NOT_READY' and am.get('mailed') == 0 and am.get('pending', 0) >= 1 and rm == '1'
           and list((jj.get('detail') or {}).keys())[:1] == ['alertMail'], f'{sj} · {am} · {rm}')
        psql(f"""INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at, mailed_at, remailed_at)
                 VALUES ('TEST_V1198_V', 'CRITICAL', '시험 화면 다시 보냄', '{{"test":"v1198"}}', now() - interval '30 seconds', now() - interval '20 seconds', now() - interval '10 seconds')""")
        sl, jl = call('GET', '/admin/ops-alerts?code=TEST_V1198_V', TS)
        it = (jl.get('items') or [{}])[0]
        ok('③ 운영 알림 목록 — remailedAt', sl == 200 and it.get('remailedAt') and it.get('mailedAt'), str(it.get('remailedAt')))
        if ADMIN_WEB:
            from playwright.sync_api import sync_playwright

            def screen(email):
                with sync_playwright() as p:
                    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1400, 'height': 1000}); errs = []
                    pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
                    pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                    pg.fill('input[name=email]', email); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                    pg.goto(ADMIN_WEB + '/#/ops-alerts', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(1500)
                    r = pg.evaluate("""() => ({
                        st: document.querySelector('[data-mail-status]')?.getAttribute('data-mail-status') ?? null,
                        txt: document.querySelector('[data-mail-status]')?.textContent ?? '',
                        btn: !!document.querySelector('[data-mail-test]'),
                        again: [...document.querySelectorAll('[data-remailed]')].filter(e => e.textContent.includes('다시 보냄')).length,
                        note: document.body.innerText.includes('12시간 넘게 확인하지 않으면 한 번 더') })""")
                    b.close()
                return r, errs
            v, ev = screen('admin@x.com')
            w, ew = screen(ADMU)
            ok('③ 화면 — 「급한 알림 메일 · 준비 안 됨 · 받는 주소」 · SUPER 에게 시험 메일 단추 · 「다시 보냄」 · 안내 문구 · ADMIN 은 단추 없음 · 오류 없음',
               v['st'] == 'not-ready' and '준비 안 됨' in v['txt'] and 'op***@example.com' in v['txt'] and v['btn'] and v['again'] >= 1 and v['note']
               and w['st'] == 'not-ready' and not w['btn'] and not ev and not ew, f'{v} · {w["btn"]} · {ev[:2]} {ew[:2]}')
    finally:
        clean()
        if keep_to != '!none': psql(f"UPDATE site_settings SET value = '{keep_to}' WHERE key = 'ops.digest_to'")

# ── ④ 묶음 검사 · 실패 알림 ───────────────────────────────────────────
BS = os.path.join(K, 'deploy/aws/uploads-backup.sh')
T = tempfile.mkdtemp(prefix='t1198_')
BADQ = "alert_code = 'UPLOADS_BACKUP_BAD' AND detail->>'bad' = 'uploads_20200101.tar.gz'"
FAILQ = "alert_code = 'UPLOADS_BACKUP_FAILED' AND detail->>'step' = 'tar' AND raised_at > now() - interval '30 minutes'"
try:
    if DB: psql(f"DELETE FROM ops_alerts WHERE {BADQ} OR {FAILQ}")
    app, data, up, bin_ = (os.path.join(T, x) for x in ('app', 'data', 'up', 'bin'))
    for d in (app, os.path.join(up, '2026/11'), bin_): os.makedirs(d)
    open(os.path.join(up, '2026/11/a.jpg'), 'w').write('a'); open(os.path.join(up, '2026/11/b.jpg'), 'w').write('b')
    with open(os.path.join(bin_, 'tar'), 'w') as f:   # 가짜 tar — FAKE_TAR_FAIL=1 이고 묶기(-czf)면 실패 · 나머지는 진짜 tar
        f.write('#!/usr/bin/env bash\n[ "${FAKE_TAR_FAIL:-0}" = 1 ] && [ "$1" = "-czf" ] && { echo "fake: tar 실패" >&2; exit 2; }\n'
                'exec "$REAL_TAR" "$@"\n')
    os.chmod(os.path.join(bin_, 'tar'), 0o755)
    open(os.path.join(app, '.env'), 'w').write(f'UPLOAD_DIR={up}\n' + (f'DATABASE_URL={DB}\n' if DB else ''))
    REAL_TAR = shutil.which('tar')

    def run(*args, **ev):
        r = subprocess.run(['bash', BS, *args], capture_output=True, text=True,
                           env={**os.environ, 'APP_LINK': app, 'DATA_DIR': data, 'PATH': bin_ + ':' + os.environ['PATH'], 'REAL_TAR': REAL_TAR, **ev})
        return r.returncode, r.stdout + r.stderr

    c0, o0 = run('check')
    a0, oa = run()
    BK = os.path.join(data, 'backup/uploads'); VER = os.path.join(BK, '.verified')
    v0 = open(VER).read() if os.path.exists(VER) else ''
    a1, o1 = run()
    ok('④ 묶음 검사 — 처음 백업 때 검사(1개 · 깨짐 0 · .verified) · 7일 안에는 다시 안 함 · check 줄',
       '묶음 검사(7일마다 gzip -t): 아직 없음' in o0 and a0 == 0 and '묶음 검사 — 1개 모두 정상' in oa and '묶음 1개 · 깨짐 0' in v0
       and a1 == 0 and '묶음 검사 —' not in o1 and f'묶음 검사(7일마다 gzip -t): {v0.strip()}' in o1, f'{a0} {a1} · {v0.strip()}')
    open(os.path.join(BK, 'uploads_20200101.tar.gz'), 'wb').write(b'not a gzip file')
    old = time.time() - 8 * 86400
    os.utime(VER, (old, old))
    b1, ob1 = run()
    os.utime(VER, (old, old))
    b2, ob2 = run()
    nb = psql(f"SELECT count(*) FROM ops_alerts WHERE {BADQ}") if DB else '1'
    v1 = open(VER).read()
    ok('④ 7일 지나면 다시 검사 — 깨진 묶음 = 「깨진 묶음 1개」 · .verified 에 이름 · 운영 알림 UPLOADS_BACKUP_BAD 하루 한 번(두 번 검사해도 1) · 종료 값 그대로 0',
       b1 == 0 and b2 == 0 and '깨진 묶음 1개: uploads_20200101.tar.gz' in ob1 and '깨짐 1 (uploads_20200101.tar.gz)' in v1 and nb == '1', f'{b1} {b2} · {nb} · {v1.strip()}')
    os.remove(os.path.join(BK, 'uploads_20200101.tar.gz'))
    for f in os.listdir(BK):
        if f.startswith('uploads_') and f.endswith('.tar.gz'): os.remove(os.path.join(BK, f))
    f1, of1 = run(FAKE_TAR_FAIL='1'); f2, of2 = run(FAKE_TAR_FAIL='1')
    nf = psql(f"SELECT count(*) FROM ops_alerts WHERE {FAILQ}") if DB else '1'
    left = [f for f in os.listdir(BK) if f.startswith('uploads_')]
    ok('④ 묶기 실패 — 종료 값 1 · 「운영 알림 UPLOADS_BACKUP_FAILED」 · 반쪽 묶음 남지 않음 · 알림 하루 한 번(두 번 실패해도 1)',
       f1 == 1 and f2 == 1 and '묶기 실패' in of1 and 'UPLOADS_BACKUP_FAILED' in of1 and not left and nf == '1', f'{f1} {f2} · {nf} · {left}')
finally:
    if DB: psql(f"DELETE FROM ops_alerts WHERE {BADQ} OR {FAILQ}")
    shutil.rmtree(T, ignore_errors=True)

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)

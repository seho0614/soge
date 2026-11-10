"""v10.230 (docs/369) — 급한 운영 알림 대기 목록 CRITICAL 먼저 · 최근 순(D198)

  ① (코드) D198(두 대기 함수 순서 · 전체 수 함수 2개 · 지우는 문장 없음 · 236) · 보내는 쪽 「보내지 못한 알림 n건 더」 줄 · 문서 369
  ② (DB · 한 거래 안에서 하고 되돌림) 쌓인 알림을 비운 뒤 오래된 WARN 60건 + 새 CRITICAL + 새 WARN →
     목록 50건 · 맨 앞 새 CRITICAL · 그다음 최근 순 · 전체 수 62 · 한 종류를 1시간 안에 보내면 그 종류는 빠짐(1시간 규칙 그대로) · 남지 않음
"""
import os, re, subprocess

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


# ── ① 코드 ──────────────────────────────────────────────────────────────
mig = sorted(d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', d))) if os.path.isdir(os.path.join(K, 'prisma/migrations')) else []
M = rd('prisma/migrations/D198_ops_alert_pending_recent/migration.sql')
ok('① D198 — 두 대기 함수 CRITICAL 먼저 · 최근 순 · 기준 그대로(24시간 · 1시간 규칙 · STAFF_IP 종류) · 전체 수 함수 2개 · 지우는 문장 없음 · 236 이상',
   M.count("ORDER BY (o.severity = 'CRITICAL') DESC, o.id DESC") == 2 and 'ORDER BY o.id\n' not in M
   and 'CREATE OR REPLACE FUNCTION public.fn_ops_alert_mail_pending()' in M and 'CREATE OR REPLACE FUNCTION public.fn_ops_alert_push_pending()' in M
   and 'CREATE OR REPLACE FUNCTION public.fn_ops_alert_mail_backlog() RETURNS int' in M and 'CREATE OR REPLACE FUNCTION public.fn_ops_alert_push_backlog() RETURNS int' in M
   and M.count("interval '1 hour'") == 4 and M.count("interval '24 hours'") == 4 and M.count("'STAFF_IP_DAY_LIMIT'") == 4
   and not re.search(r'\b(DELETE FROM|DROP TABLE|DROP FUNCTION|TRUNCATE)\b', M) and len(mig) >= 236 and 'D198_ops_alert_pending_recent' in mig, f'{len(mig)}')
SC, LW = rd('src/worker/scheduler.service.ts'), rd('src/modules/admin/launch-watch.service.ts')
ok('① 보내는 쪽 — 메일 · 텔레그램 모두 전체 수에서 남은 수 · 「보내지 못한 알림 n건 더」 줄',
   "async alertBacklog(kind: 'mail' | 'push')" in LW and 'fn_ops_alert_mail_backlog()' in LW and 'fn_ops_alert_push_backlog()' in LW
   and "this.launchWatch.alertBacklog('mail')" in SC and "this.launchWatch.alertBacklog('push')" in SC and SC.count('보내지 못한 알림 ${more}건 더') == 2, '')
DOC = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('369_')] if os.path.isdir(os.path.join(K, 'docs')) else []
ok('① 문서 369 · 판 v10.230 이상', bool(DOC) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 230), f'{DOC} · {rd("VERSION").strip()}')


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return r.stdout.strip() if not r.returncode else ('!' + r.stderr.strip()[:300])


# ── ② DB(한 거래 · 되돌림) ──────────────────────────────────────────────
if DB:
    T = 't1230'
    sql = (
        "BEGIN; "
        "UPDATE ops_alerts SET mailed_at = now() - interval '3 hours' WHERE mailed_at IS NULL OR mailed_at > now() - interval '1 hour'; "
        "UPDATE ops_alerts SET pushed_at = now() - interval '3 hours' WHERE pushed_at IS NULL OR pushed_at > now() - interval '1 hour'; "
        f"INSERT INTO ops_alerts (alert_code, severity, raised_at, title) SELECT 'STAFF_LOGIN_NEW', 'WARN', now() - interval '20 hours' + g * interval '1 second', '{T} old ' || g FROM generate_series(1, 60) g; "
        f"INSERT INTO ops_alerts (alert_code, severity, raised_at, title) VALUES ('SERVER_ERROR_SPIKE', 'CRITICAL', now() - interval '1 minute', '{T} crit'); "
        f"INSERT INTO ops_alerts (alert_code, severity, raised_at, title) VALUES ('SETTING_CHANGED', 'WARN', now(), '{T} warn'); "
        "SELECT 'N:' || count(*) FROM fn_ops_alert_mail_pending(); "
        "SELECT 'NP:' || count(*) FROM fn_ops_alert_push_pending(); "
        "SELECT 'F:' || string_agg(title, ',' ORDER BY rn) FROM (SELECT title, row_number() OVER () AS rn FROM fn_ops_alert_mail_pending()) x WHERE rn <= 3; "
        "SELECT 'L:' || title FROM (SELECT title, row_number() OVER () AS rn FROM fn_ops_alert_mail_pending()) x WHERE rn = 50; "
        "SELECT 'B:' || fn_ops_alert_mail_backlog() || ':' || fn_ops_alert_push_backlog(); "
        f"UPDATE ops_alerts SET mailed_at = now() - interval '10 minutes' WHERE title = '{T} old 1'; "
        "SELECT 'H:' || count(*) FILTER (WHERE alert_code = 'STAFF_LOGIN_NEW') || ':' || count(*) || ':' || fn_ops_alert_mail_backlog() FROM fn_ops_alert_mail_pending(); "
        "ROLLBACK;")
    out = psql(sql)
    v = dict(x.split(':', 1) for x in out.splitlines() if ':' in x and not x.startswith('!'))
    ok('② 목록 — 50건 · 맨 앞 새 CRITICAL · 그다음 새 WARN · 최근 순(50번째는 old 13) · 텔레그램도 50건',
       v.get('N') == '50' and v.get('NP') == '50' and v.get('F') == f'{T} crit,{T} warn,{T} old 60' and v.get('L') == f'{T} old 13',
       f"{v.get('N')} {v.get('NP')} · {v.get('F')} · {v.get('L')} · {out[:160] if out.startswith('!') else ''}")
    ok('② 전체 수 62(50건 제한 없음) · 한 종류를 1시간 안에 보내면 그 종류는 빠짐 — 남은 것 2',
       v.get('B') == '62:62' and v.get('H') == '0:2:2', f"{v.get('B')} · {v.get('H')}")
    ok('② 되돌림 — 시험 알림 남지 않음', psql(f"SELECT count(*) FROM ops_alerts WHERE title LIKE '{T} %'") == '0', '')
else:
    print('  (DB 없음 — ② 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)

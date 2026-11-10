"""v10.228 (docs/366) — 운영 화면 접속 인증 경보(D197)

  ① (코드) D197(처음 보는 대역 통과 · 5번 틀림 · 하루 10번째 · 급한 알림 메일 · 텔레그램 대상 · IP 대역만 · 이메일 앞 두 글자 · 예외 삼킴) ·
     운영 알림 이름 3종 · 「접속 인증」 탭 안내 줄 · 문서 366
  ② (DB · 한 거래 안에서 하고 되돌림) 통과 첫 대역 알림 · 같은 대역은 없음 · 다른 대역 · IPv6 · 4번째 틀림까지 없음 · 5번째 알림 하나 ·
     번호 9개까지 없음 · 10번째 알림 · 11번째 없음 · 메일 · 텔레그램 대기 목록에 셋 다 · 다른 운영자 기록은 섞이지 않음
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
M = rd('prisma/migrations/D197_staff_ip_alert/migration.sql')
ok('① D197 — 통과 감시(30일 · /16 · /32) · 번호 감시(5번 · 10번째) · 알림 3종 WARN · clock_timestamp · 예외 삼킴 · 메일 · 텔레그램 대상 · 지우는 문장 없음 · 235',
   'trg_staff_ip_pass_watch AFTER INSERT ON public.staff_ip_passes' in M and 'trg_staff_ip_code_watch AFTER INSERT OR UPDATE OF tries ON public.staff_ip_codes' in M
   and "interval '30 days'" in M and 'THEN 16 ELSE 32 END' in M and 'NEW.tries >= 5 AND OLD.tries < 5' in M and 'v_today = 10' in M
   and M.count("'STAFF_IP_PASS_NEW', 'STAFF_IP_LOCKED', 'STAFF_IP_DAY_LIMIT'))") == 2 and M.count('clock_timestamp()') == 3 and M.count('EXCEPTION WHEN OTHERS') == 2
   and 'CREATE OR REPLACE FUNCTION public.fn_ops_alert_mail_pending()' in M and 'CREATE OR REPLACE FUNCTION public.fn_ops_alert_push_pending()' in M
   and not re.search(r'\b(DELETE FROM|DROP TABLE|TRUNCATE)\b', M) and len(mig) >= 235 and 'D197_staff_ip_alert' in mig, f'{len(mig)} · {mig[-1] if mig else ""}')
OA, SA = rd('web/src/app/admin/OpsAlerts.tsx'), rd('web/src/app/admin/StaffAccess.tsx')
ok('① 운영 화면 — 알림 이름 3종 · 「접속 인증」 탭 안내 줄',
   "STAFF_IP_PASS_NEW: '접속 인증 처음 보는 대역'" in OA and "STAFF_IP_LOCKED: '접속 인증번호 5번 틀림'" in OA and "STAFF_IP_DAY_LIMIT: '접속 인증번호 하루 한도'" in OA
   and 'data-ip-alert-note=""' in SA, '')
DOC = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('366_')] if os.path.isdir(os.path.join(K, 'docs')) else []
ok('① 문서 366 · 판 v10.228 이상', bool(DOC) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 228), f'{DOC} · {rd("VERSION").strip()}')


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return r.stdout.strip() if not r.returncode else ('!' + r.stderr.strip()[:300])


# ── ② DB(한 거래 · 되돌림) ──────────────────────────────────────────────
if DB:
    A = '00000000-0000-0000-0000-0000000a1228'
    B = '00000000-0000-0000-0000-0000000b1228'
    ins_pass = lambda acc, ip, d: f"INSERT INTO staff_ip_passes (account_id, ip, day, channel) VALUES ('{acc}', '{ip}', (now() AT TIME ZONE 'Asia/Seoul')::date - {d}, 'TELEGRAM_OPS'); "
    cnt = lambda code, acc: f"(SELECT count(*) FROM ops_alerts WHERE alert_code = '{code}' AND detail->>'accountId' = '{acc}')"
    code_row = f"INSERT INTO staff_ip_codes (account_id, ip, code_hash, channel, expires_at) VALUES ('{A}', '203.0.113.40', repeat('a', 64), 'SMS', now() + interval '5 minutes'); "
    sql = (
        "BEGIN; "
        "UPDATE ops_alerts SET mailed_at = mailed_at - interval '2 hours' WHERE alert_code LIKE 'STAFF_IP_%' AND mailed_at > now() - interval '1 hour'; "
        "UPDATE ops_alerts SET pushed_at = pushed_at - interval '2 hours' WHERE alert_code LIKE 'STAFF_IP_%' AND pushed_at > now() - interval '1 hour'; "
        f"INSERT INTO accounts (id, email, name, password_hash) VALUES ('{A}', 't1228a@x.com', '시험1228', 'x'), ('{B}', 't1228b@x.com', '시험1228b', 'x'); "
        + ins_pass(A, '203.0.113.40', 1)
        + f"SELECT 'P1:' || {cnt('STAFF_IP_PASS_NEW', A)}; "
        + ins_pass(A, '203.0.7.7', 0)
        + f"SELECT 'P2:' || {cnt('STAFF_IP_PASS_NEW', A)}; "
        + ins_pass(A, '198.51.100.40', 0) + ins_pass(A, '2001:db8:1228::1', 0) + ins_pass(B, '203.0.113.41', 0)
        + f"SELECT 'P3:' || {cnt('STAFF_IP_PASS_NEW', A)} || ':' || {cnt('STAFF_IP_PASS_NEW', B)}; "
        + f"SELECT 'PT:' || string_agg(detail->>'ip', ',' ORDER BY id) || '|' || min(detail->>'email') || '|' || bool_and(severity = 'WARN') FROM ops_alerts WHERE alert_code = 'STAFF_IP_PASS_NEW' AND detail->>'accountId' = '{A}'; "
        + code_row * 9
        + f"SELECT 'D9:' || {cnt('STAFF_IP_DAY_LIMIT', A)}; "
        + code_row
        + f"SELECT 'D10:' || {cnt('STAFF_IP_DAY_LIMIT', A)}; "
        + code_row
        + f"SELECT 'D11:' || {cnt('STAFF_IP_DAY_LIMIT', A)}; "
        + f"UPDATE staff_ip_codes SET tries = 4 WHERE id = (SELECT min(id) FROM staff_ip_codes WHERE account_id = '{A}'); "
        + f"SELECT 'L4:' || {cnt('STAFF_IP_LOCKED', A)}; "
        + f"UPDATE staff_ip_codes SET tries = 5 WHERE id = (SELECT min(id) FROM staff_ip_codes WHERE account_id = '{A}'); "
        + f"UPDATE staff_ip_codes SET tries = 5 WHERE id = (SELECT min(id) FROM staff_ip_codes WHERE account_id = '{A}'); "
        + f"SELECT 'L5:' || {cnt('STAFF_IP_LOCKED', A)}; "
        + f"SELECT 'LT:' || title FROM ops_alerts WHERE alert_code = 'STAFF_IP_LOCKED' AND detail->>'accountId' = '{A}'; "
        + "SELECT 'M:' || coalesce((SELECT string_agg(DISTINCT alert_code, ',' ORDER BY alert_code) FROM fn_ops_alert_mail_pending() WHERE alert_code LIKE 'STAFF_IP_%'), '') "
        + "|| '|' || coalesce((SELECT string_agg(DISTINCT alert_code, ',' ORDER BY alert_code) FROM fn_ops_alert_push_pending() WHERE alert_code LIKE 'STAFF_IP_%'), ''); "
        + "ROLLBACK;")
    out = psql(sql)
    v = dict(x.split(':', 1) for x in out.splitlines() if ':' in x and not x.startswith('!'))
    ok('② 통과 — 30일 첫 대역 알림 · 같은 대역(203.0) 다시는 없음 · 다른 대역 · IPv6 각각 · 다른 운영자는 따로 · 대역만 · 이메일 앞 두 글자 · WARN',
       v.get('P1') == '1' and v.get('P2') == '1' and v.get('P3') == '3:1'
       and v.get('PT') == '203.0.*.*,198.51.*.*,2001:db8::/32|t1***@x.com|true', f"{v.get('P1')} {v.get('P2')} {v.get('P3')} · {v.get('PT')} · {out[:120] if out.startswith('!') else ''}")
    ok('② 번호 — 9개까지 없음 · 10번째 하나 · 11번째 더 없음 / 틀림 4번 없음 · 5번째 하나(다시 5 로 고쳐도 하나) · 제목에 대역 · 15분',
       v.get('D9') == '0' and v.get('D10') == '1' and v.get('D11') == '1' and v.get('L4') == '0' and v.get('L5') == '1'
       and '203.0.*.*' in v.get('LT', '') and '15분' in v.get('LT', '') and '203.0.113.40' not in out,
       f"{v.get('D9')} {v.get('D10')} {v.get('D11')} · {v.get('L4')} {v.get('L5')} · {v.get('LT')}")
    ok('② 급한 알림 — 메일 · 텔레그램 대기 목록에 세 종류 모두',
       v.get('M') == 'STAFF_IP_DAY_LIMIT,STAFF_IP_LOCKED,STAFF_IP_PASS_NEW|STAFF_IP_DAY_LIMIT,STAFF_IP_LOCKED,STAFF_IP_PASS_NEW', v.get('M', ''))
    ok('② 되돌림 — 시험 계정 · 알림 남지 않음',
       psql(f"SELECT count(*) FROM accounts WHERE id IN ('{A}', '{B}')") == '0' and psql(f"SELECT count(*) FROM ops_alerts WHERE detail->>'accountId' IN ('{A}', '{B}')") == '0', '')
else:
    print('  (DB 없음 — ② 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)

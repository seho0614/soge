"""v10.163 시험 — 운영 화면 「권한」 부여 · 회수 결함 고침(D153 · docs/252)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1163.py

  ① 코드 — D153(fn_role_audit 가 INSERT 때 사유 · 처리자 · 수정 금지 트리거 그대로 · 지우는 문장 없음 · 191) · 서버(set_config 먼저 · UPDATE 없음) · docs/252 · 판
  ② (API · DB) SUPER 가 seller 에게 REVIEWER 주기 → 200 · 기록 GRANT(사유 · 처리자 = admin) · 빼기 → 200 · REVOKE(사유) ·
     사유 없음 422 · 자기 자신 422 · 없는 역할 회수 409 · ADMIN 은 403 · 기록 수정 · 삭제는 여전히 막힘 · 되돌림
"""
import json, os, re, subprocess, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
MD = os.path.join(K, 'prisma/migrations')
mig = sorted(d for d in os.listdir(MD) if os.path.isdir(os.path.join(MD, d)))
M = rd('prisma/migrations/D153_role_change_reason/migration.sql')
ok('① D153 — fn_role_audit 가 INSERT 때 사유(app.role_reason) · 처리자(app.actor_id · uuid 모양만) · 수정 금지 트리거는 건드리지 않음 · 지우는 문장 없음 · 191',
   'CREATE OR REPLACE FUNCTION public.fn_role_audit()' in M and "current_setting('app.role_reason', true)" in M and "current_setting('app.actor_id', true)" in M
   and 'INSERT INTO role_changes(account_id, role, action, reason, changed_by)' in M and 'fn_role_change_ro' not in M
   and not re.search(r'\b(DELETE FROM|DROP TABLE|DROP VIEW|DROP FUNCTION|DROP TRIGGER|TRUNCATE)\b', M) and (len(mig), mig[-1]) in ((191, 'D153_role_change_reason'), (192, 'D154_town_verify')), f'{len(mig)} · {mig[-1]}')
RS = rd('src/modules/site/report.service.ts')
sr = RS.split('async setRole(')[1][:2500] if 'async setRole(' in RS else ''
ok('① 서버 setRole — 거래 안에서 set_config(app.role_reason · app.actor_id) 를 역할 바꾸기보다 먼저 · role_changes UPDATE 없음 · docs/252 · 판 v10.163 이상',
   "set_config('app.role_reason', $1, true), set_config('app.actor_id', $2, true)" in sr and 'UPDATE role_changes' not in RS
   and sr.find("set_config('app.role_reason'") < sr.find('INSERT INTO account_roles')
   and any(f.startswith('252_') for f in os.listdir(os.path.join(K, 'docs'))) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 163), rd('VERSION').strip())


# ── ② API ─────────────────────────────────────────────────────────────
def call(m, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m)
    try:
        raw = urllib.request.urlopen(r, timeout=60).read()
        return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read() or b'{}')
        except Exception:
            body = {}
        return {'_err': e.code, 'code': body.get('code'), 'message': body.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode: print('  psql:', r.stderr.strip()[:200])
    return r.stdout.strip()


TGT = 'seller@x.com'; ADM = 'buyer@x.com'; ROLE = 'REVIEWER'; WHY = '시험 T1163 — 검수 보조'
if API and DB:
    tid = psql(f"SELECT id FROM accounts WHERE email = '{TGT}'"); aid = psql("SELECT id FROM accounts WHERE email = 'admin@x.com'")
    had = psql(f"SELECT count(*) FROM account_roles WHERE account_id = '{tid}' AND role = '{ROLE}'")
    n0 = psql("SELECT coalesce(max(id), 0) FROM role_changes")
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
    psql(f"INSERT INTO account_roles(account_id, role) SELECT id, 'ADMIN' FROM accounts WHERE email = '{ADM}' ON CONFLICT DO NOTHING;")
    TA = call('POST', '/auth/login', {'email': ADM, 'password': PW}).get('accessToken')
    try:
        if had != '0':
            psql(f"DELETE FROM account_roles WHERE account_id = '{tid}' AND role = '{ROLE}'")
        r1 = call('POST', '/admin/reports/roles', {'accountId': tid, 'role': ROLE, 'grant': True, 'reason': WHY}, T_)
        g = psql(f"SELECT action || '|' || coalesce(reason, '-') || '|' || coalesce(changed_by::text, '-') FROM role_changes WHERE id > {n0} AND account_id = '{tid}' AND role = '{ROLE}' ORDER BY id DESC LIMIT 1")
        has = psql(f"SELECT count(*) FROM account_roles WHERE account_id = '{tid}' AND role = '{ROLE}'")
        ok('② SUPER 가 역할 주기 → 200 · 역할 생김 · 기록 GRANT · 사유 · 처리자 = 운영자(전에는 수정 금지 트리거에 막혀 실패)',
           r1.get('granted') is True and has == '1' and g == f'GRANT|{WHY}|{aid}', f'{str(r1)[:80]} · {g}')
        lst = call('GET', '/admin/reports/roles/changes', t=T_)
        top = next((x for x in (lst or []) if isinstance(x, dict) and x.get('email') == TGT and x.get('role') == ROLE), {})
        ok('② 이력 API — 사유 · 처리자 이메일이 보임', top.get('reason') == WHY and top.get('changedBy') == 'admin@x.com', str(top)[:120])
        r2 = call('POST', '/admin/reports/roles', {'accountId': tid, 'role': ROLE, 'grant': False, 'reason': WHY + ' 끝'}, T_)
        v = psql(f"SELECT action || '|' || coalesce(reason, '-') FROM role_changes WHERE id > {n0} AND account_id = '{tid}' AND role = '{ROLE}' ORDER BY id DESC LIMIT 1")
        ok('② 빼기 → 200 · 기록 REVOKE · 사유', r2.get('granted') is False and v == f'REVOKE|{WHY} 끝'
           and psql(f"SELECT count(*) FROM account_roles WHERE account_id = '{tid}' AND role = '{ROLE}'") == '0', f'{str(r2)[:60]} · {v}')
        e1 = call('POST', '/admin/reports/roles', {'accountId': tid, 'role': ROLE, 'grant': True, 'reason': ' '}, T_)
        e2 = call('POST', '/admin/reports/roles', {'accountId': aid, 'role': 'ADMIN', 'grant': True, 'reason': WHY}, T_)
        e3 = call('POST', '/admin/reports/roles', {'accountId': tid, 'role': ROLE, 'grant': False, 'reason': WHY}, T_)
        e4 = call('POST', '/admin/reports/roles', {'accountId': tid, 'role': ROLE, 'grant': True, 'reason': WHY}, TA)
        ok('② 사유 없음 422 REASON_REQUIRED · 자기 자신 422 SELF_GRANT · 없는 역할 회수 409 NO_SUCH_ROLE · ADMIN 은 403',
           e1.get('code') == 'REASON_REQUIRED' and e2.get('code') == 'SELF_GRANT' and e3.get('code') == 'NO_SUCH_ROLE' and e4.get('_err') == 403,
           f"{e1.get('code')} · {e2.get('code')} · {e3.get('code')} · {e4.get('_err')}")
        rid = psql(f"SELECT max(id) FROM role_changes WHERE id > {n0} AND account_id = '{tid}'")
        u = subprocess.run(['psql', DB, '-X', '-q', '-At', '-c', f"UPDATE role_changes SET reason = 'x' WHERE id = {rid or 0}"], capture_output=True, text=True)
        d = subprocess.run(['psql', DB, '-X', '-q', '-At', '-c', f"DELETE FROM role_changes WHERE id = {rid or 0}"], capture_output=True, text=True)
        ok('② 권한 변경 기록은 여전히 수정 · 삭제 불가(trg_role_change_ro)', rid not in ('', None) and u.returncode != 0 and d.returncode != 0
           and '권한 변경 기록은 수정·삭제할 수 없습니다' in (u.stderr + d.stderr), (u.stderr or '')[:80])
    finally:
        psql(f"DELETE FROM account_roles WHERE role = 'ADMIN' AND account_id = (SELECT id FROM accounts WHERE email = '{ADM}');")
        psql(f"DELETE FROM account_roles WHERE account_id = '{tid}' AND role = '{ROLE}';" + (f" INSERT INTO account_roles(account_id, role) VALUES ('{tid}', '{ROLE}');" if had != '0' else ''))
    ok('끝 — 되돌림(seller 역할 처음대로 · buyer ADMIN 없음)', psql(f"SELECT count(*) FROM account_roles WHERE account_id = '{tid}' AND role = '{ROLE}'") == had
       and psql(f"SELECT count(*) FROM account_roles WHERE role = 'ADMIN' AND account_id = (SELECT id FROM accounts WHERE email = '{ADM}')") == '0', '')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)

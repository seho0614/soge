"""v10.195 시험 — 중요 스위치 안전장치 3종(D174 · docs/306)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1195.py

  ① 코드 — D174(fn_setting_watch · trg_setting_watch · 바꿀 때만 · 대상 키 · WARN · 지우는 문장 없음 · 212) ·
     서버(주문 받기 켜기는 SUPER · 간주 결제 켜짐이면 확인 문구 · 사유 10자 · 끄기는 그대로 · 사유를 거래 설정으로) ·
     운영 화면(켜기 칸 · 알림 이름) · 하루 요약 줄 · postcheck 파트너 줄 · docs/306 · 판
  ② (DB) 같은 값 저장은 알림 없음 · 값 바뀜은 SETTING_CHANGED(WARN · 사유 · via) · 대상 아닌 설정은 알림 없음
  ③ (API) ADMIN 켜기 403 · ADMIN 끄기 200 · SUPER 확인 문구 없이 422 · 사유 짧으면 422 · 둘 다 맞으면 200(알림에 사유 · APP) ·
     하루 요약 「어제 바뀐 중요 설정」 · 되돌림
"""
import json, os, re, subprocess, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB')
HERE = os.path.dirname(os.path.abspath(__file__))
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
M = rd('prisma/migrations/D174_setting_change_alert/migration.sql')
ok('① D174 — 설정 바뀜 트리거(바꿀 때만 · 대상 키 · WARN · 사유 · via) · 지우는 문장 없음 · 212',
   'CREATE OR REPLACE FUNCTION public.fn_setting_watch()' in M and 'AFTER UPDATE OF value ON public.site_settings' in M
   and 'IF NEW.value IS NOT DISTINCT FROM OLD.value THEN' in M
   and "NEW.key IN ('mall.order_open', 'signup.open', 'admin.mfa_required')" in M and "NEW.key LIKE 'assume.%' OR NEW.key LIKE 'feature.%'" in M
   and "VALUES ('SETTING_CHANGED', 'WARN'," in M and "current_setting('app.setting_reason', true)" in M and "'via', CASE WHEN v_by IS NULL THEN 'DB' ELSE 'APP' END" in M
   and not re.search(r'\b(DELETE FROM|DROP TABLE|DROP VIEW|DROP FUNCTION|TRUNCATE)\b', M) and len(mig) >= 212 and 'D174_setting_change_alert' in mig,
   f'{len(mig)} · {mig[-1]}')
AS = rd('src/modules/admin/admin.service.ts'); AC = rd('src/modules/admin/admin.controller.ts'); AD = rd('src/modules/admin/admin.dto.ts')
ok('① 서버 — 주문 받기 켜기는 SUPER · 간주 결제 켜짐이면 확인 문구 · 사유 10자 · 끄기는 검사 밖 · 사유를 거래 설정으로 · DTO · 응답 문서',
   "if (key === 'mall.order_open' && (value ?? '').trim() !== 'off') {" in AS and "new Forbidden('ORDER_SETTING_SUPER'" in AS
   and "static readonly ORDER_OPEN_CONFIRM = '시험 결제 주문을 받습니다';" in AS and "new PolicyViolation('ORDER_OPEN_CONFIRM'" in AS
   and "(reason ?? '').trim().length < 10" in AS and "new PolicyViolation('ORDER_OPEN_REASON'" in AS
   and "SELECT set_config('app.setting_reason', $1, true)" in AS and 'await this.db.transaction(async () => {' in AS
   and 'this.admin.updateSetting(dto.key, dto.value, dto.reason, dto.confirm' in AC and 'ORDER_OPEN_CONFIRM · ORDER_OPEN_REASON' in AC
   and '@IsOptional() @IsString() @MaxLength(300) reason?: string;' in AD and '@IsOptional() @IsString() @MaxLength(50) confirm?: string;' in AD, '')
LW = rd('web/src/app/admin/LaunchWatch.tsx'); OA = rd('web/src/app/admin/OpsAlerts.tsx'); WS = rd('src/modules/admin/launch-watch.service.ts')
ok('① 운영 화면 — 간주 결제 켜짐에 켜기 칸(사유 · 확인 문구 · 그래도 켜기) · 알림 이름 · 하루 요약 「어제 바뀐 중요 설정」',
   "if (to === 'on' && d.assumePayment === 'on') { setOpenForm((v) => !v); return; }" in LW and 'data-order-open-form=""' in LW
   and 'data-order-open-reason=""' in LW and 'data-order-open-confirm=""' in LW and 'reason: openReason, confirm: openConfirm' in LW
   and "SETTING_CHANGED: '중요 설정 바뀜'" in OA and "alert_code = 'SETTING_CHANGED'" in WS and "'어제 바뀐 중요 설정:'" in WS, '')
PC = rd('deploy/aws/postcheck.sh')
ok('① postcheck — D173 전 활동 중 파트너 제휴 자격 줄(통과 · 확인 · D173 전 판 건너뜀)',
   "p.status = 'ACTIVE' AND p.aff_status IS NULL AND p.approved_at < (SELECT applied_at FROM schema_migrations WHERE name = 'D173_partner_roles_aff_status')" in PC
   and 'ok "파트너 제휴 자격 — D173 전 활동 중 파트너 모두 복사됨"' in PC and 'warn "D173 전 활동 중 안심 파트너 ${n}곳의 제휴 자격이 비어 있음"' in PC
   and subprocess.run(['bash', '-n', os.path.join(K, 'deploy/aws/postcheck.sh')]).returncode == 0, '')
ok('① 문서 · 판 — docs/306 · v10.195 이상', any(f.startswith('306_') for f in os.listdir(os.path.join(K, 'docs')))
   and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 195), rd('VERSION').strip())


# ── ② · ③ DB · API ────────────────────────────────────────────────────
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


def psql(sql, quiet=False):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode and not quiet: print('  psql:', r.stderr.strip()[:200])
    return r.stdout.strip() if not r.returncode else ('!' + r.stderr.strip())


def login(email):
    return call('POST', '/auth/login', {'email': email, 'password': PW}).get('accessToken')


ADMU, SUPU = 't1195adm@x.com', 'admin@x.com'
WHY = '시험 T1195'
CONF = '시험 결제 주문을 받습니다'
if API and DB:
    import sys
    sys.path.insert(0, HERE)
    import consent_ok
    pw = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{ADMU}', '시험운영', '{pw}', now()) ON CONFLICT DO NOTHING")
    aid = psql(f"SELECT id FROM accounts WHERE email = '{ADMU}'")
    sv = lambda k: psql(f"SELECT coalesce((SELECT value FROM site_settings WHERE key = '{k}'), '')")
    keep = {k: sv(k) for k in ('mall.order_open', 'assume.payment', 'signup.open')}
    mark = psql('SELECT coalesce(max(id), 0) FROM ops_alerts')
    new = lambda: psql(f"SELECT coalesce(string_agg(detail->>'key' || ':' || coalesce(detail->>'from', '-') || '>' || coalesce(detail->>'to', '-') || ':' || severity || ':' || (detail->>'via') || ':' || coalesce(detail->>'reason', '-'), ',' ORDER BY id), '') FROM ops_alerts WHERE id > {mark} AND alert_code = 'SETTING_CHANGED'")
    try:
        psql(f"BEGIN; SELECT set_config('app.role_reason', '{WHY}', true); INSERT INTO account_roles(account_id, role) VALUES ('{aid}', 'ADMIN') ON CONFLICT DO NOTHING; COMMIT;")
        psql("UPDATE site_settings SET value = 'on' WHERE key = 'assume.payment'")
        psql("UPDATE site_settings SET value = 'off' WHERE key = 'mall.order_open'")
        mark = psql('SELECT coalesce(max(id), 0) FROM ops_alerts')

        o = keep['signup.open'] or 'on'
        psql(f"UPDATE site_settings SET value = '{o}' WHERE key = 'signup.open'")
        psql("UPDATE site_settings SET value = value || '' WHERE key = 'ops.signup_spike_per_hour'", quiet=True)
        a0 = new()
        psql(f"BEGIN; SELECT set_config('app.setting_reason', '{WHY} DB', true); UPDATE site_settings SET value = '{'off' if o == 'on' else 'on'}' WHERE key = 'signup.open'; COMMIT;")
        psql(f"UPDATE site_settings SET value = '{o}' WHERE key = 'signup.open'")
        a1 = new()
        ok('② 같은 값 · 대상 아닌 설정은 알림 없음 · 값 바뀜은 SETTING_CHANGED(WARN · via DB · 사유) · 되돌림도 알림',
           a0 == '' and a1 == f"signup.open:{o}>{'off' if o == 'on' else 'on'}:WARN:DB:{WHY} DB,signup.open:{'off' if o == 'on' else 'on'}>{o}:WARN:DB:-", a1)

        for e in (ADMU, SUPU):
            consent_ok.agree(e, PW)
        TA, TS = login(ADMU), login(SUPU)
        mark = psql('SELECT coalesce(max(id), 0) FROM ops_alerts')
        P = lambda t, b: call('PATCH', '/admin/site-settings', b, t)
        r1 = P(TA, {'key': 'mall.order_open', 'value': 'on', 'reason': WHY + ' 관리자 켜기', 'confirm': CONF})
        r2 = P(TS, {'key': 'mall.order_open', 'value': 'on', 'reason': WHY + ' 확인 문구 없음'})
        r3 = P(TS, {'key': 'mall.order_open', 'value': 'on', 'reason': '짧음', 'confirm': CONF})
        s0 = sv('mall.order_open')
        ok('③ ADMIN 켜기 403 ORDER_SETTING_SUPER · SUPER 확인 문구 없이 422 ORDER_OPEN_CONFIRM · 사유 짧으면 422 ORDER_OPEN_REASON · 그대로 off · 알림 없음',
           r1.get('_err') == 403 and r1.get('code') == 'ORDER_SETTING_SUPER' and r2.get('_err') == 422 and r2.get('code') == 'ORDER_OPEN_CONFIRM'
           and r3.get('_err') == 422 and r3.get('code') == 'ORDER_OPEN_REASON' and s0 == 'off' and new() == '', f'{r1.get("code")} {r2.get("code")} {r3.get("code")} {s0}')
        r4 = P(TS, {'key': 'mall.order_open', 'value': 'on', 'reason': WHY + ' 시연용 시험 주문', 'confirm': CONF})
        s1 = sv('mall.order_open')
        r5 = P(TA, {'key': 'mall.order_open', 'value': 'off'})
        s2 = sv('mall.order_open')
        a2 = new()
        ok('③ SUPER 확인 문구 · 사유 → 켜짐 · 알림(APP · 사유) · ADMIN 끄기 200 · 알림(APP · 사유 없음)',
           r4.get('value') == 'on' and s1 == 'on' and r5.get('value') == 'off' and s2 == 'off'
           and a2 == f'mall.order_open:off>on:WARN:APP:{WHY} 시연용 시험 주문,mall.order_open:on>off:WARN:APP:-', a2)

        psql(f"INSERT INTO ops_alerts(alert_code, severity, title, detail, raised_at) VALUES ('SETTING_CHANGED', 'WARN', '중요 설정 바뀜 — feature.t1195: off → on', '{{\"key\": \"feature.t1195\"}}', ((now() AT TIME ZONE 'Asia/Seoul')::date - 1 + time '12:00') AT TIME ZONE 'Asia/Seoul')")
        dg = call('GET', '/admin/launch-watch/digest', None, TS)
        txt = dg.get('text') or ''
        ok('③ 하루 요약 — 「어제 바뀐 중요 설정」 · 줄 내용', '어제 바뀐 중요 설정:' in txt and '  - feature.t1195: off → on' in txt, txt[-160:].replace('\n', ' / '))
    finally:
        psql("DELETE FROM ops_alerts WHERE alert_code = 'SETTING_CHANGED' AND detail->>'key' = 'feature.t1195'", quiet=True)
        for k, v in keep.items():
            if v:
                psql(f"UPDATE site_settings SET value = '{v}' WHERE key = '{k}'", quiet=True)
        psql(f"BEGIN; SELECT set_config('app.role_reason', '{WHY} 끝', true); DELETE FROM account_roles WHERE account_id = '{aid}' AND role = 'ADMIN'; COMMIT;", quiet=True)
    ok('끝 — 되돌림(설정 · 시험 계정 역할)', all(sv(k) == v for k, v in keep.items() if v)
       and psql(f"SELECT count(*) FROM account_roles WHERE account_id = '{aid}'") == '0', str(keep))
else:
    print('  (API · DB 없음 — ② · ③ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)

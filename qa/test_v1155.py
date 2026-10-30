"""v10.155 시험 — 알림톡 켜기 전 시험 발송 확인 · 세금계산서 간주 끄기 전 키 확인 · 시험 발행(D148 · docs/235 · 순서표 docs/228 5절 6 · 8)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e ADMIN_WEB=http://localhost:15173 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1155.py
  (가짜 업체 서버로 실제 시험 발행까지 보는 것은 test_v1155_etax.py — docker 를 부르므로 서버에서 직접)

  ① 코드 — D148(설정 처음 on · 형식 · 시험 기록 ETAX · ETAX_KEY · ETAX_TEST_ISSUE · 지우는 문장 없음 · 186) · 서버 잠금 2개 · 지금 방식만 근거 ·
     시험 발행은 ETAX_TEST_URL 로만(운영 주소와 같으면 안 보냄) · API(SUPER · 감사) · 화면 명세 · 운영 화면 3곳 · postcheck [10] 잠금 4개 · 설정 예시 · docs/235 · 리허설 · 판
  ② (API · 알림톡 MOCK) 시험 발송 없이 켜기 → 422 ALIMTALK_TEST_FIRST · 8일 전 · 다른 방식(HTTP) · 실패 줄은 근거 아님 · 시험 발송(MOCK) → 켜짐 ·
     끄기는 언제나 · ADMIN 은 잠금 403 · 형식 오류 · SUPER 가 끄면 그대로 켜짐 · 되돌림
  ③ (API · 세금계산서 · 점검판 주소 없음) 상태 etax · 키 확인 · 시험 발행 둘 다 NOT_CONFIGURED(하루 횟수 안 셈) · ADMIN 403 · 간주 끄기는 그대로 ETAX_CONFIG_FIRST
  ④ (운영 화면) 알림톡 — 마지막 시험 발송 · 잠금 줄 · 단추 / 결제 · 계좌 연결 확인 — 세금계산서 줄 4개 · 단추 · 잠금 줄
"""
import json, os, re, subprocess, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
HERE = os.path.dirname(os.path.abspath(__file__))
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel, base=None):
    p = os.path.join(base or K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
D = rd('prisma/migrations/D148_alimtalk_etax_lock/migration.sql')
mig = sorted(x for x in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', x)))
ok('① D148 — 설정 alimtalk.require_test 처음 on · on/off 형식 · 하루 시험 발행 3 · 시험 기록 ETAX · 두 종류(앞 종류 그대로) · 지우는 문장 없음 · 186 이상',
   "('alimtalk.require_test', 'on', 'GLOBAL'" in D and "'^(on|off)$', 'on')" in D and "('integ.etax_test_daily', '3', 'GLOBAL'" in D and 'ON CONFLICT (key) DO NOTHING' in D
   and "integration_code IN ('PG', 'BANK', 'PASS', 'MAIL', 'ETAX')" in D and "kind IN ('PG_KEY', 'BANK_SEND', 'BANK_CONFIRM', 'NICE_TOKEN', 'MAIL_TEST', 'ETAX_KEY', 'ETAX_TEST_ISSUE')" in D
   and not re.search(r'\b(DELETE FROM|DROP TABLE|TRUNCATE)\b', D) and D.count('UPDATE public.site_settings') == 1 and "WHERE key = 'etax.require_config'" in D
   and 'SET value' not in D and len(mig) >= 186 and 'D148_alimtalk_etax_lock' in mig, f'{len(mig)} · {mig[-1]}')
AS = rd('src/modules/admin/admin.service.ts')
blk = AS.split("if (key === 'notify.alimtalk_ready'")[1].split('\n  }\n')[0] if "if (key === 'notify.alimtalk_ready'" in AS else ''
ok('① 서버 — 알림톡 켤 때(준비 검사 뒤) 잠금 on 이면 지금 방식 7일 안 시험 성공 없음 → ALIMTALK_TEST_FIRST · 잠금 설정은 alimtalk.* 라 SUPER',
   "settingVal('alimtalk.require_test', 'on')" in blk and "AlimtalkService.lastTestOk(this.db, AlimtalkService.readMode(" in blk and "new PolicyViolation('ALIMTALK_TEST_FIRST'" in blk
   and blk.index('ALIMTALK_NOT_READY') < blk.index('ALIMTALK_TEST_FIRST') and "key.startsWith('alimtalk.')" in AS, '')
eblk = AS.split("if (key === 'assume.etax' && (await this.settingVal('etax.require_config', 'on')) !== 'off')")[1].split('\n    }\n')[0] if 'assume.etax' in AS else ''
ok('① 서버 — 간주 끄기: 잠금 on 이면 주소 · 키(ETAX_CONFIG_FIRST) 다음 7일 안 키 확인 · 시험 발행(ETAX_TEST_FIRST)',
   "'ETAX_CONFIG_FIRST'" in eblk and "IntegTestService.etaxTestMissing(this.db)" in eblk and "new PolicyViolation('ETAX_TEST_FIRST'" in eblk
   and eblk.index('ETAX_CONFIG_FIRST') < eblk.index('ETAX_TEST_FIRST'), '')
AL = rd('src/common/alimtalk/alimtalk.service.ts')
ok('① 알림톡 — 7일 · 시험(TEST) · 보냄(SENT) · 지금 방식(provider = $1)만 · NONE 이면 없음 · 상태에 requireTest · lastTestOkAt · lastTest',
   "static async lastTestOk(db: DatabaseService, mode: AlimtalkMode)" in AL and "if (mode === 'NONE') return null;" in AL
   and "WHERE purpose = 'TEST' AND status = 'SENT' AND provider = $1 AND created_at > now() - interval '7 days'" in AL
   and all(x in AL for x in ("requireTest: (await this.setting('alimtalk.require_test', 'on'))", 'lastTestOkAt: await AlimtalkService.lastTestOk(this.db, mode)', 'lastTest: (await this.db.query')), '')
IT = rd('src/modules/site/integ-test.service.ts')
ok('① 세금계산서 — 키 확인은 운영 주소 조회만(status) · 시험 발행은 ETAX_TEST_URL(키 ETAX_TEST_KEY 또는 ETAX_KEY) · 같은 주소 SAME_URL · 승인번호 있어야 성공 · 기록 두 줄',
   "new HttpEtaxAdapter(url, key).status('SGB-K-'" in IT and "new HttpEtaxAdapter(turl, tkey).issue(" in IT and "env.ETAX_TEST_KEY?.trim() || key" in IT
   and "errorKind: 'SAME_URL'" in IT and "r.status === 'SENT' && r.approvalNo" in IT and "kind: 'ETAX_KEY'" in IT and "kind: 'ETAX_TEST_ISSUE'" in IT
   and "if (r.status === 'NOT_FOUND') return { ok: true" in IT and 'new HttpEtaxAdapter(url, key).issue' not in IT
   and "throw new PolicyViolation('ETAX_TEST_LIMIT'" in IT and "static async etaxTestMissing(db: DatabaseService)" in IT
   and "kind IN ('ETAX_KEY', 'ETAX_TEST_ISSUE') AND ok AND NOT stub AND created_at > now() - interval '7 days'" in IT, '')
IC = rd('src/modules/site/integ-test.controller.ts')
cpos = IC.find('export class IntegEtaxStateDto'); spos = IC.find('export class IntegTestStatusDto')
ok("① API — POST /admin/integ-tests/etax-test SUPER · 감사 INTEG_TEST_ETAX · 422 ETAX_TEST_LIMIT · DTO 선언 순서(상태 DTO 보다 먼저)",
   "@Post('etax-test')\n  @Roles('SUPER')" in IC and "@Audit('INTEG_TEST_ETAX', 'INTEGRATION')" in IC and "description: 'ETAX_TEST_LIMIT'" in IC
   and 0 <= cpos < spos and IC.find('export class IntegEtaxTestDto') > IC.find('export class IntegEtaxIssueDto') > IC.find('export class IntegEtaxPartDto') >= 0, '')
SJ = json.loads(rd('spec/screens.json') or '{}')
sit = next((s for s in (SJ if isinstance(SJ, list) else SJ.get('screens', [])) if s.get('id') == 'SB-ADM-SIT-080'), {}) if SJ else {}
ok('① 화면 명세 — SB-ADM-SIT-080 에 POST /admin/integ-tests/etax-test', 'POST /admin/integ-tests/etax-test' in (sit.get('apis') or []) or '"POST /admin/integ-tests/etax-test"' in rd('spec/screens.json'), '')
AC = rd('src/modules/site/alimtalk-admin.controller.ts')
ok('① 알림톡 상태 DTO — AlimtalkLastTestDto 가 AlimtalkStatusDto 보다 먼저 · requireTest · lastTestOkAt · lastTest',
   0 <= AC.find('export class AlimtalkLastTestDto') < AC.find('export class AlimtalkStatusDto') and all(x in AC for x in ('requireTest!: boolean', 'lastTestOkAt!: string | null', 'lastTest!: AlimtalkLastTestDto | null')), '')
AP = rd('web/src/app/admin/AlimtalkPanel.tsx'); IP = rd('web/src/app/admin/IntegTestPanel.tsx'); SW = rd('web/src/app/admin/Switches.tsx')
ok('① 운영 화면 — 알림톡(마지막 시험 · 잠금 줄 · SUPER 단추 · 끌 때 확인 창) · 연결 확인(세금계산서 줄 4개 · 단추 · 확인 창 · 잠금 줄) · 스위치 설명',
   all(x in AP for x in ('data-alimtalk-check=', 'data-alimtalk-require-test=', 'data-alimtalk-require-flip', "setting('alimtalk.require_test', next")) and 'window.confirm(' in AP.split('function flipRequire')[1].split('async function test')[0]
   and '{isSuper && <>' in AP.split('data-alimtalk-require-test')[1]
   and all(x in IP for x in ("'etax-conf'", "'etax-test-url'", "'etax-key-ok'", "'etax-issue-ok'", 'data-integtest-etax', 'data-integtest-etax-lock', "'/admin/integ-tests/etax-test'"))
   and 'window.confirm(' in IP.split('function etaxTest')[1].split('function bankSend')[0] and '7일 안 키 확인 · 시험 발행' in SW, '')
PC = rd('deploy/aws/postcheck.sh')
ok('① postcheck [10] — 잠금 4개 on(읽기만)', "'identity.require_check', 'etax.require_config', 'notify.require_mail_test', 'alimtalk.require_test'" in PC and '잠금 4개 on' in PC
   and 'alimtalk.require_test=on · etax.require_config=on · identity.require_check=on · notify.require_mail_test=on' in PC, '')
EX = rd('deploy/aws/env.production.example'); RG = rd('src/common/integration/registry.ts')
ok('① 설정 예시 · 연동 등록부 — ETAX_TEST_URL · ETAX_TEST_KEY', '# ETAX_TEST_URL=  ETAX_TEST_KEY=' in EX and "'ETAX_TEST_URL', 'ETAX_TEST_KEY'" in RG, '')
D235 = next((rd('docs/' + f) for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('235_')), '')
ok('① docs/235 — 오류 코드 · 처음 on · 시험 주소로만 · 같은 주소 막음 · 순서표 6 · 8 · 하지 말 것',
   all(x in D235 for x in ('ALIMTALK_TEST_FIRST', 'ETAX_TEST_FIRST', 'alimtalk.require_test', 'ETAX_TEST_URL', 'SAME_URL', '6 세금계산서', '8 알림톡', '하지 말 것')), '')
F236 = next((f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('236_')), '')
D236 = rd('docs/' + F236) if F236 else ''
ok('① docs/236 — 운영 적용 v10.128 → v10.155 한 번 · 20 · 186 · 스냅샷 v10-155 · 킷 ~/kits/release · 잠금 4개 화면 32 ~ 35 · 하지 말 것 · docs/232 대신',
   'v10.155' in F236 and '`적용됨 166 · 새 킷의 파일 186 · 올릴 것 20 · 바뀐 파일 0`' in D236 and '`적용 20 · 기존 166 · 변경감지 0`' in D236 and '186 / 186' in D236
   and 'sgb-before-v10-155' in D236 and '~/kits/release/' in D236 and 'v10_152' not in D236 and all(f'| {n} |' in D236 for n in (32, 33, 34, 35))
   and '잠금 4개 끄기' in D236 and 'ETAX_TEST_URL' in D236 and 'docs/236(v10.128 → v10.155)이 이 문서를 대신합니다' in next((rd('docs/' + f) for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('232_')), ''), F236)
RO = rd('rehearse_open.py', HERE)
ok('① 리허설 — 알림톡 켜기 전 시험 발송(MOCK) 단계', "step('3-alimtalk-test'" in RO and RO.index("step('3-alimtalk-test'") < RO.index("step('3-alimtalk-ready'"), '')
ok('① 판 v10.155 이상', tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 155), rd('VERSION').strip())


# ── ② · ③ API ─────────────────────────────────────────────────────────
def call(m, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, headers=hd, method=m)
    try:
        return json.load(urllib.request.urlopen(r, timeout=60))
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


KEYS = ('alimtalk.provider', 'notify.alimtalk_ready', 'alimtalk.require_test', 'assume.etax', 'etax.require_config')
SELLER = 'seller@x.com'
if API and DB:
    was = {k: psql(f"SELECT value FROM site_settings WHERE key = '{k}'") for k in KEYS}
    tpl0 = psql("SELECT string_agg(code || '=' || coalesce(vendor_code, '') || '=' || review_state, ';' ORDER BY code) FROM alimtalk_templates")
    etax0 = psql("SELECT status FROM integrations WHERE code = 'ETAX'")
    mark = psql("SELECT now()::text")
    had_role = psql(f"SELECT count(*) FROM account_roles r JOIN accounts a ON a.id = r.account_id WHERE a.email = '{SELLER}' AND r.role = 'ADMIN'") != '0'
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW})['accessToken']
    psql(f"INSERT INTO account_roles(account_id, role) SELECT id, 'ADMIN' FROM accounts WHERE email = '{SELLER}' ON CONFLICT DO NOTHING;")
    TA = call('POST', '/auth/login', {'email': SELLER, 'password': PW})['accessToken']
    sv = lambda k, v, t=T_: call('PATCH', '/admin/site-settings', {'key': k, 'value': v}, t)
    get = lambda k: psql(f"SELECT value FROM site_settings WHERE key = '{k}'")
    fake = lambda age, prov='MOCK', st='SENT': psql(f"INSERT INTO alimtalk_sends (purpose, template_code, to_last4, status, provider, created_at) VALUES ('TEST', 'NOTICE_GENERAL', '1155', '{st}', '{prov}', now() - interval '{age}') RETURNING 1")
    try:
        # ── ② 알림톡 ──
        ok('② 전제 — 알림톡 꺼짐 · 잠금 on(처음 값)', was['notify.alimtalk_ready'] in ('off', '') and was['alimtalk.require_test'] == 'on', str(was))
        psql("DELETE FROM alimtalk_sends WHERE purpose = 'TEST'")
        sv('alimtalk.provider', 'MOCK')
        for c in ('NOTICE_GENERAL', 'CONSULT_OTP'):
            call('PUT', f'/admin/alimtalk/templates/{c}', {'vendorCode': f'SGB_{c}', 'reviewState': 'APPROVED'}, T_)
        s0 = call('GET', '/admin/alimtalk/status', t=T_)
        ok('② MOCK · 승인 템플릿 → 준비됨 · 상태에 requireTest · 시험 없음', s0.get('configured') is True and s0.get('requireTest') is True and s0.get('lastTestOkAt') is None
           and s0.get('lastTest') is None, str({k: s0.get(k) for k in ('configured', 'requireTest', 'lastTestOkAt')}))
        r = sv('notify.alimtalk_ready', 'on')
        ok('② 시험 발송 없이 켜기 → 422 ALIMTALK_TEST_FIRST · 그대로 꺼짐', r.get('_err') == 422 and r.get('code') == 'ALIMTALK_TEST_FIRST' and get('notify.alimtalk_ready') in ('off', ''), str(r)[:120])
        fake('8 days')
        ok('② 8일 전 성공은 근거 아님(7일)', sv('notify.alimtalk_ready', 'on').get('code') == 'ALIMTALK_TEST_FIRST', '')
        fake('1 minute', prov='HTTP')
        ok('② 다른 방식(HTTP) 성공은 근거 아님(지금은 MOCK)', sv('notify.alimtalk_ready', 'on').get('code') == 'ALIMTALK_TEST_FIRST', '')
        fake('30 seconds', st='FAILED')
        st = call('GET', '/admin/alimtalk/status', t=T_)
        ok('② 실패 줄은 근거 아님 · 상태 — 마지막 시험(실패) · 7일 안 성공 없음', sv('notify.alimtalk_ready', 'on').get('code') == 'ALIMTALK_TEST_FIRST'
           and (st.get('lastTest') or {}).get('ok') is False and st.get('lastTestOkAt') is None, str(st.get('lastTest'))[:100])
        t1 = call('POST', '/admin/alimtalk/test', {'to': '01012341155', 'template': 'NOTICE_GENERAL'}, T_)
        r = sv('notify.alimtalk_ready', 'on'); st = call('GET', '/admin/alimtalk/status', t=T_)
        ok('② 시험 발송(MOCK · 밖으로 안 나감) → 켜짐 · 상태에 성공 시각 · 마지막 시험 MOCK 보냄', t1.get('ok') is True and r.get('_err') is None and get('notify.alimtalk_ready') == 'on'
           and st.get('lastTestOkAt') and (st.get('lastTest') or {}).get('provider') == 'MOCK' and (st.get('lastTest') or {}).get('ok') is True, f'{str(t1)[:60]} · {str(r)[:60]}')
        ok('② 알림톡 끄기는 언제나', sv('notify.alimtalk_ready', 'off').get('_err') is None and get('notify.alimtalk_ready') == 'off', '')
        psql("DELETE FROM alimtalk_sends WHERE purpose = 'TEST'")
        ok('② 운영(ADMIN)은 잠금을 못 바꿈(403 INTEG_SETTING_SUPER)', sv('alimtalk.require_test', 'off', TA).get('code') == 'INTEG_SETTING_SUPER' and get('alimtalk.require_test') == 'on', '')
        ok('② 형식 오류(OFF) 거절', sv('alimtalk.require_test', 'OFF').get('_err') in (400, 422) and get('alimtalk.require_test') == 'on', '')
        r1 = sv('alimtalk.require_test', 'off'); r2 = sv('notify.alimtalk_ready', 'on')
        ok('② SUPER 가 잠금 끔 → 시험 없이도 그대로 켜짐(전과 같음)', r1.get('_err') is None and r2.get('_err') is None and get('notify.alimtalk_ready') == 'on', f'{r1} · {r2}'[:120])
        sv('notify.alimtalk_ready', 'off'); sv('alimtalk.require_test', 'on')

        # ── ③ 세금계산서(점검판 — 업체 주소 · 시험 주소 없음) ──
        psql("DELETE FROM integration_tests WHERE integration_code = 'ETAX'")
        e0 = call('GET', '/admin/integ-tests', t=T_).get('etax') or {}
        ok('③ 상태 — 세금계산서 칸(주소 · 키 · 시험 주소 없음 · 잠금 켜짐 · 하루 3번)', e0.get('url') is False and e0.get('testUrl') is False and e0.get('testKey') is None
           and e0.get('requireTest') is True and e0.get('lastKeyOkAt') is None and (e0.get('test') or {}).get('limit') == 3, str(e0)[:160])
        x = call('POST', '/admin/integ-tests/etax-test', {}, T_)
        rows = psql("SELECT string_agg(kind || '|' || ok || '|' || coalesce(error_kind, ''), ',' ORDER BY kind) FROM integration_tests WHERE integration_code = 'ETAX'")
        ok('③ 키 확인 · 시험 발행 — 주소 없으면 둘 다 NOT_CONFIGURED · 기록 두 줄 · 하루 횟수 안 셈', x.get('ok') is False and (x.get('key') or {}).get('errorKind') == 'NOT_CONFIGURED'
           and (x.get('issue') or {}).get('errorKind') == 'NOT_CONFIGURED' and x.get('left') == 3 and rows == 'ETAX_KEY|false|NOT_CONFIGURED,ETAX_TEST_ISSUE|false|NOT_CONFIGURED', f'{str(x)[:100]} · {rows}')
        rc = call('GET', '/admin/integ-tests', t=T_)
        ok('③ 최근 시험에 세금계산서 줄', sum(1 for r_ in rc.get('recent', []) if r_.get('code') == 'ETAX') == 2, '')
        ok('③ 운영(ADMIN)은 시험 못 함(403)', call('POST', '/admin/integ-tests/etax-test', {}, TA).get('_err') == 403, '')
        call('PATCH', '/admin/integrations/ETAX', {'status': 'TESTING'}, T_)
        r = sv('assume.etax', 'off')
        ok('③ 간주 끄기 — 주소 · 키 없으면 그대로 ETAX_CONFIG_FIRST(앞 판과 같음) · 간주 그대로', r.get('code') == 'ETAX_CONFIG_FIRST' and get('assume.etax') == 'on', str(r)[:100])
    finally:
        for k, v in was.items():
            psql(f"UPDATE site_settings SET value = '{v}' WHERE key = '{k}';")
        for part in (tpl0 or '').split(';'):
            if part.count('=') == 2:
                c, vc, stt = part.split('=')
                psql(f"UPDATE alimtalk_templates SET vendor_code = {('NULL' if not vc else repr(vc))}, review_state = '{stt}' WHERE code = '{c}';")
        if etax0: psql(f"UPDATE integrations SET status = '{etax0}' WHERE code = 'ETAX';")
        psql(f"DELETE FROM alimtalk_sends WHERE created_at >= '{mark}' OR to_last4 = '1155';")
        psql("DELETE FROM integration_tests WHERE integration_code = 'ETAX'")
        if not had_role:
            psql(f"DELETE FROM account_roles WHERE role = 'ADMIN' AND account_id = (SELECT id FROM accounts WHERE email = '{SELLER}');")
    ok('②③ 되돌림 — 설정 5개 · 템플릿 · 세금계산서 연동 상태 · 시험 기록', all(get(k) == v for k, v in was.items())
       and psql("SELECT string_agg(code || '=' || coalesce(vendor_code, '') || '=' || review_state, ';' ORDER BY code) FROM alimtalk_templates") == tpl0
       and psql("SELECT status FROM integrations WHERE code = 'ETAX'") == etax0 and psql("SELECT count(*) FROM integration_tests WHERE integration_code = 'ETAX'") == '0', str(was))

# ── ④ 운영 화면 ───────────────────────────────────────────────────────
if ADMIN_WEB:
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sync_playwright = None
    if sync_playwright:
        with sync_playwright() as p:
            b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1400, 'height': 1000})
            pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
            pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(1500)
            pg.goto(ADMIN_WEB + '/#/integrations', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
            box = pg.locator('[data-alimtalk-panel]')
            chk = box.locator('[data-alimtalk-check]'); req = box.locator('[data-alimtalk-require-test]')
            ok('④ 알림톡 — 「마지막 시험 발송」 줄(7일 안 성공 없음) · 「알림톡 켜기 전 시험 발송 확인」 켜짐 · 단추',
               chk.count() == 1 and chk.get_attribute('data-alimtalk-check') == 'none' and req.count() == 1 and req.get_attribute('data-alimtalk-require-test') == 'on'
               and req.locator('[data-alimtalk-require-flip]').count() == 1, (req.inner_text()[:80] if req.count() else '없음'))
            it = pg.locator('[data-integtest-panel]')
            rows = [it.locator(f'[data-integtest-row="{k}"]').count() for k in ('etax-conf', 'etax-test-url', 'etax-key-ok', 'etax-issue-ok')]
            lock = it.locator('[data-integtest-etax-lock]')
            ok('④ 결제 · 계좌 연결 확인 — 세금계산서 줄 4개 · 「세금계산서 키 확인 · 시험 발행」 단추 · 잠금 줄 켜짐',
               rows == [1, 1, 1, 1] and it.locator('[data-integtest-etax]').count() == 1 and lock.count() == 1 and lock.get_attribute('data-integtest-etax-lock') == 'on', str(rows))
            if lock.count(): lock.scroll_into_view_if_needed()
            pg.screenshot(path=os.path.join(HERE, 'v1155_etax_test.png'), full_page=False)
            if req.count(): req.scroll_into_view_if_needed()
            pg.screenshot(path=os.path.join(HERE, 'v1155_alimtalk_lock.png'), full_page=False)
            b.close()

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)

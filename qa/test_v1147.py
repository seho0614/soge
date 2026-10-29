"""v10.147 시험 — 메일 · 알림톡 준비 전 안내(docs/226 2절) · 운영 적용 절차서 docs/226 · 신청 묶음 docs/227

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e SITE=http://localhost:15174 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1147.py

  ① 코드 — API 2개(공개 · 신청과 같은 기준) · DTO · 화면 3곳(안내 · 단추 막기 · 못 읽으면 막지 않음) · 사전 ko/en · 화면 목록 · 문서 · 판
  ② (API) 로그인 없이 200 · 모양(ready · byPhone · byMail) · 점검판(개발 환경)은 ready=true
     AI 켜기 단계 — 6줄 순서 · 손님 403 · 앞 단계 전에 켠 스위치는 early · 되돌림
     재설정 링크(SUPER) — 손님 403 · 까닭 없으면 422 · 만들기 · 다시 만들면 앞 링크 무효 · 새 링크로 재설정 · 운영진 계정 403 · 감사 기록에 링크 없음
  ③ (사용자 웹) 점검판에서는 안내가 없고 단추가 살아 있음 — /consult · /login/forgot
"""
import json, os, re, subprocess, urllib.error, urllib.request

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
API = os.environ.get('API'); SITE = os.environ.get('SITE'); DB = os.environ.get('DB')
PW = 'sgb-dev-1234'
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
CS = rd('src/modules/partner/consult.service.ts'); CC = rd('src/modules/partner/consult.controller.ts')
AS = rd('src/modules/identity/account-security.service.ts'); AC = rd('src/modules/identity/account-security.controller.ts')
ok('① 상담 — GET /consult/ready · 신청과 같은 기준(알림톡 · 메일 · 개발 환경) · DTO',
   "@Get('ready')" in CC and 'class ConsultReadyDto' in CC and 'async readiness()' in CS
   and 'byPhone || byMail || devMode' in CS and CC.index('class ConsultReadyDto') < CC.index('export class ConsultController'), '')
ok('① 비밀번호 — GET /auth/password/forgot/ready · forgot 과 같은 기준 · DTO 가 컨트롤러 앞',
   "@Get('auth/password/forgot/ready')" in AC and 'class ForgotReadyDto' in AC and 'async forgotReady()' in AS
   and 'this.mail.ready()) || AccountSecurityService.devMode()' in AS
   and AC.index('class ForgotReadyDto') < AC.index('export class AccountSecurityController'), '')
ok('① 공개 API — @Roles 를 붙이지 않음',
   not re.search(r"@Roles\([^)]*\)\s*\n\s*@Get\('ready'\)", CC) and not re.search(r"@Roles\([^)]*\)\s*\n\s*@Get\('auth/password/forgot/ready'\)", AC), '')
CF = rd('site/src/app/consult/ConsultForm.tsx'); PF = rd('site/src/components/auth/PasswordForms.tsx')
CP = rd('site/src/app/consult/page.tsx'); AP = rd('site/src/app/mal/consult/[code]/apply/page.tsx'); FP = rd('site/src/app/login/forgot/page.tsx')
ok('① 상담 화면 — 안내 · 두 단추 막기 · 두 페이지가 ready 를 넘김 · 못 읽으면 막지 않음(catch → true)',
   'data-consult-not-ready' in CF and CF.count('|| !ready}') == 2 and "ready = true" in CF
   and all("'/consult/ready'" in x and '.catch(() => true)' in x and 'ready={ready}' in x for x in (CP, AP)), '')
ok('① 비밀번호 찾기 — 안내 · 고객센터 링크 · 단추 막기 · 페이지가 ready 를 넘김',
   'data-forgot-not-ready' in PF and 'disabled={pending || !ready}' in PF and "'/auth/password/forgot/ready'" in FP
   and 'ready={ready}' in FP and '.catch(() => true)' in FP, '')
M = {l: json.loads(rd(f'site/src/i18n/messages/{l}.json') or '{}') for l in ('ko', 'en')}
MC = {l: json.loads(rd(f'site/src/i18n/messages/{l}/consult.json') or '{}') for l in ('ko', 'en')}
ok('① 사전 ko · en — pwForm.notReady · consult.form.notReady · 영어에 operator 없음',
   all(M[l].get('pwForm', {}).get('notReady') and MC[l].get('form', {}).get('notReady') for l in ('ko', 'en'))
   and 'operator' not in (M['en']['pwForm']['notReady'] + MC['en']['form']['notReady']).lower(), '')
scr = {s['id']: s for s in json.loads(rd('spec/screens.json') or '{}').get('screens', [])}
ok('① 화면 목록 — 상담 2곳 · 비밀번호 찾기에 API 연결',
   all('GET /consult/ready' in scr.get(i, {}).get('apis', []) for i in ('SB-MAL-CSL-010', 'SB-MAL-CSL-030'))
   and 'GET /auth/password/forgot/ready' in scr.get('SB-HOM-AUT-040', {}).get('apis', []), '')
docs = os.listdir(os.path.join(K, 'docs'))
D226 = next((rd('docs/' + d) for d in docs if d.startswith('226_')), ''); D227 = next((rd('docs/' + d) for d in docs if d.startswith('227_')), '')
ok('① docs/226 — 마이그레이션 14 · 180 · 스냅샷 v10-147 · READY 2줄 · 화면 확인 22 ~ 24',
   '적용 14 · 기존 166 · 변경감지 0' in D226 and '180 / 180' in D226 and 'sgb-before-v10-147' in D226
   and 'READY:2' in D226 and '| 24 |' in D226 and 'v10_145' not in D226, '')
ok('① docs/227 — 발신 IP · 웹훅 3개 · returnurl · 키 이름(연동 키 칸과 같음)',
   '3.37.95.217' in D227 and all(f'/api/v1/webhooks/{w}' in D227 for w in ('toss', 'esign', 'safenum'))
   and '/verify/return' in D227 and all(k in D227 for k in ('NICE_CLIENT_ID', 'ALIMTALK_SENDER_KEY', 'ESIGN_WEBHOOK_SECRET', 'SAFENUM_WEBHOOK_SECRET', 'TOSS_CLIENT_KEY')), '')
D141 = rd('prisma/migrations/D141_safenum/migration.sql')
ok('① docs/227 의 키 이름이 모두 연동 키 칸(D141 제약)에 있음',
   all(f"'{k}'" in D141 for k in re.findall(r'\b(NICE_CLIENT_ID|NICE_CLIENT_SECRET|NICE_PRODUCT_ID|BANK_VERIFY_KEY|TOSS_SECRET_KEY|TOSS_CLIENT_KEY|ALIMTALK_KEY|ALIMTALK_SENDER_KEY|ESIGN_API_KEY|ESIGN_WEBHOOK_SECRET|SAFENUM_KEY|SAFENUM_WEBHOOK_SECRET|NTS_SERVICE_KEY|ETAX_KEY|BROKER_LOOKUP_KEY|SMTP_USER|SMTP_PASS)\b', D227)), '')
ok('① 재설정 링크 — SUPER 만 · @Audit 안 씀(응답에 링크) · 운영진 계정 막음 · 까닭 5자 · 감사 기록 PASSWORD_RESET_LINK',
   "@Post('admin/accounts/:id/password-reset-link')" in AC
   and re.search(r"password-reset-link'\)\s*\n\s*@HttpCode\(200\)\s*\n\s*@ApiBearerAuth\(\)\s*\n\s*@Roles\('SUPER'\)\s*\n\s*@ApiOperation", AC)
   and 'STAFF_ACCOUNT' in AS and "'PASSWORD_RESET_LINK'" in AS and 'REASON_REQUIRED' in AS
   and 'class ResetLinkDto' in AC and AC.index('class ResetLinkResultDto') < AC.index('export class AccountSecurityController'), '')
MB = rd('web/src/app/admin/Members.tsx')
ok('① 운영 화면 — 회원 상세에 SUPER 만 「재설정 링크」', "tokenRoles().includes('SUPER') && <ResetLink" in MB and 'data-reset-link-make' in MB
   and 'POST /admin/accounts/{id}/password-reset-link' in scr.get('SB-ADM-MBR-020', {}).get('apis', []), '')
AS2 = rd('src/modules/agent/agent.service.ts'); AC2 = rd('src/modules/agent/agent.controller.ts')
RO = rd('web/src/app/admin/ailearn/AgentRollout.tsx'); SW = rd('web/src/app/admin/ailearn/AgentSwitches.tsx'); ST = rd('web/src/app/admin/ailearn/AgentStatus.tsx')
ok('① AI 켜기 단계 — API(ADMIN · SUPER · 읽기만) · 기준 숫자(14일 · 100건 · 90% · 7일 · 95% · 3일) · DTO 가 컨트롤러 앞',
   "@Get('admin/agent/rollout')" in AC2 and 'async rollout()' in AS2 and 'class AgentRolloutStepDto' in AC2
   and AC2.index('class AgentRolloutStepDto') < AC2.index('export class AgentController')
   and all(x in AS2 for x in ('>= 14', '>= 100', '>= 90', '>= 7', '>= 95', '>= 3', "source !== 'NONE'"))
   and not re.search(r'UPDATE |INSERT ', AS2[AS2.index('async rollout()'):]), '')
ok('① 운영 화면 — 「AI 켜기 단계」 표 · 스위치 위 · 앞 단계 전이면 확인 창 경고 · 스위치 바꾸면 다시 읽음',
   'data-agent-rollout' in RO and 'data-rollout-early' in RO and '<AgentRollout key={tick} />' in ST
   and ST.index('<AgentRollout') < ST.index('<AgentSwitches') and "x.state === 'WAIT'" in SW and 'ro.reload()' in SW
   and 'GET /admin/agent/rollout' in scr.get('SB-ADM-AGT-010', {}).get('apis', []), '')
ok('① 판 v10.147 이상', tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 147), rd('VERSION').strip())


# ── ② API ────────────────────────────────────────────────────────────
def get(p):
    try:
        return json.load(urllib.request.urlopen(API + p, timeout=60))
    except urllib.error.HTTPError as e:
        return {'_err': e.code}


if API:
    r = get('/consult/ready')
    ok('② GET /consult/ready — 로그인 없이 · ready · byPhone · byMail · 점검판 ready=true',
       isinstance(r, dict) and r.get('ready') is True and isinstance(r.get('byPhone'), bool) and isinstance(r.get('byMail'), bool), str(r))
    r = get('/auth/password/forgot/ready')
    ok('② GET /auth/password/forgot/ready — 로그인 없이 · 점검판 ready=true', r == {'ready': True}, str(r))

def call(m, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, headers=hd, method=m)
    try:
        return json.load(urllib.request.urlopen(r, timeout=60))
    except urllib.error.HTTPError as e:
        try:
            body = json.load(e)
        except Exception:
            body = {}
        return {'_err': e.code, 'code': body.get('code')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode: print('  psql:', r.stderr.strip()[:200])
    return r.stdout.strip()


if API and DB:
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW})['accessToken']
    BT = call('POST', '/auth/login', {'email': 'buyer@x.com', 'password': PW})['accessToken']
    bid = psql("SELECT id FROM accounts WHERE email = 'buyer@x.com'"); aid = psql("SELECT id FROM accounts WHERE email = 'admin@x.com'")
    R = '고객센터 전화 · 가입 휴대폰 뒤 4자리 확인(시험)'
    ok('② 재설정 링크 — 손님 403', call('POST', f'/admin/accounts/{bid}/password-reset-link', {'reason': R}, BT).get('_err') == 403, '')
    r = call('POST', f'/admin/accounts/{bid}/password-reset-link', {'reason': 'ab'}, T_)
    ok('② 까닭이 짧으면 422 REASON_REQUIRED', r.get('_err') == 422 and r.get('code') == 'REASON_REQUIRED', str(r))
    r1 = call('POST', f'/admin/accounts/{bid}/password-reset-link', {'reason': R}, T_)
    r2 = call('POST', f'/admin/accounts/{bid}/password-reset-link', {'reason': R}, T_)
    tk = lambda r: (re.search(r'token=([A-Za-z0-9_-]+)', r.get('url', '')) or [None, None])[1]
    ok('② 링크 만들기 — /login/reset?token= · 30분 이하', tk(r1) and tk(r2) and 0 < r2.get('expiresInMinutes', 0) <= 60, str(r2.get('expiresInMinutes')))
    x = call('POST', '/auth/password/reset', {'token': tk(r1), 'password': PW})
    ok('② 다시 만들면 앞 링크 무효', x.get('_err') == 422 and x.get('code') == 'RESET_TOKEN_INVALID', str(x))
    x = call('POST', '/auth/password/reset', {'token': tk(r2), 'password': PW})
    ok('② 새 링크로 재설정 · 다시 로그인', x.get('ok') is True and 'accessToken' in call('POST', '/auth/login', {'email': 'buyer@x.com', 'password': PW}), str(x)[:80])
    x = call('POST', f'/admin/accounts/{aid}/password-reset-link', {'reason': R}, T_)
    ok('② 운영진 계정 403 STAFF_ACCOUNT', x.get('_err') == 403 and x.get('code') == 'STAFF_ACCOUNT', str(x))
    # AI 켜기 단계
    ro = call('GET', '/admin/agent/rollout', t=T_)
    codes = [x.get('code') for x in ro] if isinstance(ro, list) else []
    ok('② AI 켜기 단계 — 6줄 순서 · 상태 값', codes == ['TERMS', 'KEY', 'REVIEW', 'CHAT', 'LOOKUP', 'DRAFTS']
       and all(x['state'] in ('DONE', 'RUN', 'READY', 'WAIT') and isinstance(x['early'], bool) and x['now'] and x['need'] for x in ro), ' '.join(f"{x['code']}:{x['state']}" for x in ro) if codes else str(ro))
    ok('② AI 켜기 단계 — 손님 403', call('GET', '/admin/agent/rollout', t=BT).get('_err') == 403, '')
    k = 'agent.chat.drafts.enabled'; was = psql(f"SELECT value FROM site_settings WHERE key = '{k}'")
    try:
        psql(f"UPDATE site_settings SET value = 'on' WHERE key = '{k}'")
        ro2 = {x['code']: x for x in call('GET', '/admin/agent/rollout', t=T_)}
        lk = ro2['LOOKUP']['state'] == 'DONE'
        ok('② 신청서 초안을 앞 단계 전에 켜면 early · 상태 RUN/DONE', ro2['DRAFTS']['on'] and (ro2['DRAFTS']['early'] is (not lk))
           and ro2['DRAFTS']['state'] in ('DONE', 'RUN'), f"LOOKUP {ro2['LOOKUP']['state']} · DRAFTS early {ro2['DRAFTS']['early']}")
    finally:
        psql(f"UPDATE site_settings SET value = '{was}' WHERE key = '{k}'")
    ok('② 되돌림 — 신청서 초안 스위치', psql(f"SELECT value FROM site_settings WHERE key = '{k}'") == was, was)

    a = psql(f"SELECT after_data::text FROM audit.audit_logs WHERE action = 'PASSWORD_RESET_LINK' AND target_id = '{bid}' ORDER BY occurred_at DESC LIMIT 1")
    ok('② 감사 기록 — 까닭은 있고 링크 · 증표는 없음', R in a and 'token' not in a and tk(r2) not in a, a[:120])

# ── ③ 사용자 웹 ───────────────────────────────────────────────────────
if SITE:
    def page(p):
        try:
            return urllib.request.urlopen(SITE + p, timeout=120).read().decode('utf-8', 'replace')
        except urllib.error.HTTPError as e:
            return f'HTTP {e.code}'
    h = page('/consult')
    ok('③ /consult — 준비됨이면 안내 없음 · 신청서 있음', 'data-consult-not-ready' not in h and 'data-csl-submit' in h, '')
    h = page('/login/forgot')
    ok('③ /login/forgot — 준비됨이면 안내 없음 · 폼 있음', 'data-forgot-not-ready' not in h and 'data-forgot-form' in h, '')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)

"""v10.793 (docs/908 · D332) 상담 신청 — 메일 인증번호만으로 받기 스위치(consult.mail_otp · 처음 off)
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb python3 test_v1793.py
  ① (코드) D332 설정 · 스위치 안내 · 신청 때 알림톡 없이 메일만이면 스위치 확인 · readiness byMail 에 스위치 · 옛 v10.43 문장 그대로 · 문서 908
  ② (API · DB) 설정 off · SUPER · on/off 만 · GET /consult/ready 에 mailOtp=false · 점검판(개발) ready=true
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
__import__('consent_ok').agree_seed()

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb' if os.path.isdir(KIT + '/sgb') else KIT
API = os.environ.get('API')
DB = os.environ.get('DB')
ADMIN_WEB = os.environ.get('ADMIN_WEB')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


def doc(prefix):
    d = os.path.join(K, 'docs')
    return next((open(os.path.join(d, x), encoding='utf-8').read() for x in (os.listdir(d) if os.path.isdir(d) else []) if x.startswith(prefix)), '')


VER = rd('VERSION').strip()
VT = tuple(int(x) for x in re.findall(r'\d+', VER))


def call(m_, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
    try:
        body = urllib.request.urlopen(r, timeout=180).read()
        return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code'), 'message': bd.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return (r.stdout.strip() + ('\n!' + r.stderr.strip() if r.returncode else '')).strip()




def login(e):
    return call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')


MIG = rd('prisma/migrations/D332_consult_mail_otp_switch/migration.sql')
CS, CC = rd('src/modules/partner/consult.service.ts'), rd('src/modules/partner/consult.controller.ts')
ok('① D332 — consult.mail_otp off · SUPER · on/off · 스위치 안내(docs/908)', "('consult.mail_otp', 'off', 'SUPER'" in MIG and "'^(on|off)$'" in MIG
   and 'INSERT INTO public.opx_switch_docs' in MIG and "'docs/908'" in MIG, '')
ok('① 서버 — 알림톡 없이 메일만이면 스위치 확인(NOTIFY_NOT_READY) · readiness byMail = 메일 준비 && (휴대폰 || 스위치) · mailOtp · 옛 문장 그대로',
   'if (!alimtalk && byMail && !(await this.mailOtpAlone()))' in CS and 'const byMail = (await this.mail.ready()) && (byPhone || mailOtp);' in CS
   and 'const byMail = await this.mail.ready()' in CS and 'const ready = alimtalk || byMail' in CS and 'byPhone || byMail || devMode' in CS
   and "key = 'consult.mail_otp'" in CS and 'mailOtp!: boolean' in CC and '법무' in doc('908_') and VT >= (10, 793), VER)

if API and DB:
    row = psql("SELECT value || '|' || scope || '|' || value_pattern FROM site_settings WHERE key = 'consult.mail_otp'")
    doc_ = psql("SELECT count(*) FROM opx_switch_docs WHERE key = 'consult.mail_otp'")
    r = call('GET', '/consult/ready')
    ok('② 설정 off · SUPER · on/off · 스위치 안내 1 · GET /consult/ready mailOtp=false · 점검판 ready=true',
       row == 'off|SUPER|^(on|off)$' and doc_ == '1' and r.get('mailOtp') is False and r.get('ready') is True, f"{row} · {doc_} · {r}")
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)

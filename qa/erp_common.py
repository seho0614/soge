"""e3.7t (docs/e3.7t-notes.md) 회계 · 세무 시험을 ERP 로 옮길 때 쓰는 공용 부품

  ERP_API=http://localhost:13100/api/v1 SGB_API=http://localhost:13000/api/v1 \\
  ERP_DB=postgresql://sgb:sgb@localhost:15432/sgb_erp SGB_DB=postgresql://sgb:sgb@localhost:15432/sgb \\
  python3 qa/test_erp_v1449.py

  · 점검판만 — API 는 localhost:13100(ERP) · localhost:13000(소개뱅크) · DB 는 localhost:15432 의 sgb_erp · sgb 만(다른 주소면 멈춤 2)
  · 증표: login(email) → 소개뱅크 로그인 → POST /admin/erp/handoff → ERP POST /auth/handoff → ERP 증표(Tok)
          넘겨주기가 안 되는 계정(회원 · SUPER 아닌 운영자)은 소개뱅크 증표를 그대로 ERP 에 보냄(ERP 가 introspect — 회원이면 403 ERP_NOT_STAFF)
          Tok 은 글자(ERP 증표)이고 .sgb 에 소개뱅크 증표를 가짐 — sgb(...) · ticket(...) 은 .sgb 를 씀
  · DB: 소개뱅크 표(accounts · account_roles · site_settings · files · ad_* · hlt_* …) 쓰기는 psql_sgb
        ERP 표(acct_* · hr* · lgl_* · ops_alerts · erp_*) 는 psql_erp — ERP 안에서 소개뱅크 표는 svc.<표>(읽기만)
  · 코드 검사: rd('src/modules/acct/x.ts') → ERP 저장소 api/src/modules/acct/x.ts (ERP_ROOT · 처음은 이 파일의 위 폴더)
  · 끝: summary() 가 「결과: n / m」 을 찍고 모두 통과면 0 · 아니면 1 로 끝냄
"""
import json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

ERP_API = os.environ.get('ERP_API') or 'http://localhost:13100/api/v1'
SGB_API = os.environ.get('SGB_API') or 'http://localhost:13000/api/v1'
ERP_DB = os.environ.get('ERP_DB') or 'postgresql://sgb:sgb@localhost:15432/sgb_erp'
SGB_DB = os.environ.get('SGB_DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
ERP_ROOT = os.environ.get('ERP_ROOT') or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_HOSTS = ('localhost', '127.0.0.1')


def _guard():
    bad = []
    for name, url, port in (('ERP_API', ERP_API, 13100), ('SGB_API', SGB_API, 13000)):
        u = urllib.parse.urlparse(url)
        if u.hostname not in _HOSTS or u.port != port:
            bad.append(f'{name}={url}')
    for name, url, db in (('ERP_DB', ERP_DB, 'sgb_erp'), ('SGB_DB', SGB_DB, 'sgb')):
        u = urllib.parse.urlparse(url)
        if u.scheme not in ('postgresql', 'postgres') or u.hostname not in _HOSTS or u.port != 15432 or u.path.lstrip('/') != db:
            bad.append(f'{name}=…@{u.hostname}:{u.port}/{u.path.lstrip("/")}')
    if bad:
        print('점검판 주소만 — API localhost:13100 · 13000 · DB localhost:15432/sgb_erp · sgb (' + ' · '.join(bad) + ')')
        raise SystemExit(2)


_guard()

# 옛 시험과 같은 이름(옮긴 시험이 그대로 씀) — 화면 단계는 ERP 화면이 아직 없어 늘 건너뜀
API, DB = ERP_API, ERP_DB
ADMIN_WEB = None
SITE = None
PW = 'sgb-dev-1234'
K = ERP_ROOT
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def summary():
    n_ok = sum(1 for r in RES if r[0])
    print(f"\n결과: {n_ok} / {len(RES)}")
    sys.exit(0 if n_ok == len(RES) else 1)


# ---------------------------------------------------------------- 코드 읽기(ERP 저장소)
def _map(rel):
    return 'api/' + rel if rel.startswith('src/') else rel


def rd(rel):
    p = os.path.join(ERP_ROOT, _map(rel))
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


def doc(prefix):
    d = os.path.join(ERP_ROOT, 'docs')
    return next((open(os.path.join(d, x), encoding='utf-8').read() for x in (sorted(os.listdir(d)) if os.path.isdir(d) else []) if x.startswith(prefix)), '')


VER = rd('VERSION').strip()
VT = tuple(int(x) for x in re.findall(r'\d+', VER))


# ---------------------------------------------------------------- HTTP
class Tok(str):
    """ERP 증표(글자) + .sgb(같은 사람의 소개뱅크 증표)"""
    sgb = None


def call(base, m_, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + str(t)
    r = urllib.request.Request(base + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
    try:
        body = urllib.request.urlopen(r, timeout=180).read()
        return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code'), 'message': bd.get('message')}


def erp(m_, p, b=None, t=None):
    """ERP API(13100) — ERP 증표"""
    return call(ERP_API, m_, p, b, str(t) if t else None)


def sgb(m_, p, b=None, t=None):
    """소개뱅크 API(13000) — Tok 이면 .sgb(소개뱅크 증표)"""
    return call(SGB_API, m_, p, b, (getattr(t, 'sgb', None) or (str(t) if t else None)))


def raw(m_, url, data, ct, t=None):
    hd = {'content-type': ct}
    if t:
        hd['Authorization'] = 'Bearer ' + str(t)
    try:
        return urllib.request.urlopen(urllib.request.Request(url, data=data, headers=hd, method=m_), timeout=60).status
    except urllib.error.HTTPError as e:
        return e.code


def sgb_login(email, pw=PW):
    """소개뱅크 로그인 → 소개뱅크 증표(없으면 None)"""
    return call(SGB_API, 'POST', '/auth/login', {'email': email, 'password': pw}).get('accessToken')


def login_full(e, pw=PW):
    return call(SGB_API, 'POST', '/auth/login', {'email': e, 'password': pw})


def handoff(sgb_tok):
    """소개뱅크 증표 → 운영 화면 넘겨주기 코드 → ERP 증표(안 되면 None)"""
    code = (call(SGB_API, 'POST', '/admin/erp/handoff', {}, sgb_tok) or {}).get('code')
    if not code:
        return None
    return (call(ERP_API, 'POST', '/auth/handoff', {'code': code}) or {}).get('accessToken')


def erp_token_for(email, pw=PW):
    """그 사람의 ERP 증표(Tok) — 넘겨주기가 안 되면 소개뱅크 증표를 그대로(ERP 가 introspect)"""
    st = sgb_login(email, pw)
    if not st:
        return None
    t = Tok(handoff(st) or st)
    t.sgb = st
    return t


login = erp_token_for


def jwt_life(tok):
    import base64
    try:
        p = str(tok).split(".")[1]; p += "=" * (-len(p) % 4)
        j = json.loads(base64.urlsafe_b64decode(p)); return int(j["exp"]) - int(j["iat"])
    except Exception:
        return None


# ---------------------------------------------------------------- 약관 동의 · 내려받기 승인(소개뱅크 쪽)
def agree(email, password=PW):
    """옛 consent_ok.agree — 소개뱅크 필수 약관 동의(실패해도 멈추지 않음)"""
    try:
        tok = sgb_login(email, password)
        if not tok:
            return []
        req = call(SGB_API, 'GET', '/terms/required', None, tok)
        items = [{'code': x['code'], 'agreed': True} for x in (req if isinstance(req, list) else []) if x.get('isRequired') and not x.get('agreed')]
        if items:
            call(SGB_API, 'POST', '/terms/agree', {'items': items}, tok)
        return [i['code'] for i in items]
    except Exception:
        return []


def agree_seed(password=PW):
    return {e: agree(e, password) for e in ('buyer@x.com', 'seller@x.com', 'intro@x.com', 'person@x.com')}


def ticket(tok, target, approver=None, reason='시험 내려받기'):
    """옛 export_ticket.get — 승인 번호는 소개뱅크(/admin/export-requests)에서 · ERP ExportGate 는 svc.export_requests 를 읽음"""
    r = sgb('POST', '/admin/export-requests', {'target': target, 'reason': reason}, tok)
    if r.get('_err') or not r.get('id'):
        return None
    if r.get('state') == 'APPROVED':
        return r['id']
    if approver:
        d = sgb('POST', f"/admin/export-requests/{r['id']}/decide", {'approve': True}, approver)
        if d.get('state') == 'APPROVED':
            return r['id']
    return None


# ---------------------------------------------------------------- DB
def _psql(url, sql):
    r = subprocess.run(['psql', url, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return (r.stdout.strip() + ('\n!' + r.stderr.strip() if r.returncode else '')).strip()


def psql_erp(sql):
    """ERP DB(sgb_erp) — acct_* · hr* · ops_alerts · erp_* · 소개뱅크 표는 svc.<표>(읽기만)"""
    return _psql(ERP_DB, sql)


def psql_sgb(sql):
    """소개뱅크 DB(sgb) — accounts · account_roles · site_settings · files · ad_* …"""
    return _psql(SGB_DB, sql)


def replica_erp(sql):
    """가드 트리거를 건너뛰고 ERP 시험 데이터만 지움(시험 끝 정리)"""
    return psql_erp(f"BEGIN; SET LOCAL session_replication_role = replica; {sql}; COMMIT;")


def replica_sgb(sql):
    return psql_sgb(f"BEGIN; SET LOCAL session_replication_role = replica; {sql}; COMMIT;")


def mk_staff(tag, role="ADMIN"):
    """시험 운영자 — 소개뱅크 accounts · account_roles 에 만듦(ERP 는 svc 로 읽고 introspect 로 역할을 앎)"""
    stamp = int(time.time()) % 100000
    em = f"t{tag}e{stamp}@x.com"
    h = psql_sgb("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql_sgb(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{em}', '시험{tag}', '{h}', now()) ON CONFLICT DO NOTHING")
    aid = psql_sgb(f"SELECT id FROM accounts WHERE email = '{em}'")
    if role:
        psql_sgb(f"BEGIN; SELECT set_config('app.role_reason', '시험 {tag}', true); INSERT INTO account_roles (account_id, role) VALUES ('{aid}', '{role}') ON CONFLICT DO NOTHING; COMMIT;")
    return em, aid


def rm_role(aid, tag):
    psql_sgb(f"BEGIN; SELECT set_config('app.role_reason', '시험 {tag} 지움', true); DELETE FROM account_roles WHERE account_id = '{aid}' AND role <> 'MEMBER'; COMMIT;")


def setting(key, value, tag):
    """설정 바꾸기 — ERP 가 보는 값(erp_site_settings = erp_settings 먼저 · 없으면 소개뱅크 site_settings)과 같은 곳에"""
    v = 'NULL' if value is None else "'" + str(value).replace("'", "''") + "'"
    if psql_erp(f"SELECT count(*) FROM erp_settings WHERE key = '{key}'") == '1':
        return psql_erp(f"UPDATE erp_settings SET value = {v} WHERE key = '{key}'")
    return psql_sgb(f"BEGIN; SELECT set_config('app.setting_reason', '시험 {tag}', true); UPDATE site_settings SET value = {v} WHERE key = '{key}'; COMMIT;")


def getset(key):
    """ERP 가 보는 설정 값"""
    return psql_erp(f"SELECT coalesce(value, '') FROM erp_site_settings WHERE key = '{key}'")


def migr(prefix):
    """옛 소개뱅크 마이그레이션 읽기 — ERP 에는 없음(빈 글자 · 그 검사는 옮길 때 뺌)"""
    return ''


mig = migr

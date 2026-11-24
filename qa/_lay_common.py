"""v10.696 ~ 700 (D321 · docs/804 ~ 808) 꾸밀 페이지 시험 공통 — test_v1696 ~ 1700 이 씀(시험 파일이 아님 · 회귀가 돌리지 않음)"""
import time, json, os, re, subprocess, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb' if os.path.isdir(KIT + '/sgb') else KIT
API = os.environ.get('API'); DB = os.environ.get('DB'); SITE = os.environ.get('SITE')
PW = 'sgb-dev-1234'
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


def doc(prefix):
    d = os.path.join(K, 'docs')
    return next((open(os.path.join(d, x), encoding='utf-8').read() for x in (os.listdir(d) if os.path.isdir(d) else []) if x.startswith(prefix)), '')


def call(m_, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
    try:
        body = urllib.request.urlopen(r, timeout=120).read()
        return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code'), 'message': bd.get('message')}


def page(path):
    """사용자 웹 화면 글(HTML) · 상태 — 미리보기(?lp=)는 캐시 없이 읽힘"""
    try:
        r = urllib.request.urlopen(urllib.request.Request(SITE + path, headers={'User-Agent': 'sgb-qa'}), timeout=120)
        return r.status, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, ''
    except Exception as e:
        return 0, str(e)


def page_until(path, pred, wait=75):
    """사용자 웹은 관 점검 안내를 30초 캐시(stale-while-revalidate)로 읽음 — 바뀐 값이 보일 때까지 5초마다 다시 읽음(최대 wait 초)"""
    end = time.time() + wait
    while True:
        st, h = page(path)
        if (st == 200 and pred(h)) or time.time() > end:
            return st, h
        time.sleep(5)


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return (r.stdout.strip() + ('\n!' + r.stderr.strip() if r.returncode else '')).strip()


def up():
    """서버 · DB 가 응답할 때만 ② · ③(미리 검사는 닿지 않는 주소로 돎)"""
    if not (API and DB):
        return False
    try:
        urllib.request.urlopen(API + '/health', timeout=5)
    except Exception:
        return False
    return psql('SELECT 1') == '1'


def login(e):
    return call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')


def reset(key):
    """시험 뒤 처음 배치로(게시 판 기록은 쌓기만이라 그대로 · 초안 · 게시 · 예약 · 미리보기 비움)"""
    return psql(f"UPDATE site_layout_previews SET revoked_at = now() WHERE key = '{key}' AND revoked_at IS NULL; "
                f"UPDATE site_layouts SET draft = '{{}}'::jsonb, published = NULL, published_version = NULL, published_at = NULL, published_by = NULL, "
                f"scheduled_at = NULL, scheduled_by = NULL, scheduled_layout = NULL, editable = false WHERE key = '{key}';")


def put_draft(key, layout):
    """v10.701 (D322) 열린 관 · 수정 불가 페이지는 API 로 초안을 못 넣음 → 시험은 DB 로 초안을 넣고 미리보기 링크(API)로 화면을 봄"""
    return psql(f"UPDATE site_layouts SET draft = $j${json.dumps(layout, ensure_ascii=False)}$j$::jsonb WHERE key = '{key}';")


def done():
    passed = sum(1 for r in RES if r[0])
    print(f'\n결과: {passed} / {len(RES)}')
    raise SystemExit(0 if passed == len(RES) else 1)


VER = rd('VERSION').strip()
VT = tuple(int(x) for x in re.findall(r'\d+', VER))

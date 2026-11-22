"""회귀 시험 동시 실행 판정 (v10.569 · docs/711) — run_regression.sh 가 동시 실행 전에 부름

  python3 reg_classify.py [qa 폴더] [--core <kit 의 sgb>] [--write <목록.tsv>] [--why]
    · 시험 파일(test_v109* · v11* ~ v15*)을 파이썬 구문(ast)으로 읽어 방식을 정함 — 목록 한 줄 「파일<TAB>방식<TAB>까닭<TAB>잠금」
        SOLO  아무것과도 같이 돌지 않음(하나씩)
        UI    화면(playwright) 시험 — 처음은 SOLO 처럼 하나씩 · UI_LANE=1 이면 「ui」 잠금 한 줄로 동시
        LOCK  잠금 이름이 겹치지 않는 시험과만 동시(설정 키 앞마디 set:mall … · 정기 작업 job)
        PAR   아무와 동시
    · --core 의 prisma/migrations 에서 site_settings 키 목록을 읽어 시험 글자와 맞춤(못 읽으면 키 꼴 글자 모두)
    · reg_solo_force.txt(손 · 늘 SOLO) · reg_par_ok.txt(손 · 규칙에 걸려도 PAR) — 한 줄 한 파일 · # 주석

  공통 머리(test_v1558 docstring 다음 ~ migr 끝)의 「정의」 본문은 빼고 셈 — 정의는 빼도 「부르는 곳」은 셈.
  DB 규칙은 psql( ) 에 넘기는 글(이름으로 넘기면 그 이름에 넣은 글자)에만 · API 규칙은 call( ) 의 방법 · 주소에만 걸어
  코드 검사 줄('ALTER TABLE' in 마이그레이션 글 같은 것)은 세지 않음.

  까닭(점검판 DB 하나 · API 하나 · 사용자 웹 하나를 같이 씀):
    SET      설정을 바꿈 — setting( · setv( · sv( · site_settings · setting_schedules 쓰기 · PUT/PATCH/POST …settings 주소 → 키를 찾으면 LOCK(set:앞마디) · 못 찾으면 SOLO
             v10.638 (docs/782) 키는 psql 글 안(`key = 'i18n.enabled'` · `key IN ('a.b', …)` · f-string 고정 부분)에서도 찾음
    SETREAD  v10.638 설정 값을 읽어 확인 — psql 의 SELECT … FROM site_settings → 키가 있으면 같은 잠금(set:앞마디) · 키가 없으면 그대로(PAR)
    SETGLOBAL v10.638 설정을 바꾸는데 그 키가 모든 요청에 걸리는 것(권한 판정 · 운영자 2단계 · 로그인 잠금 · 점검 시간 · 가입 열기 · 나라 막기 …) → SOLO
             (11/22 test_v1119 가 SQL 글 안 i18n.enabled 를 바꿔 잠금이 없었고 test_v1104 와 부딪힘 · test_v1093 은 값만 확인해 PAR 이었음)
    JOB      정기 작업 · 묶음 셈 — POST /admin/jobs · member-notice-jobs · POST /admin/…/run · run_job( · SELECT fn_…(daily|hourly|build|close|watch|purge|run|digest) → LOCK(job)
    SHARED   같이 쓰는 시험 회원(admin · buyer · seller · intro · person · ops · payout · reviewer · member · bizowner …)의 계정 · 역할 · 동의 · 세션 · 2단계 · 권한을 바꿈 ·
             모든 기기 로그아웃 · 비밀번호 바꾸기 · 약관 넣기 · 게시(지금 판이 바뀌면 다른 시험이 동의 화면으로 감) → SOLO
    GLOBAL   TRUNCATE · ALTER TABLE · DROP · CREATE OR REPLACE · DISABLE TRIGGER → SOLO
    THROTTLE 틀린 비밀번호 로그인 · 잠김(TOO_MANY_ATTEMPTS · LOGIN_LOCKED) → SOLO
    ALERT    운영 알림 대기 목록(fn_ops_alert_*pending · push/slack 미리보기 · 50건) → SOLO
    DOCKER   docker · npm 을 부름 → SOLO
    UI       admin_page( · ui( · site_login( · sync_playwright → UI
    PARSE    구문을 못 읽음 → SOLO
"""
import ast, os, re, sys

HEADER_FUNCS = {'ok', 'rd', 'doc', 'call', 'psql', 'login', 'ui', 'site_login', 'jwt_life', 'login_full', 'mk_staff', 'rm_role',
                'admin_page', 'setting', 'getset', 'migr'}
SHARED_MAIL = r"(admin|buyer|seller|ops|payout|reviewer|member|bizowner|bizstaff|intro|person)@(x\.com|t\.local)"

# DB 에 보내는 글(psql 인자)에만 거는 규칙 — 코드 검사(마이그레이션 글자에 'ALTER TABLE' 이 있는지 보는 줄)는 세지 않음
SQL_RULES = [
    ('SET', re.compile(r"(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+(public\.)?(site_settings|setting_schedules)\b", re.I)),
    ('JOB', re.compile(r"SELECT\s+(\*\s+FROM\s+)?(public\.)?fn_[a-z0-9_]*(daily|hourly|build|close|watch|purge|run|digest)\w*\s*\(", re.I)),
    ('SHARED', re.compile(r"(UPDATE|DELETE\s+FROM)\s+(public\.)?(accounts|account_roles|account_consents|account_mfa|auth_sessions|refresh_tokens|terms_agreements|"
                          r"login_sessions|perm_account_groups|perm_account_overrides)\b.{0,400}" + SHARED_MAIL
                          + r"|INSERT\s+INTO\s+(public\.)?terms\s*\(|UPDATE\s+(public\.)?terms\s+SET", re.I | re.S)),
    ('GLOBAL', re.compile(r"\bTRUNCATE\b|ALTER\s+TABLE|\bDROP\s+(TABLE|FUNCTION|TRIGGER|VIEW|INDEX)|CREATE\s+OR\s+REPLACE|DISABLE\s+TRIGGER", re.I)),
    ('ALERT', re.compile(r"fn_ops_alert_\w*pending", re.I)),
]
# API 를 부르는 곳(call 의 방법 · 주소 · 본문)에 거는 규칙
CALL_RULES = [
    ('SET', re.compile(r"^(PUT|PATCH|POST) \S*(site-settings|settings\b)", re.I)),
    ('JOB', re.compile(r"^POST \S*(/admin/jobs|member-notice-jobs|/admin/\S*/run\b)", re.I)),   # v10.638 묶음 실행(/admin/…/run — 전표 · 은행 · 재주문 등)도 정기 작업 — 11/22 test_v1382 가 동시 단계에서 다른 시험의 journal/run 에 걸림
    ('SHARED', re.compile(r"^\w+ \S*(logout-all|/me/password|/admin/terms\S*/publish)", re.I)),
    ('THROTTLE', re.compile(r"^POST \S*/auth/login .*'password':\s*'(?!sgb-dev-1234|sgb-test-1234)", re.I)),
    ('ALERT', re.compile(r"^\w+ \S*/admin/ops-alerts/(push|slack)-preview", re.I)),
]
# 함수 이름으로 거는 규칙(부르는 곳만)
FUNC_RULES = {
    'setting': 'SET', 'setv': 'SET', 'sv': 'SET', 'set_setting': 'SET', 'run_job': 'JOB',
    'admin_page': 'UI', 'ui': 'UI', 'site_login': 'UI', 'sync_playwright': 'UI',
}
TEXT_RULES = [   # 글 전체(머리 정의 뺀)에 거는 규칙
    ('DOCKER', re.compile(r"\[\s*['\"](docker|npm|npx)['\"]|os\.system\(\s*f?['\"](docker|npm|npx)\b|['\"]docker\s+(compose|run|exec|restart)")),
    ('THROTTLE', re.compile(r"TOO_MANY_ATTEMPTS|LOGIN_LOCKED|auth_throttle")),
]


def _strs(node, names):
    """식 안의 글자 조각(f-string 은 고정 부분 · 이름은 그 이름에 넣은 글자) 모두"""
    out = []
    for n in ast.walk(node):
        if isinstance(n, ast.Constant) and isinstance(n.value, str):
            out.append(n.value)
        elif isinstance(n, ast.Name) and n.id in names:
            out.extend(names[n.id])
    return out


def _fname(call):
    f = call.func
    return f.id if isinstance(f, ast.Name) else f.attr if isinstance(f, ast.Attribute) else ''


KEY_RE = re.compile(r"^[a-z][a-z0-9_]*\.[a-z0-9_.]+$")
# v10.638 (docs/782) psql 글 안의 설정 키 — 설정 표를 다루는 글에서 따옴표 안 키 꼴 글자
SQL_KEY_RE = re.compile(r"'([a-z][a-z0-9_]*\.[a-z0-9_.]+)'")
SET_TABLE_RE = re.compile(r"\b(site_settings|setting_schedules)\b", re.I)
# v10.638 바꾸면 다른 시험의 로그인 · 권한 · 접속이 달라지는 키 — 이 키를 쓰는 SET 시험은 잠금이 아니라 혼자
GLOBAL_KEY_RE = re.compile(r"^(perm\.(mode|enforce|allow_widen|auto_role_group)|admin\.(ip_verify|mfa_required|passkey|passkey_mode)|auth\.login\.\w+|"
                           r"sec2\.(member_mfa|pwned_check)|security\.geo_(mode|block|allow)|signup\.open|site\.maintenance_(from|until))$")
SET_READ_RE = re.compile(r"\bSELECT\b.{0,300}?\bFROM\s+(public\.)?site_settings\b", re.I | re.S)


def analyze(src, known=frozenset()):
    """(까닭 집합, 설정 키 집합, 작업 이름 집합) — 파싱이 안 되면 None
    설정 키 = 시험 글(머리 정의 뺀)에 나오는 글자 중 site_settings 키 목록(known)에 있는 것 · known 이 비면 키 꼴인 글자 모두"""
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return None
    skip = set()
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name in HEADER_FUNCS:
            skip.update(id(x) for x in ast.walk(node))
    names = {}
    for n in ast.walk(tree):
        if isinstance(n, ast.Assign) and id(n) not in skip:
            vals = [c.value for c in ast.walk(n.value) if isinstance(c, ast.Constant) and isinstance(c.value, str)]
            for t in n.targets:
                if isinstance(t, ast.Name) and vals:
                    names.setdefault(t.id, []).extend(vals)
    why, jobs = set(), set()
    lits = {c.value for c in ast.walk(tree) if isinstance(c, ast.Constant) and isinstance(c.value, str) and id(c) not in skip}
    keys = {x for x in lits if KEY_RE.match(x) and (x in known if known else True)}
    for n in ast.walk(tree):
        if isinstance(n, ast.Dict) and id(n) not in skip:
            for k, v in zip(n.keys, n.values):
                if isinstance(k, ast.Constant) and k.value == 'job' and isinstance(v, ast.Constant) and isinstance(v.value, str):
                    jobs.add(v.value)
        if not isinstance(n, ast.Call) or id(n) in skip:
            continue
        fn = _fname(n)
        if fn in FUNC_RULES:
            why.add(FUNC_RULES[fn])
        if fn == 'psql' or (fn == 'run' and 'psql' in ' '.join(_strs(n, {}))):
            sql = ' '.join(_strs(n, names))
            why.update(k for k, rx in SQL_RULES if rx.search(sql))
            if SET_TABLE_RE.search(sql):   # v10.638 글 안 키 · 읽기 확인
                keys.update(x for x in SQL_KEY_RE.findall(sql) if KEY_RE.match(x) and (x in known if known else True))
                if SET_READ_RE.search(sql):
                    why.add('SETREAD')
        elif fn == 'call' and n.args:
            parts = _strs(n.args[0], {}) if isinstance(n.args[0], (ast.Constant, ast.JoinedStr)) else []
            m = parts[0] if parts else ''
            path = ''.join(_strs(n.args[1], {})) if len(n.args) > 1 else ''
            seg = ast.get_source_segment(src, n) or ''
            line = f"{m} {path} {seg}"
            why.update(k for k, rx in CALL_RULES if rx.search(line))
    body = '\n'.join(l for i, l in enumerate(src.splitlines()) if not any(
        isinstance(x, ast.FunctionDef) and x.name in HEADER_FUNCS and x.lineno - 1 <= i < getattr(x, 'end_lineno', x.lineno) for x in tree.body))
    why.update(k for k, rx in TEXT_RULES if rx.search(body))
    return why, keys, jobs


def known_keys(core):
    """core(kit 의 sgb 또는 sgb-core) prisma/migrations 에서 site_settings 에 넣는 키 — 못 읽으면 빈 집합"""
    d = os.path.join(core or '', 'prisma', 'migrations')
    out = set()
    if not os.path.isdir(d):
        return frozenset()
    for m in os.listdir(d):
        f = os.path.join(d, m, 'migration.sql')
        if not os.path.exists(f):
            continue
        t = open(f, encoding='utf-8', errors='replace').read()
        if 'site_settings' not in t:
            continue
        out.update(re.findall(r"\(\s*'([a-z][a-z0-9_]*\.[a-z0-9_.]+)'\s*,", t))
    return frozenset(out)


# v10.635 (docs/779) 먼 해(2050 ~ 2999)를 고정으로 쓰는 시험 — 같은 해를 쓰는 시험끼리 동시에 돌지 않게 잠금 year:NNNN
#   (11/22 test_v1420 · test_v1421 이 2096 급여를 만들고 그 해를 통째로 지우다 동시에 돌아 실패)
YEAR_RE = re.compile(r"\b(?:YR|YEAR|yr|year)\s*=\s*(20[5-9]\d|2[1-9]\d\d)\b|['\"](20[5-9]\d|2[1-9]\d\d)-(?:0[1-9]|1[0-2])")


def fixed_years(src):
    return sorted({a or b for a, b in YEAR_RE.findall(src)})


# v10.635 (docs/779) 회귀 대상 — 판 번호 1090 이상 모든 test_v<번호>*.py(이름 규칙 1[1-5] 로 v16xx 26개가 빠졌던 것 · 번호로 셈 · v2xxx 도)
TEST_RE = re.compile(r'^test_v(\d{4,})\S*\.py$')


def is_reg_test(name):
    m = TEST_RE.match(name)
    return bool(m) and int(m.group(1)) >= 1090


STRICT = {'GLOBAL', 'SHARED', 'THROTTLE', 'ALERT', 'DOCKER', 'PARSE', 'FORCE'}


def mode_of(why, keys, jobs, ui_lane=False):
    """SOLO = 아무것과도 같이 돌지 않음 · UI = 화면 시험(처음 SOLO 처럼 · UI_LANE=1 이면 한 줄로 따로) · LOCK = 잠금 이름이 겹치지 않는 시험과만 동시 · PAR = 아무와 동시
    잠금: 설정 키 앞마디(set:mall) · 정기 작업은 모두 한 잠금(job) — 설정을 바꾸는데 키를 못 찾았으면 SOLO"""
    w = set(why)
    locks = set()
    if w & STRICT:
        return 'SOLO', locks
    if 'SET' in w:
        if not keys:
            return 'SOLO', locks
        if any(GLOBAL_KEY_RE.match(k) for k in keys):   # v10.638 모든 요청에 걸리는 키
            return 'SOLO', locks
        locks.update('set:' + k.split('.')[0] for k in keys)
    if 'SETREAD' in w and keys:   # v10.638 값을 확인하는 시험도 같은 잠금 — 키가 없으면 잠그지 않음
        locks.update('set:' + k.split('.')[0] for k in keys)
    if 'JOB' in w:
        locks.add('job')
    if 'UI' in w:
        return 'UI', locks
    return ('LOCK' if locks else 'PAR'), locks


def read_list(path):
    if not os.path.exists(path):
        return set()
    return {l.split('#')[0].split('\t')[0].strip() for l in open(path, encoding='utf-8') if l.split('#')[0].strip()}


def classify(qdir, core=None):
    force, par_ok = read_list(os.path.join(qdir, 'reg_solo_force.txt')), read_list(os.path.join(qdir, 'reg_par_ok.txt'))
    known = known_keys(core)
    out = []
    for f in sorted(x for x in os.listdir(qdir) if is_reg_test(x)):
        src = open(os.path.join(qdir, f), encoding='utf-8', errors='replace').read()
        got = analyze(src, known)
        why, keys, jobs = (['PARSE'], set(), set()) if got is None else (sorted(got[0]), got[1], got[2])
        if f in force:
            why = ['FORCE'] + why
        elif f in par_ok and why:
            why = []
        mode, locks = mode_of(why, keys, jobs)
        if 'SET' in why and 'FORCE' not in why and any(GLOBAL_KEY_RE.match(k) for k in keys):
            why = why + ['SETGLOBAL']   # v10.638 판정 까닭에 보임
        yrs = fixed_years(src) if got is not None else []
        if yrs and mode in ('PAR', 'LOCK', 'UI'):   # v10.635 같은 먼 해를 쓰는 시험끼리 잠금
            locks = set(locks) | {f'year:{y}' for y in yrs}
            why = why + ['YEAR']
            if mode == 'PAR':
                mode = 'LOCK'
        out.append((f, why, mode, sorted(locks)))
    return out


def main(argv):
    args = [a for a in argv[1:] if not a.startswith('--')]
    opt = lambda k: argv[argv.index(k) + 1] if k in argv else None
    qdir = args[0] if args else os.path.dirname(os.path.abspath(__file__))
    rows = classify(qdir, opt('--core'))
    if opt('--write'):
        with open(opt('--write'), 'w', encoding='utf-8') as fh:
            fh.write('# 회귀 시험 동시 실행 판정 — reg_classify.py 가 만듦(손으로 고치지 말고 reg_solo_force.txt · reg_par_ok.txt 에)\n')
            fh.write('# 칸: 파일<TAB>방식(SOLO 혼자 · UI 화면(처음 혼자) · LOCK 잠금 겹치지 않으면 동시 · PAR 동시)<TAB>까닭<TAB>잠금\n')
            fh.write('# ' + summary(rows) + '\n')
            for f, w, m, l in rows:
                fh.write(f'{f}\t{m}\t{",".join(w) or "-"}\t{",".join(l) or "-"}\n')
    if '--why' in argv:
        for f, w, m, l in rows:
            print(f'{f}\t{m}\t{",".join(w) or "-"}\t{",".join(l) or "-"}')
    print(summary(rows))
    return 0


def summary(rows):
    by = {}
    for _, _, m, _ in rows:
        by[m] = by.get(m, 0) + 1
    why = {}
    for _, w, _, _ in rows:
        for x in w:
            why[x] = why.get(x, 0) + 1
    return (f'회귀 판정 — 전체 {len(rows)} · ' + ' · '.join(f'{k} {by.get(k, 0)}' for k in ('SOLO', 'UI', 'LOCK', 'PAR'))
            + ' · 까닭별 ' + ' · '.join(f'{k} {v}' for k, v in sorted(why.items())))


if __name__ == '__main__':
    sys.exit(main(sys.argv))

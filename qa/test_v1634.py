"""v10.634 (docs/778) 사용자 설명서 3만 자 · AI 상담은 2만 자까지 맞는 절부터
  ① (코드) HELP_MAX_CHARS 30000 · HELP_AI_MAX_CHARS 20000 · manualBlock · manualScore · 다 들어가면 묶음에 · 넘으면 질문마다 · D307 검사 3만 · 문서 778 · 판
  ② (API · DB) DB 검사 help_docs_body_len 설명서 3만 · 운영 화면 도움말 4만 · 읽기 maxChars 30000 · 3만 1자 → 422 HELP_TOO_LONG(저장 안 됨)
  (저장되지 않는 요청만 — 두 번 돌아도 통과)
"""
import json, os, re, sys, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb' if os.path.isdir(KIT + '/sgb') else KIT
API = os.environ.get('API') or ''
DB = os.environ.get('DB') or ''
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
HS = rd('src/modules/help/help.service.ts'); AC = rd('src/modules/agent/agent-chat.service.ts')
MP = rd('src/modules/agent/manual-pick.ts')   # v10.637 절 고르기를 따로 떼어 냄
MIG = rd('prisma/migrations/D307_job_fail_streak_perm_compare_daily/migration.sql')

# ── ① 코드 ─────────────────────────────────────────────
ok('① help.service — HELP_MAX_CHARS 30000 · HELP_AI_MAX_CHARS 20000',
   'export const HELP_MAX_CHARS = 30000;' in HS and 'export const HELP_AI_MAX_CHARS = 20000;' in HS)
ok('① AI — MANUAL_MAX = HELP_AI_MAX_CHARS · manualBlock(다 들어가면 모두 · 넘으면 점수 순 · 원래 순서) · 묶음에는 다 들어갈 때만 · 질문마다 고름',
   'const MANUAL_MAX = HELP_AI_MAX_CHARS;' in AC and 'export function manualBlock(' in (AC + MP) and 'export function manualScore(' in (AC + MP)
   and 'if (all.length <= max) return { text: all, picked: secs.length, all: true' in (AC + MP) and 'if (mb.all) text +=' in AC
   and 'kn0.text === kn0.base' in AC and ('secs.filter((_, i) => keep.has(i))' in (AC + MP)) and "'…(이하 생략)'" not in AC.split('const [man]')[1])
ok('① D307 — help_docs_body_len 설명서 3만 · 도움말 4만 · 이미 3만이면 건너뜀',
   "THEN 40000 ELSE 30000 END" in MIG and "NOT LIKE '%30000%'" in MIG)
d778 = doc('778_')
ok('① 문서 778 — 3만 자 · 2만 자 · 맞는 절 · 18,829', all(w in d778 for w in ('3만 자', '2만 자', '맞는 절', '18,829')), str(len(d778)))
ok('① VERSION v10.634 이상', VT >= (10, 634), VER)

# ── ② API ─────────────────────────────────────────────
def call(m_, p, b=None, t=None, raw=None):
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    data = raw if raw is not None else (json.dumps(b, ensure_ascii=False).encode('utf-8') if b is not None else None)
    r = urllib.request.Request(API + p, data=data, headers=hd, method=m_)
    try:
        body = urllib.request.urlopen(r, timeout=120).read()
        return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code'), 'details': bd.get('details')}


try:
    alive = bool(API) and urllib.request.urlopen(API + '/health', timeout=10).status == 200
except Exception:
    alive = False

import subprocess
def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return (r.stdout.strip() + ('\n!' + r.stderr.strip() if r.returncode else '')).strip()


if alive:
    if DB:
        cd = psql("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.help_docs'::regclass AND conname = 'help_docs_body_len'")
        ok('② DB 검사 — 설명서 30000 · 도움말 40000', '30000' in cd and '40000' in cd, cd[:160])
    __import__('consent_ok').agree_seed()
    __import__('consent_ok').agree('admin@x.com', PW)
    tok = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
    ok('② SUPER 로그인', bool(tok))
    if tok:
        m0 = call('GET', '/admin/help/manual', None, tok)
        orig = (m0.get('current') or {}).get('body') or ''
        s1 = call('POST', '/admin/help/manual', {'body': orig + '\n' + 'a' * max(1, 30001 - len(orig))}, tok)
        m1 = call('GET', '/admin/help/manual', None, tok)
        ok('② 읽기 maxChars 30000 · 3만 1자 → 422 HELP_TOO_LONG · 판 그대로',
           m0.get('maxChars') == 30000 and s1.get('_err') == 422 and s1.get('code') == 'HELP_TOO_LONG'
           and (m1.get('current') or {}).get('version') == (m0.get('current') or {}).get('version'),
           f"{m0.get('maxChars')} {json.dumps(s1, ensure_ascii=False)[:120]}")
else:
    print('  (API 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)

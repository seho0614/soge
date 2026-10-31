"""v10.158 시험 — 「관리자 페이지」 단추 주소(BO_URL) 확인(docs/240)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e SITE=http://localhost:15174 sgb-qa:v1 python3 test_v1158.py

  ① 코드 — 사용자 웹 /go/admin(운영에서 BO_URL 없으면 503) · precheck · postcheck 의 BO_URL 줄 · 설정 예시 · docs/240 · 판 · 마이그레이션 없음
  ② precheck · postcheck 의 판단(case)을 떼어 가짜 값으로 돌림 — 운영 주소 통과 · localhost · http · 빈 값 · 503
  ③ (점검판) /go/admin 은 그대로 302(개발 BO_URL)
"""
import os, re, subprocess, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
SITE = os.environ.get('SITE')
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
RT = rd('site/src/app/go/admin/route.ts'); PRE = rd('deploy/aws/precheck.sh'); POST = rd('deploy/aws/postcheck.sh'); EX = rd('deploy/aws/env.production.example')
ok('① /go/admin — 운영에서 BO_URL 없으면 503(localhost 로 안 보냄) · 개발은 그대로',
   "process.env.NODE_ENV === 'production'" in RT and 'status: 503' in RT and "redirect(set || 'http://localhost:5173', 302)" in RT, '')
ok('① precheck [4] · postcheck [4] — BO_URL 줄 · 설정 예시 「운영 꼭」',
   'BO_URL' in PRE and '.env 에 BO_URL 이 없음' in PRE and '$SITE/go/admin' in POST and 'pm2 restart sgb-site' in POST and '운영 꼭' in EX, '')
mig = [x for x in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', x))]
D240 = next((rd('docs/' + f) for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('240_')), '')
ok('① docs/240 · 판 v10.158 이상 · 마이그레이션 없음(188)', all(x in D240 for x in ('BO_URL', 'postcheck', 'precheck', '503', '하지 말 것'))
   and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 158) and len(mig) >= 188, f"{rd('VERSION').strip()} · {len(mig)}")


# ── ② 판단 줄을 떼어 돌림 ─────────────────────────────────────────────
def block(src, start):
    """start 줄이 든 case … esac 한 덩어리"""
    i = src.find(start)
    if i < 0: return ''
    j = src.rfind('\n', 0, src.rfind('case ', 0, i + len(start) + 200)) + 1
    k = src.find('esac', i) + 4
    return src[j:k]


pre_case = block(PRE, '.env BO_URL')
post_case = block(POST, '「관리자 페이지」 단추')
stub = 'ok(){ echo "ok"; }; bad(){ echo "bad"; }; warn(){ echo "warn"; };\n'


def run(code, **env):
    r = subprocess.run(['bash', '-c', stub + code], capture_output=True, text=True, env={**os.environ, **env})
    return r.stdout.strip() or r.stderr.strip()[:80]


got_pre = {v: run(pre_case, bo=v) for v in ('https://admin.sogaebank.com', 'http://localhost:5173', '', 'https://127.0.0.1:5173')}
ok('② precheck — 운영 주소 통과 · localhost · http · 빈 값 「확인」', pre_case and got_pre == {'https://admin.sogaebank.com': 'ok', 'http://localhost:5173': 'warn', '': 'warn', 'https://127.0.0.1:5173': 'warn'}, str(got_pre))
cases = {('302', 'https://admin.sogaebank.com/'): 'ok', ('302', 'http://localhost:5173/'): 'bad', ('302', 'https://localhost:5173'): 'bad', ('503', ''): 'bad', ('000', ''): 'bad'}
got_post = {f'{c}|{u}': run(post_case, gc=c, gl=u) for c, u in cases}
ok('② postcheck — 302 운영 주소 통과 · localhost · http · 503 · 응답 없음 「실패」', post_case and list(got_post.values()) == list(cases.values()), str(got_post))

# ── ③ 점검판 ─────────────────────────────────────────────────────────
if SITE:
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k): return None
    try:
        r = urllib.request.build_opener(NoRedirect).open(SITE + '/go/admin', timeout=30); code, loc = r.status, r.headers.get('location')
    except urllib.error.HTTPError as e:
        code, loc = e.code, e.headers.get('location')
    ok('③ 점검판 /go/admin → 302(개발 BO_URL · 점검판은 production 이 아니거나 BO_URL 이 있음)', code in (302, 307) and bool(loc), f'{code} {loc}')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)

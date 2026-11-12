"""v10.244 (D202 · docs/383) — API 가 뜰 때 운영 적용 기록 · 되돌림 · postcheck 결과 파일 — **docker 를 부르므로 서버에서 직접**

  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb python3 test_v1244_boot.py

  점검판 API 컨테이너 안에 두 번째 API(127.0.0.1:3997 · DATA_DIR=/tmp/sgb1244)를 띄워 봅니다.
  ① 시험 줄 'v99.0' 을 넣고 띄움 → 「되돌림(BACK) · 앞 판 v99.0 · 지금 판」 한 줄 · 서버 이름
  ② 그 API 의 releases — 가장 최근 postcheck 결과 파일(이름 형식이 맞는 것 중 가장 늦은 것)의 판 · 통과 · 실패 · 확인 · 같음 · 바뀜 · 시각
  ③ 하루 요약 「운영 판 … · 마지막 바뀜 …(되돌림 · 앞 판 v99.0)」
  ④ 같은 판으로 다시 띄우면 줄을 더하지 않음(pm2 restart · 재부팅과 같음)
  밖으로는 아무것도 나가지 않습니다. 끝나면 두 번째 API 를 끄고 시험 폴더를 지웁니다(기록 줄은 지울 수 없음 — 마지막 줄이 지금 판이 되게 둠).
"""
import json, os, re, subprocess, time, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
C = os.environ.get('API_CONTAINER') or 'sgb-api'
RES = []
PW = 'sgb-dev-1234'
DD = '/tmp/sgb1244'
VER = (open(os.path.join(K, 'VERSION'), encoding='utf-8').read().strip() if os.path.exists(os.path.join(K, 'VERSION')) else '?')


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def call(m, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m in ('POST', 'PUT', 'PATCH') else None), headers=hd, method=m)
    try:
        raw = urllib.request.urlopen(r, timeout=60).read()
        return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        return {'_err': e.code}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return r.stdout.strip() if not r.returncode else ('!' + r.stderr.strip()[:200])


FETCH = ("const [m,u,b,t]=process.argv.slice(1);const h={'content-type':'application/json'};if(t)h.Authorization='Bearer '+t;"
         "fetch(u,{method:m,headers:h,body:b||undefined}).then(async r=>console.log(JSON.stringify({s:r.status,b:await r.text()})))"
         ".catch(e=>console.log(JSON.stringify({s:0,b:String(e)})))")


def inside(m, url, b=None, t=None):
    r = subprocess.run(['docker', 'exec', C, 'node', '-e', FETCH, m, url, json.dumps(b) if b is not None else '', t or ''], capture_output=True, text=True, timeout=120)
    try:
        o = json.loads((r.stdout.strip().splitlines() or ['{}'])[-1])
        body = json.loads(o.get('b') or '{}')
    except Exception:
        return {'_err': 0}
    if o.get('s', 0) >= 400 or o.get('s') == 0:
        return {'_err': o.get('s')}
    return body


call2 = lambda m, p, t=None: inside(m, 'http://127.0.0.1:3997/api/v1' + p, None, t)
PC_NEW = ('소개뱅크 AWS 적용 후 확인 (2026-11-12 12:00:00 UTC) — v10.246\n앱 폴더: /home/ubuntu/sgb → /home/ubuntu/sgb-releases/v10.246_x\n\n'
          '[11] 적용 전과 비교 (precheck 숫자 ↔ 지금 · 보여 주기만)\n        precheck 20261112 115000(v10.243) 와 비교 — 같음 12개 · 바뀜 1개\n\n'
          '적용 후 확인 — 통과 55 · 실패 0 · 확인 4\n')
PC_OLD = '소개뱅크 AWS 적용 후 확인 (2026-11-11 09:00:00 UTC) — v10.243\n\n적용 후 확인 — 통과 50 · 실패 2 · 확인 3\n'


def boot(tag):
    subprocess.run(['docker', 'exec', '-d', C, 'sh', '-c', f'cd /app && PORT=3997 DATA_DIR={DD} node scripts/dev-server.js > /tmp/api_1244_{tag}.log 2>&1 & echo $! > /tmp/api_1244.pid'], check=True)
    t1 = time.time(); h = {}
    while time.time() - t1 < 240:
        h = inside('GET', 'http://127.0.0.1:3997/api/v1/health')
        if h.get('_err') is None: break
        time.sleep(4)
    if h.get('_err') is not None:
        print(subprocess.run(['docker', 'exec', C, 'tail', '-15', f'/tmp/api_1244_{tag}.log'], capture_output=True, text=True).stdout)
    time.sleep(3)   # onApplicationBootstrap 기록이 끝나도록
    return h.get('_err') is None, int(time.time() - t1)


def stop():
    subprocess.run(['docker', 'exec', C, 'sh', '-c', '[ -f /tmp/api_1244.pid ] && kill $(cat /tmp/api_1244.pid) 2>/dev/null; rm -f /tmp/api_1244.pid'], capture_output=True)
    subprocess.run(['docker', 'exec', C, 'sh', '-c', "for d in /proc/[0-9]*; do grep -qa 'DATA_DIR=/tmp/sgb124[4]' $d/environ 2>/dev/null && kill ${d#/proc/} 2>/dev/null; done; true"], capture_output=True)
    for _ in range(20):
        if inside('GET', 'http://127.0.0.1:3997/api/v1/health').get('_err') is not None: return
        time.sleep(2)


up = subprocess.run(['docker', 'inspect', '-f', '{{.State.Running}}', C], capture_output=True, text=True).stdout.strip() == 'true'
ok('전제 — 점검판 API 컨테이너가 떠 있음 · 판 파일', up and VER != '?', f'{C} · {VER}')
if up:
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
    t0 = psql("SELECT now()")
    try:
        subprocess.run(['docker', 'exec', C, 'sh', '-c', f'rm -rf {DD} && mkdir -p {DD}/logs'], check=True)
        for name, body in (('postcheck_20261112_120000.txt', PC_NEW), ('postcheck_20261111_090000.txt', PC_OLD),
                           ('postcheck_x.txt', '적용 후 확인 — 통과 1 · 실패 9 · 확인 9\n'), ('precheck_state.txt', 'x\n')):
            subprocess.run(['docker', 'exec', '-i', C, 'sh', '-c', f'cat > {DD}/logs/{name}'], input=body, text=True, check=True)
        seed = psql("INSERT INTO ops_release_log (version, prev_version, kind, host) VALUES ('v99.0', NULL, 'OTHER', 't1244') RETURNING id")

        # ── ① 뜰 때 되돌림 기록 ──
        ready, sec = boot('a')
        ok('① 준비 — 두 번째 API(DATA_DIR=/tmp/sgb1244) 뜸', ready and seed.isdigit(), f'{sec}초 · 시험 줄 {seed}')
        got = psql(f"SELECT version || '|' || coalesce(prev_version, '') || '|' || kind || '|' || (host IS NOT NULL AND host <> '') FROM ops_release_log WHERE booted_at >= '{t0}' ORDER BY id")
        lines = got.splitlines()
        ok('① 뜰 때 — 가장 최근 줄(v99.0)과 판이 달라 한 줄: 지금 판 · 앞 판 v99.0 · 되돌림(BACK) · 서버 이름',
           len(lines) == 2 and lines[0].startswith('v99.0|') and lines[1] == f'{VER}|v99.0|BACK|true', got)

        # ── ② postcheck 결과 파일 ──
        rl = call2('GET', '/admin/launch-watch/releases', T_)
        pc = rl.get('postcheck') or {}
        ok('② postcheck — 이름 형식이 맞는 것 중 가장 늦은 파일 · 판 · 통과 55 · 실패 0 · 확인 4 · 같음 12 · 바뀜 1 · 시각',
           pc.get('file') == 'postcheck_20261112_120000.txt' and pc.get('version') == 'v10.246' and (pc.get('pass'), pc.get('fail'), pc.get('warn')) == (55, 0, 4)
           and (pc.get('same'), pc.get('changed')) == (12, 1) and pc.get('at') == '2026-11-12 12:00:00' and isinstance(pc.get('ageHours'), int), json.dumps(pc, ensure_ascii=False)[:200])
        r0 = (rl.get('rows') or [{}])[0]
        ok('② releases — 맨 위 줄이 방금 되돌림 · 지금 판', r0.get('kind') == 'BACK' and r0.get('prev') == 'v99.0' and r0.get('version') == VER
           and (rl.get('now') or {}).get('version') == VER, json.dumps(r0, ensure_ascii=False)[:160])

        # ── ③ 하루 요약 ──
        dg = call2('GET', '/admin/launch-watch/digest', T_).get('text') or ''
        vl = next((l for l in dg.splitlines() if l.startswith('운영 판 ')), '')
        ok('③ 하루 요약 「운영 판 … · 마지막 바뀜 …(되돌림 · 앞 판 v99.0)」', vl.startswith(f'운영 판 {VER} · 마지막 바뀜 ') and vl.endswith('(되돌림 · 앞 판 v99.0)'), vl)

        # ── ④ 같은 판으로 다시 띄움 ──
        stop()
        n1 = psql(f"SELECT count(*) FROM ops_release_log WHERE booted_at >= '{t0}'")
        ready2, sec2 = boot('b')
        n2 = psql(f"SELECT count(*) FROM ops_release_log WHERE booted_at >= '{t0}'")
        ok('④ 같은 판으로 다시 띄우면 줄을 더하지 않음', ready2 and n1 == n2 == '2', f'{sec2}초 · {n1} → {n2}')
    finally:
        stop()
        subprocess.run(['docker', 'exec', C, 'sh', '-c', f'rm -rf {DD}'], capture_output=True)
        last = psql("SELECT version FROM ops_release_log ORDER BY id DESC LIMIT 1")
        if last != VER and VER != '?':   # 두 번째 API 가 못 떴으면 마지막 줄이 시험 줄로 남음 — 지금 판 줄을 더해 둠
            psql(f"INSERT INTO ops_release_log (version, prev_version, kind, host) VALUES ('{VER}', '{last}', 'BACK', 't1244-restore')")

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)

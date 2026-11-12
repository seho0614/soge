"""v10.247 (docs/386) — 적용 결과 파일 보기 — **docker 를 부르므로 서버에서 직접**

  KIT=<kit> API=http://localhost:13000/api/v1 python3 test_v1247_files.py

  점검판 API 컨테이너의 결과 파일 폴더(DATA_DIR(기본 ~/sgb-data)/logs)에 시험 파일을 잠깐 넣고 봅니다.
  ① 목록 — 이름 형식이 맞는 것만 · 최근 10개 · 파일 이름 날짜 · 시각 순 · 종류 · 크기 · 빌드 기록 · precheck_state · 형식 틀린 이름은 빠짐
  ② 본문 — 글자 그대로 · 250KB 파일은 앞 200KB 만(truncated) · 다른 곳을 가리키는 링크는 열지 않음(OPS_FILE_MISSING) · ADMIN 403
  ③ 「지금 판」 카드의 postcheck 요약도 같은 폴더의 가장 최근 postcheck 파일
  밖으로는 아무것도 나가지 않습니다. 끝나면 넣은 파일만 지웁니다(다른 시험은 「결과 파일 없음」을 기대).
"""
import json, os, subprocess, urllib.error, urllib.parse, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
C = os.environ.get('API_CONTAINER') or 'sgb-api'
RES = []
PW = 'sgb-dev-1234'
RPW = 'sgb-test-1234'


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
        try:
            body = json.loads(e.read() or b'{}')
        except Exception:
            body = {}
        return {'_err': e.code, 'code': body.get('code')}


def sh(cmd, inp=None):
    return subprocess.run(['docker', 'exec', '-i', C, 'sh', '-c', cmd], input=inp, capture_output=True, text=True)


PC = ('소개뱅크 AWS 적용 후 확인 (2026-11-12 10:10:00 UTC) — v10.249\n\n'
      '[11] 적용 전과 비교\n        precheck 20261112 100000(v10.240) 와 비교 — 같음 12개 · 바뀜 1개\n\n적용 후 확인 — 통과 55 · 실패 0 · 확인 4\n')
FILES = {
    'precheck_20261112_100000.txt': '적용 전 점검 — 시험 1247 precheck\n',
    'apply_20261112_100500.txt': '적용 — 시험 1247 apply 한 줄\n둘째 줄 「따옴표」 · 기호 <>&\n',
    'postcheck_20261112_101000.txt': PC,
    'cleanup_20261111_090000.txt': '정리 — 시험 1247\n',
    'open-prep_20261110_080000.txt': '오픈 준비 — 시험 1247\n',
    'precheck_20261101_000000.txt': 'a\n', 'precheck_20261102_000000.txt': 'b\n', 'precheck_20261103_000000.txt': 'c\n',
    'precheck_20261104_000000.txt': 'd\n', 'precheck_20261105_000000.txt': 'e\n', 'precheck_20261106_000000.txt': 'f\n',
    'apply_20261112_100500_build.log': '빌드 기록\n', 'precheck_state.txt': '# x\n', 'postcheck_x.txt': '적용 후 확인 — 통과 1 · 실패 9 · 확인 9\n',
}
BIG = 'cleanup_20261112_110000.txt'
LINK = 'precheck_20261112_120000.txt'
OURS = list(FILES) + [BIG, LINK]

up = subprocess.run(['docker', 'inspect', '-f', '{{.State.Running}}', C], capture_output=True, text=True).stdout.strip() == 'true'
LOGS = sh('echo "${DATA_DIR:-$HOME/sgb-data}/logs"').stdout.strip() if up else ''
ok('전제 — 점검판 API 컨테이너 · 결과 파일 폴더', up and LOGS.endswith('/logs'), f'{C} · {LOGS}')
if up and LOGS:
    TS = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
    TA = call('POST', '/auth/login', {'email': 'ops@t.local', 'password': RPW}).get('accessToken')
    before = sh(f'ls -1 "{LOGS}" 2>/dev/null').stdout.split()
    try:
        sh(f'mkdir -p "{LOGS}"')
        for n, body in FILES.items():
            sh(f'cat > "{LOGS}/{n}"', body)
        sh(f'cat > "{LOGS}/{BIG}"', ''.join('%099d\n' % i for i in range(2560)))
        sh(f'ln -sf /etc/hostname "{LOGS}/{LINK}"')

        # ── ① 목록 ──
        fl = call('GET', '/admin/launch-watch/releases/files', None, TS)
        names = [f.get('name') for f in fl.get('files') or []]
        want = [LINK, BIG, 'postcheck_20261112_101000.txt', 'apply_20261112_100500.txt', 'precheck_20261112_100000.txt',
                'cleanup_20261111_090000.txt', 'open-prep_20261110_080000.txt', 'precheck_20261106_000000.txt', 'precheck_20261105_000000.txt', 'precheck_20261104_000000.txt']
        f0 = (fl.get('files') or [{}])
        ap = next((f for f in f0 if f.get('name') == 'apply_20261112_100500.txt'), {})
        ok('① 목록 — 최근 10개 · 이름 날짜 · 시각 순 · 빌드 기록 · precheck_state · 형식 틀린 이름 빠짐 · 종류 · 시각 · 크기',
           names == want and ap.get('kind') == 'apply' and ap.get('at') == '2026-11-12 10:05:00' and ap.get('size') == len(FILES['apply_20261112_100500.txt'].encode())
           and fl.get('dir') == LOGS, f"{names} · {ap}")

        # ── ② 본문 ──
        f1 = call('GET', '/admin/launch-watch/releases/file?name=apply_20261112_100500.txt', None, TS)
        ok('② 본문 — 글자 그대로(한글 · 기호) · 크기 · 자르지 않음', f1.get('text') == FILES['apply_20261112_100500.txt'] and f1.get('truncated') is False
           and f1.get('size') == ap.get('size'), json.dumps(f1, ensure_ascii=False)[:160])
        fbig = call('GET', '/admin/launch-watch/releases/file?name=' + BIG, None, TS)
        ok('② 256KB 파일 — 앞 200,000 바이트만 · truncated · 전체 크기', fbig.get('truncated') is True and fbig.get('size') == 256000
           and len((fbig.get('text') or '').encode()) == 200000 and (fbig.get('text') or '').startswith('0' * 99 + '\n'), f"{fbig.get('size')} · {len((fbig.get('text') or '').encode())}")
        fl_ = call('GET', '/admin/launch-watch/releases/file?name=' + LINK, None, TS)
        fa = call('GET', '/admin/launch-watch/releases/file?name=apply_20261112_100500.txt', None, TA)
        fs = call('GET', '/admin/launch-watch/releases/file?name=' + urllib.parse.quote('precheck_state.txt'), None, TS)
        ok('② 링크(다른 파일을 가리킴)는 열지 않음 OPS_FILE_MISSING · ADMIN 403 · precheck_state 422 OPS_FILE_NAME',
           fl_.get('_err') == 422 and fl_.get('code') == 'OPS_FILE_MISSING' and fa.get('_err') == 403 and fs.get('_err') == 422 and fs.get('code') == 'OPS_FILE_NAME',
           f"{fl_.get('_err')} {fl_.get('code')} · {fa.get('_err')} · {fs.get('_err')} {fs.get('code')}")

        # ── ③ 지금 판 카드 postcheck 요약 ──
        pc = call('GET', '/admin/launch-watch/releases', None, TS).get('postcheck') or {}
        ok('③ 지금 판 카드 — 같은 폴더의 가장 최근 postcheck(55 · 0 · 4 · 같음 12 · 바뀜 1 · v10.249)',
           pc.get('file') == 'postcheck_20261112_101000.txt' and (pc.get('pass'), pc.get('fail'), pc.get('warn'), pc.get('same'), pc.get('changed')) == (55, 0, 4, 12, 1)
           and pc.get('version') == 'v10.249', json.dumps(pc, ensure_ascii=False)[:160])
    finally:
        for n in OURS:
            if n not in before: sh(f'rm -f "{LOGS}/{n}"')
        left = [n for n in sh(f'ls -1 "{LOGS}" 2>/dev/null').stdout.split() if n in OURS and n not in before]
        print(f'  정리 — 넣은 파일 남은 것 {left}')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)

"""v10.251 (docs/387) — 적용 전 점검(precheck) 요약 — **docker 를 부르므로 서버에서 직접**

  KIT=<kit> API=http://localhost:13000/api/v1 python3 test_v1250_files.py

  점검판 API 컨테이너의 결과 파일 폴더(DATA_DIR(기본 ~/sgb-data)/logs)에 precheck 결과 파일을 잠깐 넣고 「지금 판」 releases.precheck 를 봅니다.
  ① 정상 — 가장 최근 파일(이름 날짜 · 시각) · 올릴 판 · 통과 · 실패 · 확인 · 적용됨 · 새 킷 · 올릴 것(이름 여러 줄) · 바뀐 파일 · 오픈 차단 · 약관 게시 · 초안
  ② 되돌린 상태 · 실패가 있는 파일이 더 늦으면 그것을 읽음(rolledBack true · fail) · 숫자 줄이 없는 파일은 null
  ③ precheck_state.txt · 형식 틀린 이름은 읽지 않음
  밖으로는 아무것도 나가지 않습니다. 끝나면 넣은 파일만 지웁니다.
"""
import json, os, subprocess, urllib.error, urllib.request

API = os.environ.get('API') or 'http://localhost:13000/api/v1'
C = os.environ.get('API_CONTAINER') or 'sgb-api'
RES = []
PW = 'sgb-dev-1234'


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


def sh(cmd, inp=None):
    return subprocess.run(['docker', 'exec', '-i', C, 'sh', '-c', cmd], input=inp, capture_output=True, text=True)


GOOD = ('소개뱅크 AWS 적용 전 점검 (2026-11-12 10:00:00 UTC) — 올릴 판 v10.252\n지금 앱 폴더: /home/ubuntu/sgb   ·   새 킷: /home/ubuntu/x/sgb\n\n'
        '[5] DB\n  통과  지금 도는 앱도 DB 에 붙어 있음\n        마이그레이션 — 적용됨 238 · 새 킷의 파일 242 · 올릴 것 4 · 바뀐 파일 0\n'
        '  통과  이미 적용된 파일이 바뀌지 않음\n        올릴 것: D201_owner_todo_marks D202_ops_release_log D203_ops_server_daily_todo_weekly\n        올릴 것: D204_ops_server_error_days\n'
        '        오픈 차단 11건 [ASSUME:4 INTEG:7]\n        약관: 게시 11(시행 중 3 · 새 판 시행 예정 0 · 첫 판 시행일 전 8) · 초안 1\n\n적용 전 점검 — 통과 21 · 실패 0 · 확인 0\n')
BACK = ('소개뱅크 AWS 적용 전 점검 (2026-11-12 11:00:00 UTC) — 올릴 판 v10.252\n\n[4] 판 보관\n  확인  되돌린 상태 — 지금 판이 보관 폴더의 가장 새 판(v10.252_x)보다 옛 판 — 실수였다면\n'
        '        마이그레이션 — 적용됨 242 · 새 킷의 파일 242 · 올릴 것 0 · 바뀐 파일 1\n  실패  이미 적용된 마이그레이션 파일이 다름 1건\n\n적용 전 점검 — 통과 18 · 실패 1 · 확인 2\n')
BROKEN = '소개뱅크 AWS 적용 전 점검 (2026-11-12 12:00:00 UTC) — 올릴 판 v10.252\n(중간에 멈춤)\n'
OURS = ['precheck_20261112_100000.txt', 'precheck_20261112_110000.txt', 'precheck_20261112_120000.txt', 'precheck_state.txt', 'precheck_x.txt', 'precheck_20991231_000000.log']

up = subprocess.run(['docker', 'inspect', '-f', '{{.State.Running}}', C], capture_output=True, text=True).stdout.strip() == 'true'
LOGS = sh('echo "${DATA_DIR:-$HOME/sgb-data}/logs"').stdout.strip() if up else ''
ok('전제 — 점검판 API 컨테이너 · 결과 파일 폴더', up and LOGS.endswith('/logs'), f'{C} · {LOGS}')
if up and LOGS:
    TS = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
    before = sh(f'ls -1 "{LOGS}" 2>/dev/null').stdout.split()
    pre = lambda: call('GET', '/admin/launch-watch/releases', None, TS).get('precheck')
    try:
        sh(f'mkdir -p "{LOGS}"')
        for n, body in (('precheck_20261112_100000.txt', GOOD), ('precheck_state.txt', '# 1 x\n'), ('precheck_x.txt', BACK), ('precheck_20991231_000000.log', BACK)):
            if n not in before: sh(f'cat > "{LOGS}/{n}"', body)
        p1 = pre() or {}
        ok('① 정상 파일 — 올릴 판 · 21 · 0 · 0 · 적용됨 238 · 새 킷 242 · 올릴 것 4(이름 두 줄 모두) · 바뀐 파일 0 · 되돌린 상태 아님 · 오픈 차단 11 · 약관 게시 11 · 초안 1 · 시각',
           p1.get('file') == 'precheck_20261112_100000.txt' and p1.get('version') == 'v10.252' and (p1.get('pass'), p1.get('fail'), p1.get('warn')) == (21, 0, 0)
           and (p1.get('applied'), p1.get('files'), p1.get('pending'), p1.get('drift')) == (238, 242, 4, 0)
           and p1.get('pendingNames') == ['D201_owner_todo_marks', 'D202_ops_release_log', 'D203_ops_server_daily_todo_weekly', 'D204_ops_server_error_days']
           and p1.get('rolledBack') is False and p1.get('blockers') == 11 and (p1.get('termsPublished'), p1.get('termsDraft')) == (11, 1)
           and p1.get('at') == '2026-11-12 10:00:00' and isinstance(p1.get('ageHours'), int), json.dumps(p1, ensure_ascii=False)[:240])
        ok('③ precheck_state.txt · 형식 틀린 이름(precheck_x · .log)은 읽지 않음', p1.get('file') == 'precheck_20261112_100000.txt', p1.get('file'))
        sh(f'cat > "{LOGS}/precheck_20261112_110000.txt"', BACK)
        p2 = pre() or {}
        ok('② 더 늦은 파일 — 되돌린 상태 true · 실패 1 · 확인 2 · 바뀐 파일 1 · 올릴 것 0(이름 없음)',
           p2.get('file') == 'precheck_20261112_110000.txt' and p2.get('rolledBack') is True and (p2.get('fail'), p2.get('warn'), p2.get('drift'), p2.get('pending')) == (1, 2, 1, 0)
           and p2.get('pendingNames') == [] and p2.get('blockers') is None, json.dumps(p2, ensure_ascii=False)[:200])
        sh(f'cat > "{LOGS}/precheck_20261112_120000.txt"', BROKEN)
        p3 = call('GET', '/admin/launch-watch/releases', None, TS)
        ok('② 가장 늦은 파일에 「적용 전 점검 — 통과 …」 줄이 없으면(중간에 멈춤) null', 'precheck' in p3 and p3.get('precheck') is None, str(p3.get('precheck'))[:80])
    finally:
        for n in OURS:
            if n not in before: sh(f'rm -f "{LOGS}/{n}"')
        left = [n for n in sh(f'ls -1 "{LOGS}" 2>/dev/null').stdout.split() if n in OURS and n not in before]
        print(f'  정리 — 넣은 파일 남은 것 {left}')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)

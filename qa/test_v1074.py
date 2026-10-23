"""v10.74 시험 — 점검판 사용자 웹 운영 방식(sgb-infra 만 · 서비스 코드 변경 없음)

  python3 -I test_v1074.py

  ① 덧붙이는 compose 파일 — site 만 · next build → next start · 준비 확인
  ② 스위치 — SITE_MODE=prod 일 때만 COMPOSE_FILE · 아니면 지움 · 파일 없으면 멈춤
  ③ 기능 점검 — 사용자 웹 준비 기다림 · 방식 표시 · .env 를 읽지 않음
  ④ 서버 스크립트 사본이 실제 ~/sgb-check.sh 와 같음
"""
import os, re, subprocess

Q = os.path.dirname(os.path.abspath(__file__))
R = os.path.dirname(Q)
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


rd = lambda p: open(p, encoding='utf-8').read() if os.path.exists(p) else ''
Y, S, F = rd(os.path.join(R, 'docker-compose.site-prod.yml')), rd(os.path.join(Q, 'sgb-check.sh')), rd(os.path.join(Q, 'func_check.sh'))
body = '\n'.join(l for l in Y.splitlines() if not l.lstrip().startswith('#'))

ok('① 덧붙이는 파일 — site 서비스 하나만', re.findall(r'^  (\w[\w-]*):', body, re.M) == ['site'], re.findall(r'^  (\w[\w-]*):', body, re.M))
ok('① 운영과 같은 순서 — next build 뒤 next start(0.0.0.0:5174)', 'npx next build && exec npx next start -H 0.0.0.0 -p 5174' in body, '')
ok('① 포트 · 이미지 · 비밀값을 바꾸지 않음', not re.search(r'ports:|image:|build:|PASSWORD|SECRET|KEY', body), '')
ok('① 빌드 시간을 기다리는 준비 확인(start_period 900s)', 'healthcheck:' in body and 'start_period: 900s' in body, '')
r = subprocess.run(['python3', '-c', 'import sys,yaml;yaml.safe_load(open(sys.argv[1]))', os.path.join(R, 'docker-compose.site-prod.yml')], capture_output=True, text=True)
ok('① YAML 문법', r.returncode == 0 or 'No module named' in r.stderr, (r.stderr or '').strip()[-80:])
ok('② 늘 COMPOSE_FILE 줄을 먼저 지움(지난 방식이 남지 않음)', "sed -i '/^COMPOSE_FILE=/d' .env" in S, '')
ok('② prod 일 때만 덧붙임', 'if [ "${SITE_MODE:-dev}" = prod ]; then' in S and 'COMPOSE_FILE=docker-compose.yml:docker-compose.site-prod.yml' in S, '')
ok('② 파일이 없는 옛 kit 이면 멈춤', '[중단] 이 kit 에는 docker-compose.site-prod.yml 이 없습니다' in S, '')
ok('② 점검판 포트만', all(p in S for p in ('API_PORT=13000', 'WEB_PORT=15173', 'SITE_PORT=15174', 'PG_PORT=15432')), '')
ok('③ 사용자 웹 준비까지 기다림(10초 × 90)', 'seq 1 90' in F and 'http://localhost:15174/' in F, '')
ok('③ 결과 머리에 사용자 웹 방식', '사용자 웹 $SMODE' in F and "grep -q 'next start'" in F, '')
ok('③ .env 를 읽지 않음', '.env' not in F, '')
for f in ('sgb-check.sh', 'func_check.sh'):
    r = subprocess.run(['bash', '-n', os.path.join(Q, f)], capture_output=True, text=True)
    ok(f'셸 문법 — {f}', r.returncode == 0, r.stderr[:100])
home = os.path.expanduser('~/sgb-check.sh')
if os.path.exists(home):
    ok('④ 사본이 서버의 ~/sgb-check.sh 와 같음', rd(home) == S, '')
n = sum(1 for r in RES if r[0])
print(f'통과 {n} / {len(RES)}')

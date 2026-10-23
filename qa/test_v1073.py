"""v10.73 시험 — 기능 점검 도구 정리(sgb-infra/qa 만 · 서비스 코드 변경 없음)

  python3 -I test_v1073.py

  ① 주소 · DB 를 환경 변수로 — 없으면 집 PC 기본값(3000 · 5174 · 5432) 그대로
  ② 사용자 웹 순회 — 다시 켜지는 동안 기다리기 · 주소가 바뀌는 중 기다리기 · 역할 나눠 돌리기 · 기다린 기록
  ③ 거래 흐름 — 관심 수가 늘 때까지 기다림
  ④ 시험 이미지 · 실행 스크립트 — 판 고정 · 점검판 포트만 · 결과 폴더에서 돌림
"""
import os, re, subprocess

Q = os.path.dirname(os.path.abspath(__file__))
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


rd = lambda f: open(os.path.join(Q, f), encoding='utf-8').read() if os.path.exists(os.path.join(Q, f)) else ''
E, C, T, D, F = rd('e2e.py'), rd('crawl_site.py'), rd('flow_trade.py'), rd('qa-image/Dockerfile'), rd('func_check.sh')

ok('① e2e — API · DB 환경 변수 · 기본값 그대로 · 결과는 파일 옆', "B=os.environ.get('API','http://localhost:3000/api/v1')" in E
   and "DB=os.environ.get('DB','postgresql://sgb:sgb@localhost:5432/sgb')" in E and '/home/claude/qa/e2e.json' not in E, '')
ok('① 사용자 웹 순회 — SITE · DB 환경 변수 · 기본값 그대로', "BASE=os.environ.get('SITE','http://localhost:5174')" in C
   and "DB=os.environ.get('DB','postgresql://sgb:sgb@localhost:5432/sgb')" in C and not re.search(r"^BASE='", C, re.M), '')
ok('① 점검판 포트가 시험 파일에 박혀 있지 않음', not any(p in E + C + T for p in ('13000', '15173', '15174', '15432')), '')
ok('② 다시 켜지는 동안 기다림(10초 × 12) · 연결 오류만', 'def go(pg, url, **kw)' in C and 'range(12)' in C and 'time.sleep(10)' in C
   and "'ERR_EMPTY_RESPONSE' in str(ex)" in C and C.count('pg.goto(') == 1, C.count('pg.goto('))
ok('② 주소가 바뀌는 중이면 기다렸다 다시 읽음', 'def ev(js, d, pg=pg)' in C and not re.search(r'=pg\.evaluate\(', C), '')
ok('② 역할 나눠 돌리기 · 기다린 기록', "os.environ.get('CRAWL_ROLES')" in C and "out['restart_waits']=RESTARTS" in C, '')
ok('③ 거래 흐름 — 관심 수가 1 늘 때까지 기다림', 'until(lambda: int(likes(pg)) == int(n0) + 1, 5)' in T, '')
ok('④ 시험 이미지 — 판 고정(Playwright 1.49.1 · openpyxl 3.1.5) · psql', 'FROM mcr.microsoft.com/playwright/python:v1.49.1-noble' in D
   and 'playwright==1.49.1' in D and 'openpyxl==3.1.5' in D and 'postgresql-client' in D, '')
ports = set(re.findall(r'localhost:(\d+)', F))
ok('④ 실행 스크립트 — 점검판 포트만(확인판 3000 · 5174 · 5432 안 씀)', ports == {'13000', '15174', '15432'} and '127.0.0.1:15173' in F, sorted(ports))
ok('④ 실행 스크립트 — 결과 폴더에 복사해 돌림 · 점검판 없으면 멈춤 · 8가지', 'cp -r "$QA"/. "$RES/w/"' in F and '[중단] 점검판 API(13000)' in F
   and 'fixtures e2e flow_trade flow_biz flow_mall flow_plaza crawl_site crawl_admin' in F, '')
r = subprocess.run(['bash', '-n', os.path.join(Q, 'func_check.sh')], capture_output=True, text=True)
ok('④ 실행 스크립트 문법', r.returncode == 0, r.stderr[:100])
for f in ('e2e.py', 'crawl_site.py', 'flow_trade.py'):
    try:
        compile(rd(f), f, 'exec'); good = True
    except SyntaxError as ex:
        good = str(ex)
    ok(f'파이썬 문법 — {f}', good is True, '' if good is True else good)
n = sum(1 for r in RES if r[0])
print(f'통과 {n} / {len(RES)}')

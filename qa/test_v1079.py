"""v10.79 시험 — 기능 점검이 「전부 통과」로(sgb-infra/qa 만 · 서비스 코드 변경 없음)

  python3 -I test_v1079.py

  ① 소개광장 흐름 4단계 — 운영 화면 「글 찾기」에서 감추기 → 되살리기(v10.72 결정 A까지) · 옛 「시험 한계」 판정 없음
  ② 가려진 글 문구 — 운영자가 가린 글은 v10.76 문구
  ③ 사용자 웹 순회 — 주인이 고칠 수 있는 매물(공개 중) · 404 가 맞는 곳은 expected_404
  ④ 실행 스크립트 요약 — 기대한 404 는 오류에서 뺌
"""
import os, re, subprocess

Q = os.path.dirname(os.path.abspath(__file__))
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


rd = lambda f: open(os.path.join(Q, f), encoding='utf-8').read()
P, C, F = rd('flow_plaza.py'), rd('crawl_site.py'), rd('func_check.sh')
fb = P[P.find('    def bo_find():'):P.find("    W.step('운영 화면 「소개광장 검수 › 글 찾기」")]
ok('① 4단계 — 글 찾기에서 제목 낱말로 찾음', '[data-post-finder] input[name=q]' in fb and 'has_text=TITLE' in fb and "bo_tab(bo, '소개광장 검수')" in fb, '')
ok('① 4단계 — 감추기 → 감춤 → 모든 상태 → 되살리기 → 공개(입력 창에 사유)', "exact_btn(row().first, '감추기')" in fb and "== 'HIDDEN'" in fb
   and """select_option('[data-post-finder] select[aria-label="상태"]', '')""" in fb and "exact_btn(row().first, '되살리기').click()" in fb and "== 'PUBLISHED'" in fb
   and fb.count("box['next'].append(") == 2, '')
ok('① 4단계 — 결정 A: 신고 수 0 · 신고 기각 1/1 · 신고한 사람 알림', "rc == '0'" in fb and "rep == '1/1'" in fb and "'REPORT_RESOLVED'" in fb, '')
ok('① 옛 「시험 한계」 판정 · bo_reported 없음', 'def bo_reported' not in P and "시험을 보강해야 함(시험 한계)'" not in P, '')
ok('① 다음 단계 설명에서 「가릴 단추가 없어」 지움', '운영 화면에는 이 글을 가릴 단추가 없어' not in P, '')
ok('② 로그인 안 한 사람 — 운영자가 가린 글 문구(v10.76)', "'운영 기준에 따라 가려진 글입니다' in t" in P and "'신고가 들어와 확인 중입니다' in t" not in P, '')
ok('③ 고치기 화면 매물 — seller 의 공개 매물 · 주인을 따로 적음', "a.email='seller@x.com' order by (l.status='PUBLISHED') desc" in C and "'mylisting_owner':" in C, '')
ok('③ 주인이 자기 매물 고치기 화면 → 200 · 「소개하기 수정」(owner_check)', "out['owner_check']=" in C and "'소개하기 수정' in h1" in C and 'owner_check' in F, '')
ok('③ 404 가 맞는 곳 — 잘못된 초대 주소 · 남의 매물 고치기(순회 역할은 주인이 아님)', "'/i/{token}': lambda role: True" in C and "'/listings/{id}/edit': lambda role: True" in C
   and "if st==404 and r in EXPECT_404 and EXPECT_404[r](role): rec['expected_404']=True" in C, '')
ok('④ 요약 — 기대한 404 는 오류에서 뺌 · 남은 오류는 이름을 적음', "x.get('expected_404')" in F and '기대한 404 {len(exp)}' in F and '표본 없는 주소' not in F, '')
for f in ('flow_plaza.py', 'crawl_site.py'):
    try: compile(rd(f), f, 'exec'); good = True
    except SyntaxError as ex: good = str(ex)
    ok(f'파이썬 문법 — {f}', good is True, '' if good is True else good)
r = subprocess.run(['bash', '-n', os.path.join(Q, 'func_check.sh')], capture_output=True, text=True)
ok('셸 문법 — func_check.sh', r.returncode == 0, r.stderr[:100])
n = sum(1 for r in RES if r[0])
ok('④ 흐름 시험 요약 줄 — 「통과 N / M」 줄을 골라 적음', "grep -E '^통과 [0-9]+ / [0-9]+'" in F, '')
n = sum(1 for r in RES if r[0])
print(f'통과 {n} / {len(RES)}')

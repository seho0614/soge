"""v10.35 매트릭스 · 검정 엑셀 — v10.34 엑셀(build_xlsx_v1034.py)과 같은 시트에 「13_로컬점검_AWS리허설」을 더합니다.

  python3 build_xlsx_v1035.py     (/home/claude/qa 에서 — v10.34 전수 검정 결과 final_all.txt 등을 그대로 읽음)

v10.35 는 제품 코드(화면 · API · DB)가 v10.34 와 같아 01 ~ 12 시트의 전수 검정은 v10.34 결과 그대로이고,
매트릭스 표(01 ~ 08)는 v10.35 에서 다시 만든 matrix.json(npm run matrix)을 읽습니다. 「이번 판」 칸의 바탕은 v10.34(d8dcef4).
13 시트는 qa/results_v10_35/ 의 결과(Docker 새 설치 · 운영 방식 리허설 · verify · 매트릭스 · 연동 · DB 연동)에서 읽습니다.
"""
import os, re, json
Q = os.path.dirname(os.path.abspath(__file__))
K = '/home/claude/pkg/SGB_DevDocker_Integrated_20261002'
R35 = os.environ.get('R35', K + '/qa/results_v10_35')
src = open(os.path.join(Q, 'build_xlsx_v1034.py'), encoding='utf8').read()
src = src.replace("VER, VDATE = 'v10.34', '20261012'", "VER, VDATE = 'v10.35', '20261012'")
src = src.replace("os.environ.get('BASE_COMMIT', '42f693e')", "os.environ.get('BASE_COMMIT', 'd8dcef4')")
src = src.replace("'10/12 전자세금계산서 연결 자리 + 간주 모드(D093) · 수화 오류 고침 · 개발 DB 새로 · 새 설치 결함 3건'",
                  "'10/12 로컬 점검 → AWS 적용(v10.35) — 제품 코드는 v10.34 와 같음 · 적용 길만 다시 확인(13 시트) · 전수 검정 줄은 v10.34 결과'")
src = src.replace("(v10.33: ", "(바탕 v10.34: ").replace("f\"v10.33: ", "f\"바탕 v10.34: ")
cut = src.index("os.makedirs(os.path.dirname(OUT), exist_ok=True)")
body, tail = src[:cut], src[cut:]

ADD = r'''
# ── 13 로컬 점검 · AWS 리허설 (v10.35) ──
def _lines(p, pat):
    try: return [l.rstrip() for l in open(p, encoding='utf8', errors='replace') if re.search(pat, l)]
    except Exception: return []
_rows = []
for nm, f in (('Docker 새 설치 — sh(./dev.sh realcheck fresh)', 'realcheck_sh.txt'), ('Docker — PowerShell 7.4.6(dev.ps1 realcheck)', 'realcheck_ps.txt')):
    p = os.path.join(R35, f)
    for l in _lines(p, r'^\s+(통과|실패|건너뜀)\s|진짜 이미지 확인 —|통과 \d+ / 실패|SQL 대조'):
        s = l.strip(); st = '실패(대체 이미지)' if s.startswith('실패') and '공식 이미지 표지' in s else s.split()[0]
        _rows.append([nm, st, s])
for l in _lines(os.path.join(R35, 'aws_rehearsal_sh.log'), r'^(ok|FAIL)\s|운영 방식 리허설'):
    _rows.append(['운영 방식 리허설(9/30 서버 → v10.35 · 포장 zip)', '통과' if l.startswith('ok') else ('실패' if l.startswith('FAIL') else '합계'), l[5:] if l[:4] in ('ok  ', 'FAIL') else l])
for l in _lines(os.path.join(R35, 'aws_rehearsal.log'), r'^(ok|FAIL)\s|^통과 \d+ / \d+'):
    _rows.append(['리허설 화면 · 기능(aws_rehearsal.py)', '통과' if l.startswith('ok') else ('실패' if l.startswith('FAIL') else '합계'), l[5:] if l[:4] in ('ok  ', 'FAIL') else l])
for nm, f, pat in (('통합 검정(npm run verify · 새 검정 DB)', 'verify.log', r'^통과 \d+ / 실패|뚫림|SQL 대조|^안전 \d+ · ▲|^exit='),
                   ('매트릭스(npm run matrix)', 'matrix.log', r'^매트릭스|^교차'),
                   ('연동 테스트(link_check)', 'link_check.log', r'^통과 \d+ / \d+'), ('DB 연동 테스트(db_link)', 'db_link.log', r'^통과 \d+ / \d+')):
    for l in _lines(os.path.join(R35, f), pat): _rows.append([nm, '기록', l.strip()])
sheet('13_로컬점검_AWS리허설', ['묶음', '판정', '내용'], _rows or [['—', '', '결과 파일 없음']], {'묶음': 44, '판정': 16, '내용': 140})
summary_ws = wb['00_요약']
_reh = [r for r in _rows if r[0].startswith('운영 방식 리허설') and r[1] in ('통과', '실패')]
summary_ws.append(['로컬 점검 → AWS 적용 리허설(v10.35)', f"리허설 {sum(1 for r in _reh if r[1] == '통과')} / {len(_reh)} · Docker sh · PowerShell 결과는 13 시트", '실제 AWS 에서는 돌리지 못함 — sgb/docs/84'])
'''
exec(compile(body + ADD + tail, 'build_xlsx_v1035', 'exec'))

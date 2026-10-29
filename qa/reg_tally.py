"""회귀 결과 집계 (v10.152) — 시험마다 「통과 = 전체」인지 줄마다 세고, 하나라도 다르면 실패로 끝냄

  python3 reg_tally.py <회귀 로그>            # 로그 줄 모양: 「test_vNNNN.py | 결과: 12 / 13」 또는 「… | 결과 — 통과 18 · 실패 1」
  python3 reg_tally.py <로그> --expect 61     # 시험 수까지 확인(덜 돌았으면 실패)

  끝 코드 0 = 모두 통과 · 1 = 실패 · 결과 줄 없음 · 수가 모자람. 보고 · 풀 리퀘스트 설명에는 이 출력을 그대로 붙인다.
  (2026-10-29 — 로그를 tail 로 잘라 보다 test_v1094 · 1125 · 1126 · 1127 실패를 놓친 일이 있어 만듦)
"""
import re, sys


def tally(lines):
    rows = []
    for l in lines:
        m = re.match(r'^(test_\S+\.py)\s*\|\s*(.*)$', l.strip())
        if not m:
            continue
        name, rest = m.groups()
        a = re.search(r'결과:\s*(\d+)\s*/\s*(\d+)', rest)
        b = re.search(r'통과\s*(\d+)\s*·\s*실패\s*(\d+)', rest)
        if a:
            p, t = int(a.group(1)), int(a.group(2))
        elif b:
            p, t = int(b.group(1)), int(b.group(1)) + int(b.group(2))
        else:
            p, t = None, None   # 결과 줄이 없음 — 멈췄거나 시간 초과
        rows.append((name, p, t))
    return rows


def main(argv):
    if len(argv) < 2:
        print(__doc__); return 2
    expect = int(argv[argv.index('--expect') + 1]) if '--expect' in argv else None
    rows = tally(open(argv[1], encoding='utf-8', errors='replace'))
    bad = [r for r in rows if r[1] is None or r[1] != r[2]]
    for n, p, t in bad:
        print(f'  실패  {n} — ' + (f'{p} / {t}' if p is not None else '결과 줄 없음(멈춤 · 시간 초과)'))
    ok_n = len(rows) - len(bad)
    short = expect is not None and len(rows) < expect
    print(f'회귀 집계 — 시험 {len(rows)}개' + (f' (기대 {expect})' if expect else '') + f' · 모두 통과 {ok_n} · 실패 {len(bad)}'
          + (' · 수가 모자람' if short else ''))
    return 0 if rows and not bad and not short else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv))

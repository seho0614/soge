#!/usr/bin/env python3
"""v10.636 (docs/780) 운영 적용 화면 출력 보관 — 대표가 붙여 넣은 precheck · apply · postcheck 출력을 판별로 남김
  python3 tools/ops-result-save.py <올린 판 v10.NNN> <출력 파일 | ->      → ~/kits/ops/results/<판>_apply.txt
  · 「적용 전 점검 —」 또는 「적용 후 확인 —」 줄이 있어야 함(다른 글을 잘못 넣지 않게)
  · 비밀 값처럼 보이는 줄(KEY= · SECRET= · PASSWORD= · postgres://사용자:비밀번호@ · BEGIN … PRIVATE KEY)이 있으면 저장하지 않음
  · 이미 있으면 덮어쓰지 않음(--force 일 때만) — 절차서 도구(ops-doc-draft.py)가 [5] · postcheck 기대 숫자를 이 파일에서 읽음
"""
import os, re, sys

SECRET = re.compile(r'(?i)\b\w*(SECRET|PASSWORD|API_KEY|ACCESS_KEY|PRIVATE_KEY|TOKEN)\w*\s*=\s*\S{6,}|postgres(ql)?://[^:\s]+:[^@\s]+@|BEGIN [A-Z ]*PRIVATE KEY')


def main(argv):
    force = '--force' in argv
    args = [a for a in argv if a != '--force']
    if len(args) != 2 or not re.fullmatch(r'v10\.\d+', args[0]):
        print(__doc__); return 2
    text = sys.stdin.read() if args[1] == '-' else open(args[1], encoding='utf-8').read()
    if not re.search(r'적용 전 점검 — 통과|적용 후 확인 — 통과', text):
        print('precheck · postcheck 결과 줄(「적용 전 점검 —」 · 「적용 후 확인 —」)이 없음 — 저장하지 않음'); return 3
    bad = [l.strip()[:60] for l in text.splitlines() if SECRET.search(l)]
    if bad:
        print('비밀 값처럼 보이는 줄이 있어 저장하지 않음:', *bad[:3], sep='\n  '); return 4
    d = os.path.expanduser('~/kits/ops/results'); os.makedirs(d, exist_ok=True)
    f = os.path.join(d, f'{args[0]}_apply.txt')
    if os.path.exists(f) and not force:
        print(f'이미 있음(덮어쓰려면 --force): {f}'); return 5
    open(f, 'w', encoding='utf-8').write(text if text.endswith('\n') else text + '\n')
    print(f'저장: {f} · {len(text.splitlines())}줄'); return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))

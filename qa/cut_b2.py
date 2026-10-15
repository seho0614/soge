"""제시 디자인(원본 PNG)에서 조각을 잘라 실제 웹(site/public/b2)에 둡니다 — v10.23.

  python3 cut_b2.py            b2_assets.json 의 좌표대로 자름 · 이미 같은 파일이면 그대로 둠
  python3 cut_b2.py --check    자르지 않고, 놓여 있는 파일이 원본의 그 자리와 점 하나 같은지만 봄

「사진을 변환하지 않고 사용(png)」 — 자르기만 합니다. 크기를 바꾸거나 다른 형식으로 바꾸지 않습니다.
"""
import json, os, sys
from PIL import Image, ImageChops

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
if not os.path.isdir(K + '/sgb'): K = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
Q = os.path.dirname(os.path.abspath(__file__))
SRC = K + '/sgb/docs/design/'; DST = K + '/sgb/site/public/b2/'

def main(check):
    man = json.load(open(os.path.join(Q, 'b2_assets.json'), encoding='utf8')); bad = []; n = 0
    for src, parts in man.items():
        if src.startswith('_'): continue
        if not os.path.exists(SRC + src):      # v10.31.1 — 원본이 킷 밖(디자인 원본 묶음)이면 지문으로
            from design_fp import same_fp
            if not check: print('원본이 없어 자를 수 없습니다 — 디자인 원본 묶음의 ' + src + ' 를 ' + SRC + ' 에 넣으십시오'); return False
            for name in parts:
                n += 1
                if not same_fp('b2', name, DST + name): bad.append(name)
            print('(원본 없음 — 지문으로 견줌)', end=' '); continue
        im = Image.open(SRC + src)
        assert im.format == 'PNG', (src, im.format)
        im = im.convert('RGB')
        for name, box in parts.items():
            crop = im.crop(tuple(box)); path = DST + name; n += 1
            if not check and not (os.path.exists(path) and same(path, crop)):
                os.makedirs(DST, exist_ok=True); crop.save(path, format='PNG', optimize=False)
            if not same(path, crop): bad.append(name)
    print(f'조각 {n}개 · 원본과 다른 것 {len(bad)}', bad)
    return not bad

def same(path, crop):
    try: got = Image.open(path)
    except Exception: return False
    return got.format == 'PNG' and got.size == crop.size and ImageChops.difference(got.convert('RGB'), crop).getbbox() is None

if __name__ == '__main__':
    sys.exit(0 if main('--check' in sys.argv) else 1)

"""v10.769 (docs/877) 관 대표 색 대비 점검
  ① contrastOnWhite · 화면 경고 · 계산 값(남색 4.5 넘음 · 주황 4.5 아래)
  ④ 문서 877 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

GS = rd('web/src/app/admin/gwans/GwanSettings.tsx')
def cr(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    c = [x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return 1.05 / (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] + 0.05)
ok('① 화면 · 계산', 'export function contrastOnWhite(hex: string): number' in GS and 'data-gwan-color-contrast' in GS and 'r < 4.5' in GS and cr('#00245a') > 4.5 and cr('#ffa03e') < 4.5, f"{cr('#00245a'):.1f} {cr('#ffa03e'):.1f}")

d = doc('877_')
ok('④ 문서 877', all(w in d for w in ('대비',)), str(len(d)))
ok('④ VERSION v10.769 이상', VT >= (10, 769), VER)
done()

# v10.27 — G-137 (10/8 답 「지금 적용」 · 「코드로 그린 그림」) : 시안의 견본 사진 14칸을 칸마다 다른 그림으로 바꿉니다.
#   전에는 14칸에 실제 그림이 5장뿐(같은 그림이 겹쳐 쓰임 — 태양광 매물에 상가 사진) · 자동차 사진에 특정 회사 상표 · 귀퉁이에 디자인 배지 조각.
#   새 그림은 코드(SVG)로 그린 것(qa/g137/src/*.svg → 320×240 JPEG) — 글자 · 상표 · 배지 없음. 분류 → 그림 열쇠(PHOTO_MAP)는 그대로.
#   proto_patch_1027.py 가 exec 로 불러 씁니다(같은 s).
import base64 as _b64, re as _re
_G = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'g137', 'final_v1027')
_i = s.index('window.SGB_IMG = {'); _j = s.index('\n};', _i)
_blk = s[_i:_j]; _n = 0
for _k in ('car', 'mac', 'int', 'cafe', 'shop', 'apt', 'land', 'solar', 'truck', 'cnc', 'fridge', 'cloth', 'fruit', 'bunsik'):
    _uri = 'data:image/jpeg;base64,' + _b64.b64encode(open(os.path.join(_G, _k + '.jpg'), 'rb').read()).decode()
    _blk, _c = _re.subn(r'(\n\s*["\']?' + _k + r'["\']?\s*:\s*["\'])data:image/jpeg;base64,[A-Za-z0-9+/=]+', lambda m: m.group(1) + _uri, _blk)
    if _c != 1: sys.exit(f'G-137 그림 칸 {_k}: {_c}곳')
    _n += 1
s = s[:_i] + '/* v10.27 (G-137) — 견본 그림 14칸 = 칸마다 다른 그림(코드로 그림 · 글자 · 상표 없음) */\n' + _blk + s[_j:]
rep(''' · 베스트매칭 · 사고예방 · 성공현황의 소개 버튼 3종 삭제 · v10.26: 2026-10-08 · ''',
    ''' · 베스트매칭 · 사고예방 · 성공현황의 소개 버튼 3종 삭제 · 견본 그림 14칸을 분류마다 다른 그림으로 · v10.26: 2026-10-08 · ''')

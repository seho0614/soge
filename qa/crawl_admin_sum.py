"""crawl_admin_final.py 의 결과(admin_final.json)를 한 줄로 — 계정 수 · 화면 상태 수 · 스크립트 오류 · API 실패 · 오류 화면. v10.31"""
import json, os
T = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'admin_final.json'), encoding='utf8'))['tabs']
users = sorted(set(t['user'] for t in T)); st = [t for t in T if t.get('tab')]
bad = [t for t in st if t.get('errors') or t.get('api_fail') or t.get('errview') or t.get('clicked') is False]
print(f"계정 {len(users)} · 화면 상태 {len(st)} · 실패 {len(bad)}" + (' — ' + ', '.join(f"{t['user']} {t.get('group')}›{t['tab']}" for t in bad[:6]) if bad else '') +
      f" · 로그인 막힘 {sum(1 for t in T if not t.get('tab'))}계정(운영 권한 없음 — 의도)")

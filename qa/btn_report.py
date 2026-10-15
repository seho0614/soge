"""버튼 체크 결과를 한 줄로 — python3 btn_report.py site|bo   (btn_site_*.json · btn_bo_*.json 을 모음 → btn_site.json · btn_bo.json)"""
import glob, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); kind = sys.argv[1]
BAD = ('죽은 단추', '누를 수 없음', '요청에 로그인 토큰이 없음', '다시 열었더니 없음')
tot = {}; rows = []; units = 0
if kind == 'site':
    for r in ['guest', 'person', 'buyer', 'intro', 'admin']:
        d = json.load(open(f'{HERE}/btn_site_{r}.json'))
        for p in d['pages']:
            units += 1
            for b in p['buttons']:
                tot[b['result']] = tot.get(b['result'], 0) + 1
                rows.append({'who': r, 'where': p['url'], 'route': p['route'], **{k: b.get(k) for k in ('region', 'tag', 'text', 'handler', 'result', 'react', 'requests', 'why', 'title')}})
else:
    for f in sorted(glob.glob(f'{HERE}/btn_bo_*.json')):
        d = json.load(open(f))
        if 'states' not in d: continue
        for st in d['states']:
            units += 1
            for b in st['buttons']:
                tot[b['result']] = tot.get(b['result'], 0) + 1
                rows.append({'who': d['user'], 'where': st['state'], **{k: b.get(k) for k in ('region', 'tag', 'text', 'handler', 'result', 'react', 'requests', 'why', 'title')}})
json.dump({'total': tot, 'units': units, 'rows': rows}, open(f'{HERE}/btn_{kind}.json', 'w'), ensure_ascii=False)
bad = sum(tot.get(k, 0) for k in BAD)
print(f"{'쪽' if kind == 'site' else '상태'} {units} · 단추 {sum(tot.values())} · " + ' · '.join(f'{k} {v}' for k, v in sorted(tot.items(), key=lambda x: -x[1])) + f" · 문제 {bad}")

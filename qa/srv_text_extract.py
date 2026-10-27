"""v10.125 — API 의 한국어 오류 · 안내 글 뽑기(test_v1125 가 씀) — python3 srv_text_extract.py <sgb-core 경로> → JSON [{module, file, line, key, kind}]
  key: 고정 글은 그대로 · 템플릿(`…${x}…`)은 ${…} 를 {0},{1} 로. kind: error | field"""
import json, os, re, sys
H = re.compile('[가-힣]')
ERR = re.compile(r"new (?:PolicyViolation|StateConflict|Forbidden|NotFound|AppError|Unauthorized|BadRequestException|ForbiddenException|NotFoundException|UnauthorizedException)\w*\(")
FIELD = re.compile(r"\b(note|warning|reason|message|notice)\s*:\s*")
def strings(seg):
    out = []
    i = 0
    while i < len(seg):
        c = seg[i]
        if c in "'`\"":
            j = i + 1; buf = ''
            while j < len(seg) and seg[j] != c:
                if c == '`' and seg.startswith('${', j):
                    d = 0; k = j + 1
                    while k < len(seg):
                        if seg[k] == '{': d += 1
                        elif seg[k] == '}':
                            d -= 1
                            if d == 0: break
                        k += 1
                    buf += seg[j:k + 1]; j = k + 1; continue
                if seg[j] == '\\': buf += seg[j:j+2]; j += 2; continue
                buf += seg[j]; j += 1
            out.append((c, buf)); i = j + 1
        else: i += 1
    return out
def norm(q, s):
    if q != '`': return s.replace("\\'", "'")
    out = ''; n = 0; i = 0
    while i < len(s):
        if s.startswith('${', i):
            d = 0; j = i + 1
            while j < len(s):
                if s[j] == '{': d += 1
                elif s[j] == '}':
                    d -= 1
                    if d == 0: break
                j += 1
            out += '{%d}' % n; n += 1; i = j + 1
        else: out += s[i]; i += 1
    return out
def extract(root):
  res = []
  for d, _, fs in os.walk(os.path.join(root, 'src')):
      for f in fs:
          if not f.endswith('.ts') or f.endswith('.spec.ts') or 'generated' in d: continue
          p = os.path.join(d, f); rel = os.path.relpath(p, root); mod = rel.split('/')[2] if rel.startswith('src/modules/') else rel.split('/')[1]
          s = open(p, encoding='utf-8').read()
          for rx, kind in ((ERR, 'error'), (FIELD, 'field')):
              for m in rx.finditer(s):
                  # 인자 · 값 구간: 괄호 균형 또는 줄 끝까지(삼항 이어지는 줄 포함 — 다음 쉼표/세미콜론 수준까지)
                  i = m.end(); depth = 1 if kind == 'error' else 0; j = i
                  while j < len(s):
                      ch = s[j]
                      if ch in "'`\"":
                          q = ch; j += 1
                          while j < len(s) and s[j] != q:
                              j += 2 if s[j] == '\\' else 1
                      elif ch in '([{': depth += 1
                      elif ch in ')]}':
                          depth -= 1
                          if depth < 0 or (kind == 'error' and depth == 0): break
                      elif kind == 'field' and depth == 0 and ch in ',;\n' and not s[j+1:j+40].lstrip().startswith((':', '?')) and not s[max(0,j-3):j].rstrip().endswith(('?', ':')):
                          break
                      j += 1
                  seg = s[i:j]
                  line = s.count('\n', 0, m.start()) + 1
                  for q, txt in strings(seg):
                      if H.search(txt) and '${' not in txt.split('`')[0][:0]:
                          k = norm(q, txt).strip()
                          if k: res.append({'module': mod, 'file': rel, 'line': line, 'key': k, 'kind': kind})
  return res

if __name__ == '__main__':
    json.dump(extract(sys.argv[1]), sys.stdout, ensure_ascii=False)


# v10.127 — DB 트리거 · 함수가 던지는 오류(RAISE EXCEPTION '…') — DbErrorFilter 가 접두어를 떼고 보내는 글 모양으로
_RAISE = re.compile(r"RAISE\s+EXCEPTION\s+'((?:[^']|'')*)'", re.I)
_PFX = [re.compile(r'INV-\d+ violated:\s*(.*)', re.S), re.compile(r'A-14:\s*(.*)', re.S), re.compile(r'B-21 violated:\s*(.*)', re.S),
        re.compile(r'view quota exceeded:\s*(.*)', re.S), re.compile(r'listing slot limit reached:\s*(.*)', re.S),
        re.compile(r'^INV-\d+:\s*(.*)', re.S), re.compile(r'^RSK-\d+:\s*(.*)', re.S), re.compile(r'^([A-Z][A-Z0-9_-]{1,39}):\s*(.+)', re.S)]


def db_message(raw):
    """RAISE 글 → 사용자에게 가는 message(접두어 뗌 · % 자리는 {0} …) · 접두어가 없으면 None(500 으로 감춰짐)"""
    for rx in _PFX:
        m = rx.search(raw)
        if m:
            msg = m.group(m.lastindex).strip()
            n = [0]
            def rep(_):
                k = '{%d}' % n[0]; n[0] += 1; return k
            return re.sub(r'(?<!%)%(?!%)', rep, msg).replace('%%', '%')
    return None


def extract_db(root):
    """마이그레이션 전부의 RAISE EXCEPTION 글 — 같은 함수가 여러 번 다시 만들어졌으면 마지막 것만 쓰이지만, 옛 글도 사전에 있어도 해가 없어 모두 모음"""
    res = []
    mdir = os.path.join(root, 'prisma', 'migrations')
    for d in sorted(os.listdir(mdir)):
        p = os.path.join(mdir, d, 'migration.sql')
        if not os.path.exists(p): continue
        s = open(p, encoding='utf-8').read()
        for m in _RAISE.finditer(s):
            raw = m.group(1).replace("''", "'")
            if not re.search('[가-힣]', raw): continue
            k = db_message(raw)
            if k and re.search('[가-힣]', re.sub(r'\{\d+\}', '', k)) and not k.rstrip().endswith(('—', ':')):   # 「… —」처럼 뒤를 || 로 잇는 글은 실행 때 모양이 달라 뺌
                res.append({'module': 'db', 'file': f'prisma/migrations/{d}', 'line': s.count('\n', 0, m.start()) + 1, 'key': k, 'kind': 'db'})
    return res

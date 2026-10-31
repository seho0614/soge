#!/usr/bin/env python3
"""claude.ai 데이터 내보내기 → 읽기용 Markdown (sgb-core docs/250 5-3 · 2026-10-31)

  사용: python3 claude_export_to_md.py <풀어 둔 폴더> <결과 폴더> <고를 낱말>
    <풀어 둔 폴더> 안에 x_conversations/conversations.json · x_projects/projects/*.json · x_memories/memories/*.json
    (conversations-000.zip · projects-000.zip · memories-000.zip 을 각각 x_conversations · x_projects · x_memories 로 풂)
  결과: 대화 1개 = .md 1개 · 00_목록.md · _프로젝트/(지침 · 설명 · 문서) · _기억_memories.json
  고를 낱말이 제목 · 요약 · 내용에 든 대화만 — 내보내기에는 「어느 프로젝트 대화」 칸이 없음(10/31)
  AWS 액세스 키 · 비밀 키 · Anthropic 키 모양은 〔가림〕으로 바꿈(예시 키 AKIAIOSFODNN7EXAMPLE 은 그대로)
  원본 zip 은 가리지 않은 글 — Git · 공유 폴더에 올리지 않음
"""
import json, sys, os, re, glob

def redact(t):
    t = re.sub(r'AKIA(?!IOSFODNN7EXAMPLE)[0-9A-Z]{16}', 'AKIA〔가림〕', t)
    t = re.sub(r'(?i)(aws_secret_access_key\s*[=:]\s*)[A-Za-z0-9/+]{40}', r'\1〔가림〕', t)
    t = re.sub(r'sk-ant-[A-Za-z0-9_-]{10,}', 'sk-ant-〔가림〕', t)
    return t
base, out, key = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(out, exist_ok=True)
def mtext(m):
    t = m.get('text') or ''
    if not t and m.get('content'):
        t = '\n'.join(b.get('text') or '' for b in m['content'] if isinstance(b, dict))
    return redact(t)
c = json.load(open(os.path.join(base, 'x_conversations/conversations.json'), encoding='utf-8'))
rows = []
for x in c:
    msgs = x.get('chat_messages') or []
    title = x.get('name') or '(제목 없음)'
    body = '\n'.join(mtext(m) for m in msgs)
    if key not in title and key not in body and key not in (x.get('summary') or ''):
        continue
    day = (x.get('created_at') or '')[:10]
    safe = re.sub(r'[\\/:*?"<>|\s]+', '_', title)[:60]
    fn = f'{day}_{safe}_{x["uuid"][:8]}.md'
    with open(os.path.join(out, fn), 'w', encoding='utf-8') as f:
        f.write(f'# {title}\n\n- 만든 때 {x.get("created_at")} · 고친 때 {x.get("updated_at")} · id {x.get("uuid")} · 메시지 {len(msgs)}\n')
        if x.get('summary'): f.write(f'- 요약: {x["summary"]}\n')
        f.write('\n')
        for m in msgs:
            who = '대표' if m.get('sender') == 'human' else 'Claude'
            att = [a.get('file_name') for a in (m.get('attachments') or []) if isinstance(a, dict)] + [a.get('file_name') for a in (m.get('files') or []) if isinstance(a, dict)]
            f.write(f'## {who} · {(m.get("created_at") or "")[:16].replace("T", " ")}\n\n')
            if any(att): f.write('첨부: ' + ', '.join(a for a in att if a) + '\n\n')
            f.write(mtext(m) + '\n\n')
    rows.append((day, title, len(msgs), fn))
rows.sort()
with open(os.path.join(out, '00_목록.md'), 'w', encoding='utf-8') as f:
    f.write(f'# claude.ai 대화 중 「{key}」 — {len(rows)}개\n\n| 날짜 | 제목 | 메시지 | 파일 |\n|---|---|---|---|\n')
    for d, t, n, fn in rows: f.write(f'| {d} | {t} | {n} | {fn} |\n')
# 프로젝트 지침 · 문서
for pf in glob.glob(os.path.join(base, 'x_projects/projects/*.json')):
    p = json.load(open(pf, encoding='utf-8'))
    if p.get('name') != key: continue
    pd = os.path.join(out, '_프로젝트'); os.makedirs(os.path.join(pd, 'docs'), exist_ok=True)
    open(os.path.join(pd, '지침_prompt_template.md'), 'w', encoding='utf-8').write(p.get('prompt_template') or '')
    open(os.path.join(pd, '설명.md'), 'w', encoding='utf-8').write(p.get('description') or '')
    for d in p.get('docs') or []:
        nm = re.sub(r'[\\/:*?"<>|]', '_', d.get('filename') or d.get('uuid', 'doc'))
        open(os.path.join(pd, 'docs', nm), 'w', encoding='utf-8').write(d.get('content') or '')
    print('프로젝트 문서', len(p.get('docs') or []), '지침 글자', len(p.get('prompt_template') or ''))
mm = json.load(open(glob.glob(os.path.join(base, 'x_memories/memories/*.json'))[0], encoding='utf-8'))
json.dump(mm, open(os.path.join(out, '_기억_memories.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('대화', len(rows), '/', len(c), '기간', rows[0][0] if rows else '-', '~', rows[-1][0] if rows else '-')

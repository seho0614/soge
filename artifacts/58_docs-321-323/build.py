# 58 운영 문서 3종 보기 — sgb-core docs/321 · 322 · 323 을 tpl.html 에 넣어 artifacts/58_docs-321-323.html 을 만듦
# 쓰는 법: python3 artifacts/58_docs-321-323/build.py   (sgb-docs 맨 위에서 · 문서를 고친 뒤 다시 돌리고 아티팩트도 다시 올림)
import json, glob, os
H=os.path.dirname(os.path.abspath(__file__))
D=os.path.expanduser('~/sogaebank/sgb-core/')
docs=[('proc','운영 반영 절차서','적용하는 사람(ubuntu)',glob.glob(D+'docs/321_*')[0]),
      ('ops','운영 지침서','운영 화면을 쓰는 운영자',glob.glob(D+'docs/322_*')[0]),
      ('manual','사용자 설명서','회원 · AI 상담 자료',glob.glob(D+'docs/323_*')[0])]
data=[{'id':i,'name':n,'who':w,'file':os.path.basename(p),'md':open(p,encoding='utf-8').read()} for i,n,w,p in docs]
js=json.dumps(data,ensure_ascii=False).replace('</','<\\/')
ver=open(D+'VERSION',encoding='utf-8').read().strip()
tpl=open(os.path.join(H,'tpl.html'),encoding='utf-8').read()
out=os.path.join(H,'..','58_docs-321-323.html')
open(out,'w',encoding='utf-8').write(tpl.replace('/*__DATA__*/[]',js).replace('__VER__',ver))
print(ver, sum(len(d['md']) for d in data), os.path.normpath(out))

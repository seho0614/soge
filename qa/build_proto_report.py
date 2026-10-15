"""시안 전수 점검 결과(proto_sweep.json · hlt_sweep_after.json) → proto_report_1002.json"""
import json, collections
K='/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb'
ids=json.load(open(f'{K}/spec/proto_ids.json'))
old={(r['kind'],r['key']):r for r in json.load(open('proto_report_1002.json'))}
s=json.load(open('proto_sweep.json')); h=json.load(open('hlt_sweep_after.json'))
out=[]
def row(kind,key,sid,title,clicks):
    c=collections.Counter(x['res'] for x in clicks)
    prev=old.get((kind,key),{})
    return {'kind':kind,'key':key,'id':sid,'title':title,'clicks':len(clicks),'nav':c['NAV']+c['NAV-OUT'],'toast':c['TOAST'],
            'dom':c['DOM'],'input':c['INPUT'],'disabled':c['DISABLED'],'none':c['NONE'],'error':c['ERROR']+c['EXC']+c['PAGE-LEFT'],
            'dead':sorted({x['text'] for x in clicks if x['res']=='NONE'}),
            'dead_before':prev.get('dead_before') or prev.get('dead') or []}
for x in s['screens']:
    out.append(row('본체',x['key'],(ids.get(x['key'],{}).get('ids') or [''])[0],x.get('title',''),x['clicks']))
for x in h:
    out.append(row('건강몰',x.get('at') or x.get('id'),x.get('id'),x.get('title',''),x['clicks']))
json.dump(out,open('proto_report_1002.json','w'),ensure_ascii=False,indent=1)
t=collections.Counter()
for r in out:
    for k in ('clicks','nav','toast','dom','input','disabled','none','error'): t[k]+=r[k]
print(len(out),dict(t)); print('dead',[(r['key'],r['dead']) for r in out if r['dead']])

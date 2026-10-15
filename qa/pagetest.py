import json, urllib.request, urllib.parse
B='http://localhost:3000/api/v1/listings'
def get(q): return json.load(urllib.request.urlopen(B+'?'+urllib.parse.urlencode(q)))
for sort in ['RECENT','FEE_DESC','POPULAR']:
    full=[x['id'] for x in get({'sort':sort,'limit':50})['organic']]
    pages=[]; cur=None; n=0
    while True:
        q={'sort':sort,'limit':3}
        if cur: q['cursor']=cur
        d=get(q); pages+= [x['id'] for x in d['organic']]; cur=d['nextCursor']; n+=1
        if not cur or n>200: break
    print(sort, 'full',len(full),'paged',len(pages),'same order', pages[:len(full)]==full and (len(pages)==len(full) or len(full)==50), 'dups', len(pages)-len(set(pages)), 'keys_leak', '_sk' in json.dumps(d))

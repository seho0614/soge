import sys, threading
from playwright.sync_api import sync_playwright
PATHS=['/money','/mall','/money?sort=POPULAR','/listings','/mal/brokers','/biz']
res={'n':0,'err':0}
def worker(i):
    with sync_playwright() as p:
        b=p.chromium.launch(); c=b.new_context(); pg=c.new_page(); errs=[]
        pg.on('pageerror',lambda e:errs.append(str(e)[:60]))
        pg.goto('http://localhost:5174/login'); pg.fill('input[name=email]','buyer@x.com'); pg.fill('input[name=password]','sgb-dev-1234'); pg.click('form.auth button'); pg.wait_for_timeout(2000)
        for k in range(int(sys.argv[1])):
            errs.clear(); pg.goto('http://localhost:5174'+PATHS[(k+i)%len(PATHS)],wait_until='networkidle')
            res['n']+=1
            if any('418' in e or '423' in e or 'ydrat' in e for e in errs): res['err']+=1
        b.close()
ts=[threading.Thread(target=worker,args=(i,)) for i in range(4)]
[t.start() for t in ts]; [t.join() for t in ts]
print('loads',res['n'],'hydration errors',res['err'])

from playwright.sync_api import sync_playwright
U=['/deal/bad/contract','/deal/bad/payment','/deal/bad/confirm','/deal/bad/review','/my/contracts/bad','/community/bad','/community/99999999','/health/p/NOPE','/health/c/NOPE','/health/i/NOPE','/health/w/NOPE','/my/health/orders/NOPE','/my/health/orders/NOPE/ship','/partner/services/bad','/report/LISTING/bad','/request/bad','/chat/bad','/listings/bad/edit','/terms/NOPE','/i/bad','/money/bad','/zzz/1']
with sync_playwright() as p:
    b=p.chromium.launch(); c=b.new_context(); pg=c.new_page()
    pg.goto('http://localhost:5174/login'); pg.fill('input[name=email]','intro@x.com'); pg.fill('input[name=password]','sgb-dev-1234'); pg.click('form.auth button'); pg.wait_for_timeout(2500)
    for u in U:
        r=pg.goto('http://localhost:5174'+u); print(r.status if r else None, u, pg.evaluate("(document.querySelector('h1')||{}).innerText||''")[:40])

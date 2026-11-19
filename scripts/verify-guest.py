"""验证「无令牌也能看热门」。

依赖：`npx vite preview --port 4173`，playwright，xvfb。
    xvfb-run -a python3 scripts/verify-guest.py

刻意不 mock 任何请求：要验的正是「不导入令牌时能不能拿到公开榜单」，
mock 掉就等于把被测对象换成了假数据。

断言口径：
- 首屏没有任何令牌，直接点「热门」；
- 列表出现真实仓库行（数量 ≥ 10）；
- 出现游客模式提示；
- star 按钮不存在（匿名没有写权限，露出来只会点一次报一次错）。
"""
import os

from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:4173/'
OUT = '/workspace/ghx/docs/screenshots'


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch(
            headless=False,
            args=['--no-sandbox', '--force-color-profile=srgb', '--hide-scrollbars'],
        )
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        pg = ctx.new_page()
        # 记录实际发出的 Authorization 头，空头曾经让 GitHub 回 401
        seen = []
        pg.on('request', lambda r: seen.append(r.headers.get('authorization')) if 'api.github.com' in r.url else None)

        pg.goto(BASE)
        pg.wait_for_timeout(1200)

        # 确认真的没有令牌：账号按钮上不该有 @login
        who = pg.locator('.who-btn, .avatar-btn').first
        assert who.count() > 0, '主界面没渲染出来'
        print(f'[0] 进入主界面，账号区文本：{who.inner_text()!r}')

        pg.click('.tabbar button:has(.tab-label:text-is("热门"))')
        # 骨架行也是 .hot-row（8 条），必须等真行（.row-hit）出来
        pg.wait_for_selector('.hot-row .row-hit', timeout=45000)
        rows = pg.locator('.hot-row:has(.row-hit)')
        n = rows.count()
        assert n >= 10, f'热门列表只有 {n} 行'
        first = rows.first.inner_text().split('\n')[0]
        print(f'[1] 热门列表 {n} 行，首行 {first!r}')

        tip = pg.locator('.guest-tip').count()
        assert tip > 0, '没有游客模式提示'
        print('[2] 游客模式提示在')

        # display:none 的元素仍然能 count 到，必须按可见性算
        stars = pg.locator('.hot-row .star-on:visible').count()
        assert stars == 0, f'匿名还露着 {stars} 个 star 按钮'
        print('[3] star 按钮已收起')

        bad = [h for h in seen if h]
        assert not bad, f'匿名请求仍带了 Authorization：{bad[:2]}'
        print(f'[4] {len(seen)} 个请求全部匿名发出，无一携带 Authorization')

        pg.screenshot(path=f'{OUT}/hot-guest-081.png')
        print(f'截图：{OUT}/hot-guest-081.png')

        # 语言筛选：走同一个匿名客户端，换组合不报错
        pg.click('.chip:text-is("TypeScript")')
        pg.wait_for_timeout(6000)
        t2 = pg.locator('.page-sub').first.inner_text()
        n2 = pg.locator('.hot-row:has(.row-hit)').count()
        print(f'[5] 切到 TypeScript：{n2} 行，{t2!r}')
        assert '游客' not in t2
        pg.screenshot(path=f'{OUT}/hot-guest-lang-081.png')

        b.close()


if __name__ == '__main__':
    main()

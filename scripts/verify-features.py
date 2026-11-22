"""功能面盘点：把 README「能做什么」里的每一项，在真实界面上找一个可见入口/控件。

不是快照比对，是**可执行的存在性断言**：少一个入口就报出它的名字。
跑法：
    pnpm build && npx vite preview --port 4173
    xvfb-run -a python3 scripts/verify-features.py

口径：只看界面（文案 / aria-label / 占位符 / 分组标题），不看源码常量 ——
功能写在代码里但入口被删掉，对用户来说就是"功能没了"。
"""
import importlib.util
import os
import re

from playwright.sync_api import sync_playwright

OUT = '/workspace/ghx/docs/screenshots'
BASE = 'http://127.0.0.1:4173/'

_here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('va', os.path.join(_here, 'verify-apkstore.py'))
va = importlib.util.module_from_spec(spec)
spec.loader.exec_module(va)

results = []


def need(surface, label, ok, detail=''):
    results.append((surface, label, bool(ok), detail))
    if not ok:
        print(f'  ✗ [{surface}] 缺：{label} {detail}')


def texts(pg, sel):
    return [t.strip() for t in pg.locator(sel).all_inner_texts()]


def home(pg):
    """把路由栈退回首页：连按 Esc 直到头像按钮重新出现，再切回仓库页签。"""
    for _ in range(8):
        if pg.locator('.avatar-btn').count() > 0 and pg.locator('.avatar-btn').first.is_visible():
            break
        pg.keyboard.press('Escape')
        pg.wait_for_timeout(350)
    pg.click('.tabbar button:has-text("仓库")')
    pg.wait_for_timeout(500)
    pg.wait_for_selector('.rows .row', timeout=10000)


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch(
            headless=False, args=['--no-sandbox', '--hide-scrollbars', '--force-color-profile=srgb']
        )
        pg, errors = va.new_page(b)
        # new_page 收尾切到了热门页；盘点从仓库页开始
        pg.click('.tabbar button:has-text("仓库")')
        pg.wait_for_selector('.rows .row', timeout=20000)
        pg.wait_for_timeout(600)

        # ── 1. 底栏页签 ──
        tabs = texts(pg, '.tabbar .tab-label')
        for t in ('仓库', '星标', '热门'):
            need('底栏', t, t in tabs, str(tabs))

        # ── 2. 仓库页 ──
        labels = pg.evaluate(
            "() => [...document.querySelectorAll('.topbar button')].map(b => b.getAttribute('aria-label'))"
        )
        for l in ('打开个人页', '通知', '刷新', '新建仓库', '批量选择'):
            need('仓库页', l, l in labels, str(labels))
        need('仓库页', '搜索仓库名或描述', pg.locator('input[placeholder="搜索仓库名或描述"]').count() > 0)
        seg = texts(pg, '.segrow .seg button')
        need('仓库页', '公开/私有筛选', any('公开' in s for s in seg), str(seg))
        need('仓库页', '排序入口', pg.locator('button[aria-label="排列方式"]').count() > 0, str(seg))
        need('仓库页', '仓库行', pg.locator('.rows .row').count() > 0)
        need('仓库页', '行内 Star 按钮', pg.locator('.row-star').count() > 0)
        need('仓库页', '置顶按钮', pg.locator('[aria-label="置顶"], [aria-label="取消置顶"]').count() > 0)

        # ── 3. 批量选择（多选后出现操作条） ──
        pg.click('button[aria-label="批量选择"]')
        pg.wait_for_timeout(300)
        pg.locator('.rows .row').first.click()
        pg.wait_for_timeout(400)
        batch = pg.inner_text('body')
        need('批量操作', '转私有/转公开', '转私有' in batch and '转公开' in batch, batch[:80])
        pg.locator('.actionbar button', has_text='更多').click()
        pg.wait_for_timeout(500)
        more = pg.inner_text('body')
        for item in ('归档', '话题'):
            need('批量操作', item, item in more, more[:100])
        pg.keyboard.press('Escape')
        pg.wait_for_timeout(400)
        pg.click('button[aria-label="批量选择"]')
        pg.wait_for_timeout(300)

        # ── 4. 我的 ──
        pg.click('.avatar-btn')
        pg.wait_for_selector('.linkrow', timeout=8000)
        pg.wait_for_timeout(400)
        mine = pg.inner_text('body')
        for item in ('通知', '全局搜索', '我的主页', '数据看板', 'Gist 片段', '令牌保险库', '设置', '审计日志', '检查更新', '锁定'):
            need('我的', item, item in mine)
        pg.screenshot(path=f'{OUT}/features-profile.png')

        # ── 5. 设置 ──
        pg.locator('.linkrow', has_text='设置').first.click()
        pg.wait_for_timeout(700)
        secs = texts(pg, '.section-title')
        for s in ('外观', '翻译', '账号与网络', '打开方式', '安全', '版本与更新', '本机数据'):
            need('设置', s, s in secs, str(secs))
        st = pg.inner_text('body')
        for item in ('强调色', '玻璃', '动效', '译成', '翻译哪些内容', '翻译通道', '主题', '底栏'):
            need('设置·外观/翻译', item, item in st)
        for item in ('看板', '流水线'):
            need('设置·底栏页签', item, item in st)
        pg.screenshot(path=f'{OUT}/features-settings.png')
        home(pg)

        # ── 6. 热门页 ──
        pg.click('.tabbar button:has-text("热门")')
        pg.wait_for_timeout(800)
        hot_labels = pg.evaluate(
            "() => [...document.querySelectorAll('.topbar button')].map(b => b.getAttribute('aria-label'))"
        )
        need('热门', 'APK 商店入口', 'APK 商店' in hot_labels, str(hot_labels))
        need('热门', '刷新', '刷新' in hot_labels)
        need('热门', '搜索框', pg.locator('input[placeholder*="topic:"]').count() > 0)
        hseg = texts(pg, '.seg button')
        for t in ('今日', '本周', '本月'):
            need('热门', t, t in hseg, str(hseg))
        need('热门', '语言筛选', pg.locator('.chips button, .lang-row button').count() > 0)
        pg.screenshot(path=f'{OUT}/features-hot.png')

        # ── 7. APK 商店：单列 ──
        pg.click('button[aria-label="APK 商店"]')
        pg.wait_for_selector('.shop-card:not(.shop-skel)', timeout=10000)
        pg.wait_for_timeout(500)
        cols = pg.evaluate(
            """() => {
              const g = document.querySelector('.shop-grid');
              const cards = [...g.querySelectorAll('.shop-card:not(.shop-skel)')];
              return {
                display: getComputedStyle(g).display,
                dir: getComputedStyle(g).flexDirection,
                widths: cards.slice(0, 3).map(c => Math.round(c.getBoundingClientRect().width)),
                gridW: Math.round(g.getBoundingClientRect().width),
                overflow: document.documentElement.scrollWidth <= innerWidth + 1,
                tabs: [...document.querySelectorAll('.shop-tab')].length,
              };
            }"""
        )
        need('商店', '单列（卡片占满行）', cols['widths'] and all(abs(w - cols['gridW']) <= 2 for w in cols['widths']), str(cols))
        need('商店', '平台筛选 tabs', cols['tabs'] == 5, str(cols['tabs']))
        need('商店', '页面不横向溢出', cols['overflow'], str(cols))
        pg.screenshot(path=f'{OUT}/features-store.png')
        pg.keyboard.press('Escape')
        pg.wait_for_timeout(500)

        # ── 8. 星标 ──
        pg.click('.tabbar button:has-text("星标")')
        pg.wait_for_timeout(900)
        star_txt = pg.inner_text('body')
        need('星标', '搜索', pg.locator('input[placeholder*="搜索"]').count() > 0)
        need('星标', '语言分类', '语言' in star_txt or pg.locator('.chips button').count() > 0)

        # ── 9. 仓库详情入口 ──
        pg.click('.tabbar button:has-text("仓库")')
        pg.wait_for_selector('.rows .row', timeout=10000)
        pg.wait_for_timeout(400)
        pg.locator('.rows .row').first.click()
        pg.wait_for_timeout(900)
        det = pg.inner_text('body')
        for item in ('Star', '归档', '转为私有', '仓库主页', '项目自述', '工作流', '发行版', '复刻',
                     '复制仓库地址', '下载源码', '删除仓库'):
            need('仓库详情', item, item in det, det[:120])
        pg.screenshot(path=f'{OUT}/features-detail.png')
        pg.keyboard.press('Escape')
        pg.wait_for_timeout(600)

        # ── 10. 全局搜索六类 ──
        pg.click('.avatar-btn')
        pg.wait_for_selector('.linkrow', timeout=8000)
        pg.locator('.linkrow', has_text='全局搜索').first.click()
        pg.wait_for_timeout(800)
        sseg = texts(pg, '.chips .chip')
        for t in ('仓库', '代码', 'Issue', 'PR', '用户', '提交'):
            need('全局搜索', t, t in sseg, str(sseg))
        home(pg)

        # ── 11. 通知 ──
        pg.click('.avatar-btn')
        pg.wait_for_selector('.linkrow', timeout=8000)
        pg.locator('.linkrow', has_text='通知').first.click()
        pg.wait_for_timeout(900)
        nt = pg.inner_text('body')
        need('通知', '未读/全部切换', '全部' in nt or '未读' in nt, nt[:80])
        home(pg)

        # ── 12. 数据看板 ──
        pg.click('.avatar-btn')
        pg.wait_for_selector('.linkrow', timeout=8000)
        pg.locator('.linkrow', has_text='数据看板').first.click()
        pg.wait_for_timeout(1200)
        need('看板', 'KPI 卡片', pg.locator('.dash-kpi-cell').count() >= 4, str(pg.locator('.dash-kpi-cell').count()))
        need('看板', '14/30/90 天', '90' in pg.inner_text('body'))
        pg.screenshot(path=f'{OUT}/features-dashboard.png')
        home(pg)

        # ── 13. Gist ──
        pg.click('.avatar-btn')
        pg.wait_for_selector('.linkrow', timeout=8000)
        pg.locator('.linkrow', has_text='Gist').first.click()
        pg.wait_for_timeout(900)
        need('Gist', '页面打开', 'Gist' in pg.inner_text('body'))

        b.close()

    ok = sum(1 for r in results if r[2])
    print()
    print(f'共 {len(results)} 项，通过 {ok} 项')
    surfaces = {}
    for s, l, good, d in results:
        surfaces.setdefault(s, [0, 0])
        surfaces[s][1] += 1
        surfaces[s][0] += 1 if good else 0
    for s, (g, t) in surfaces.items():
        print(f'  {s:<12} {g}/{t}')
    if ok != len(results):
        raise SystemExit(f'有 {len(results) - ok} 项功能入口不见了')
    print('全部功能入口在界面上都能点到')


if __name__ == '__main__':
    main()

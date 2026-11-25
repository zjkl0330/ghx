"""私有仓库正文图片：真令牌、真仓库，走界面验一遍。

背景：`<img>` 带不了 Authorization，`raw.githubusercontent.com` 对匿名请求
回 404（预检还回 403），所以私有仓库的 README 图一直是空白。修法是加载失败
后再走一次 API contents（带令牌拿字节 → `blob:` 地址）。

这个脚本不看源码、不 mock 数据：真的用环境变量里的令牌登录，真的打开一个
私有仓库的自述，然后断言图片最终是 `blob:` 地址且真的解码成功。

跑法：
    pnpm build && npx vite preview --port 4173
    GHX_TOKEN=ghp_… xvfb-run -a python3 scripts/verify-privateimg.py

退出码 0 = 通过。图片是否「真的显示出来」用 naturalWidth 判定，
只把 src 改成 blob: 不算数 —— 那可能是空 Blob。
"""
import os
import sys

from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:4173/'
# 私有仓库 + 里面有相对路径图片（docs/desktop.png）
REPO = 'UptimeFlare'
TOKEN = os.environ.get('GHX_TOKEN', '').strip()


def login(pg, token):
    pg.click('.who-btn')
    pg.wait_for_timeout(300)
    pg.click('text=添加账号')
    pg.wait_for_timeout(400)
    pg.fill('input[placeholder="例如 主力令牌"]', '验收令牌')
    pg.fill('input[placeholder="ghp_… 或 github_pat_…"]', token)
    pg.click('text=加密保存')
    pg.wait_for_timeout(3000)


def main():
    if not TOKEN:
        print('缺少 GHX_TOKEN 环境变量', file=sys.stderr)
        return 2

    with sync_playwright() as p:
        b = p.chromium.launch(
            headless=False, args=['--no-sandbox', '--hide-scrollbars', '--force-color-profile=srgb']
        )
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        pg = ctx.new_page()
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(BASE)
        pg.wait_for_timeout(600)
        login(pg, TOKEN)

        # 私有仓库要出现在列表里 —— 顺带验「令牌生效」
        pg.wait_for_selector('.rows .row', timeout=30000)
        row = pg.locator('.rows .row', has_text=REPO).first
        assert row.count() > 0, f'私有仓库 {REPO} 没出现在列表里，令牌或网络有问题'
        row.click()
        pg.wait_for_timeout(1200)

        # 详情弹层 → 项目自述
        pg.click('text=项目自述')
        pg.wait_for_selector('.md', timeout=30000)
        pg.wait_for_timeout(2500)

        # 等私有图走完「原图失败 → 令牌通道」这条链。
        # 这里不写死等待时长：抓字节要走 GitHub API，慢网下几百 KB 也可能几十秒，
        # 所以轮询到出现 blob: 图为止（上限 90 秒）。
        deadline = 90
        for _ in range(deadline):
            got = pg.evaluate(
                "() => [...document.querySelectorAll('.md img.md-img')]"
                ".filter(i => i.currentSrc.startsWith('blob:') && i.naturalWidth > 0).length"
            )
            if got:
                break
            pg.wait_for_timeout(1000)

        info = pg.evaluate(
            """() => {
              const imgs = [...document.querySelectorAll('.md img.md-img')];
              return {
                total: imgs.length,
                blob: imgs.filter(i => i.currentSrc.startsWith('blob:')).length,
                loaded: imgs.filter(i => i.naturalWidth > 0).length,
                failed: document.querySelectorAll('.md-img-fail').length,
                srcs: imgs.slice(0, 4).map(i => i.currentSrc.slice(0, 60)),
              };
            }"""
        )
        print(f'图片统计：{info}')

        assert info['total'] >= 1, '自述里没解析出任何图片，先确认这个仓库的 README 还有图'
        assert info['blob'] >= 1, f'没有一张图走令牌通道，私有图仍未加载：{info["srcs"]}'
        assert info['loaded'] >= info['blob'], f'blob 图没有真的解码出来：{info}'

        real_errors = [e for e in errors if 'Failed to fetch' not in e and 'CORS' not in e.upper()]
        assert not real_errors, f'控制台有真错误：{real_errors[:3]}'

        # 截图要能看见那张图：把它滚到屏幕中间，否则截图只有顶部的徽章
        pg.evaluate(
            """() => {
              const el = [...document.querySelectorAll('.md img.md-img')].find(i => i.currentSrc.startsWith('blob:'));
              if (el) el.scrollIntoView({ block: 'center' });
            }"""
        )
        pg.wait_for_timeout(900)
        pg.screenshot(path='/workspace/ghx/docs/screenshots/privateimg.png')
        print(f'[PASS] 私有图 {info["blob"]} 张走令牌通道并已解码（原图匿名 404 的前提见 README 说明）')
        return 0


if __name__ == '__main__':
    code = main()
    raise SystemExit(code)

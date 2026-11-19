"""验证自述里的链接渲染与正文对比度。

只做一件事：把一份「链接密度很高」的 README 灌进自述面板，然后断言
链接真的可点、真的是蓝色、表格没被吞掉，并留下两张截图。

    pnpm build
    npx vite preview --port 4173 &
    xvfb-run -a python3 scripts/verify-md.py
"""

import base64
import json
import os
import re

from playwright.sync_api import sync_playwright

OUT = '/workspace/ghx/docs/screenshots'
BASE = 'http://127.0.0.1:4173/'
OWNER = 'zjkl0330'

README = """# cn-math-taxonomy

数学教材知识图谱，覆盖初中七至九年级（统编版）。

商业授权：本项目采用 CC BY-NC 4.0，个人学习、教学、研究可免费使用；
商业使用需单独授权，请通过 [X 私信 @hassanyehiiaa](https://x.com/hassanyehiiaa)、
邮箱 [499749204@qq.com](mailto:499749204@qq.com) 或在**本仓库** [提交 Issue](https://github.com/zjkl0330/ghx/issues) 联系。

→ [在线试用诊断（演示：配方法）](https://math.pansgo.com) · [首页](https://zjkl.dpdns.org) · [知识图谱](https://zjkl.dpdns.org/graph) · [GitHub Pages 备份](https://zjkl0330.github.io/cn-math-taxonomy/)

## 目录结构

| 目录 | 内容 | 说明 |
|---|---|---|
| `math/` | 公式与推导 | 见 [公式说明](docs/formula.md) |
| `docs/` | 文档 | [本地文档](docs/guide.md) · [相对路径](../LICENSE) |
| `web/` | 前端 | 使用 `pnpm build` 构建 |

## 快速开始

1. 克隆仓库，执行 `pnpm install`
2. 运行 `pnpm dev`，打开 <https://localhost:5173>
3. 遇到问题看 [常见问题](docs/faq.md#安装失败)

> 提示：数据源来自 [教材原文](https://github.com/zjkl0330/ghx/blob/main/data/book.md)，**请勿商用**。

### 安装失败

检查 Node 版本，参考 [安装说明](#快速开始)。
"""


def main():
    os.makedirs(OUT, exist_ok=True)
    content = base64.b64encode(README.encode()).decode()

    repo = {
        'id': 1,
        'name': 'cn-math-taxonomy',
        'full_name': f'{OWNER}/cn-math-taxonomy',
        'owner': {'login': OWNER, 'avatar_url': ''},
        'private': False,
        'visibility': 'public',
        'archived': False,
        'disabled': False,
        'description': '初中数学知识图谱，按教材章节组织。',
        'language': 'TypeScript',
        'stargazers_count': 12,
        'forks_count': 2,
        'open_issues_count': 0,
        'pushed_at': '2026-11-16T09:12:00Z',
        'updated_at': '2026-11-16T09:12:00Z',
        'created_at': '2026-01-12T08:00:00Z',
        'default_branch': 'main',
        'permissions': {'admin': True, 'maintain': True, 'push': True, 'pull': True},
    }
    user = {
        'login': OWNER, 'id': 1, 'name': '指尖可乐', 'type': 'User',
        'avatar_url': '', 'html_url': f'https://github.com/{OWNER}',
        'public_repos': 10, 'public_gists': 0, 'followers': 128, 'following': 12,
        'bio': '白天上学，晚上折腾自托管。', 'company': None, 'location': '江西 吉安',
        'blog': None, 'twitter_username': None, 'created_at': '2025-03-01T08:00:00Z',
    }
    readme_file = {
        'name': 'README.md', 'path': 'README.md', 'sha': 'a' * 40, 'size': len(README),
        'content': content, 'encoding': 'base64',
        'html_url': f'https://github.com/{OWNER}/cn-math-taxonomy/blob/main/README.md',
    }

    def handle(route):
        url = route.request.url
        path = re.sub(r'^https://api\.github\.com', '', url).split('?')[0]
        if path == '/user':
            body = user
        elif path == '/user/repos':
            body = [repo]
        elif path in ('/user/starred', '/notifications'):
            body = []
        elif path == f'/repos/{OWNER}/cn-math-taxonomy/readme':
            body = readme_file
        elif path == '/rate_limit':
            body = {'resources': {'core': {'limit': 5000, 'remaining': 4871, 'reset': 1793800000}}}
        elif path.startswith('/repos/'):
            body = repo
        else:
            body = {}
        route.fulfill(
            status=200,
            content_type='application/json',
            headers={
                'x-ratelimit-limit': '5000',
                'x-ratelimit-remaining': '4871',
                'x-ratelimit-reset': '1793800000',
                'x-oauth-scopes': 'repo, read:user, workflow, notifications',
                'access-control-expose-headers': (
                    'x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset, '
                    'x-oauth-scopes, link, etag'
                ),
            },
            body=json.dumps(body),
        )

    with sync_playwright() as pw:
        b = pw.chromium.launch(
            headless=False,
            args=['--no-sandbox', '--force-color-profile=srgb', '--hide-scrollbars'],
        )
        pg = b.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        pg.emulate_media(color_scheme='light')
        pg.route('**/api.github.com/**', handle)
        pg.route(re.compile(r'.*\.(png|jpg|jpeg|svg|webp)(\?.*)?$'), lambda r: r.continue_())
        pg.goto(BASE)
        pg.wait_for_timeout(700)

        pg.click('.who-btn')
        pg.wait_for_timeout(300)
        pg.click('text=添加账号')
        pg.wait_for_timeout(400)
        pg.fill('input[placeholder="例如 主力令牌"]', '主力令牌')
        pg.fill('input[placeholder="ghp_… 或 github_pat_…"]', 'ghp_' + 'x' * 36)
        pg.click('text=加密保存')
        pg.wait_for_timeout(3500)

        pg.click('.rows button.row')
        pg.wait_for_timeout(1200)
        pg.click('text=项目自述')
        pg.wait_for_timeout(1500)

        # 断言 1：链接真的被渲染成可点元素
        links = pg.locator('.md .md-link')
        n_links = links.count()
        assert n_links >= 6, f'链接数量偏少：{n_links}'

        # 断言 2：颜色是主体蓝色，且带下划线
        style = links.first.evaluate(
            "el => { const s = getComputedStyle(el); return { color: s.color, deco: s.textDecorationLine } }"
        )
        assert style['deco'] == 'underline', f'缺下划线：{style}'
        assert style['color'] != 'rgb(0, 0, 0)', f'颜色没生效：{style}'

        # 断言 3：表格没被吞（之前的 renderBlock 没有 table 分支）
        tables = pg.locator('.md .md-table').count()
        assert tables == 1, f'表格没渲染：{tables}'

        # 断言 3b：表格格子里的行内代码也走了富文本，不是干巴巴的纯文字
        cell_code = pg.locator('.md .md-table .md-icode').count()
        assert cell_code >= 1, f'表格里的行内代码没渲染：{cell_code}'
        # 断言 3c：表格里的链接同样可点
        cell_links = pg.locator('.md .md-table .md-link').count()
        assert cell_links >= 2, f'表格里的链接没渲染：{cell_links}'

        # 断言 4：点外链会走 window.open，地址与原文一致
        pg.evaluate("window.__opened = []; window.open = (u) => { window.__opened.push(u); return null }")
        links.nth(0).click()
        pg.wait_for_timeout(300)
        opened = [u for u in pg.evaluate('window.__opened') if u]
        assert opened == ['https://x.com/hassanyehiiaa'], f'打开地址不对：{opened}'

        # 断言 5：正文颜色比旧版更黑（深灰 → 近黑）
        body_color = pg.locator('.md').evaluate('el => getComputedStyle(el).color')
        num = [int(x) for x in re.findall(r'\d+', body_color)[:3]]
        assert max(num) <= 66, f'正文仍然偏灰：{body_color}'

        pg.screenshot(path=f'{OUT}/md-links-079.png')

        # 锚点跳转
        pg.locator('.md .md-link', has_text='安装说明').first.click()
        pg.wait_for_timeout(600)
        pg.screenshot(path=f'{OUT}/md-anchor-079.png')

        pg.emulate_media(color_scheme='dark')
        pg.wait_for_timeout(500)
        pg.screenshot(path=f'{OUT}/md-links-dark-079.png')

        print('OK links=%d tables=%d color=%s opened=%s' % (n_links, tables, style['color'], opened[0][:60]))
        b.close()


if __name__ == '__main__':
    main()

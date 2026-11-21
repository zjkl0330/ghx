"""验证自述链接三连 bug 的修复（v0.9.6）。

用户报的三个问题，这里各对应一组断言：
1. 参考式链接（[文字][ref] + 文末 [ref]: url）不再变成纯文字，定义行不再原样吐 URL；
2. 机翻之后的译文里链接仍然可点（占位符方案：⟦标签⟧ 按出现顺序回填）；
3. GitHub 链接在 App 内打开（收弹层、压路由），只有非 GitHub 站才跳外部浏览器。

    pnpm build
    npx vite preview --port 4173 &
    xvfb-run -a python3 scripts/verify-trlink.py
"""

import base64
import json
import os
import re

from playwright.sync_api import sync_playwright

OUT = '/workspace/ghx/docs/screenshots'
BASE = 'http://127.0.0.1:4173/'
OWNER = 'zjkl0330'
REPO = 'ref-link-repo'

README = """# ref-link-repo

See the [distribution guide][] and [code signing policy][] for details.

More channels: [windows store][store], [play store][store2]. Read the [release notes](https://github.com/zjkl0330/ref-link-repo/releases) first.

Browse the [docs folder](https://github.com/zjkl0330/ref-link-repo/tree/main/docs) and the [author page](https://github.com/someone).

External site: [homepage](https://example.com).

[distribution guide]: https://github.com/zjkl0330/ref-link-repo/blob/main/DISTRIBUTION.md
[code signing policy]: https://github.com/zjkl0330/ref-link-repo/blob/main/CODE_SIGNING.md
[store]: https://www.microsoft.com/store/apps/1
[store2]: https://play.google.com/store/apps/2
"""

GL, GR = '\u27E6', '\u27E7'

repo = {
    'id': 1,
    'name': REPO,
    'full_name': f'{OWNER}/{REPO}',
    'owner': {'login': OWNER, 'avatar_url': ''},
    'private': False,
    'visibility': 'public',
    'archived': False,
    'disabled': False,
    'description': '参考式链接密集的示例仓库。',
    'language': 'TypeScript',
    'stargazers_count': 12,
    'forks_count': 2,
    'open_issues_count': 0,
    'pushed_at': '2026-11-21T09:12:00Z',
    'updated_at': '2026-11-21T09:12:00Z',
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
    'content': base64.b64encode(README.encode()).decode(), 'encoding': 'base64',
    'html_url': f'https://github.com/{OWNER}/{REPO}/blob/main/README.md',
}


def edge_mock(route):
    """Edge 翻译端点：标签随 token 一起被翻，其余段落给固定译文。"""
    try:
        items = json.loads(route.request.post_data or '[]')
    except Exception:
        items = []
    out = []
    for t in items:
        t = t.replace('distribution guide', '发行指南').replace('code signing policy', '代码签名策略')
        if 'More channels' in t:
            t = '更多渠道：微软商店与 Play 商店。请先阅读发行说明。'
        elif 'docs folder' in t:
            t = '浏览文档目录与作者主页。'
        elif 'External site' in t:
            t = '外站：主页。'
        elif 'See the' in t:
            t = '详情' + t.replace('See the ', '').replace(' and ', ' 与 ')
        out.append(t)
    route.fulfill(
        status=200,
        content_type='application/json',
        body=json.dumps([{'translations': [{'text': t, 'to': 'zh-CN'}]} for t in out]),
    )


def handle(route):
    url = route.request.url
    path = re.sub(r'^https://api\.github\.com', '', url).split('?')[0]
    if path == '/user':
        body = user
    elif path == '/user/repos':
        body = [repo]
    elif path in ('/user/starred', '/notifications'):
        body = []
    elif path == f'/repos/{OWNER}/{REPO}/readme':
        body = readme_file
    elif path == '/rate_limit':
        body = {'resources': {'core': {'limit': 5000, 'remaining': 4871, 'reset': 1793800000}}}
    elif '/contents/' in path:
        # 自带的中文版 README 一律找不到 → 走机翻；代码页目录给一个文件
        body = []
        status = 404
        route.fulfill(status=status, content_type='application/json', body=json.dumps(body), headers={
            'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4871', 'x-ratelimit-reset': '1793800000',
            'x-oauth-scopes': 'repo, read:user, workflow, notifications',
            'access-control-expose-headers': 'x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset, x-oauth-scopes, link, etag',
        })
        return
    else:
        body = repo
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


def ext_urls(pg):
    return pg.evaluate('() => window.__ext')


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as pw:
        b = pw.chromium.launch(
            headless=False,
            args=['--no-sandbox', '--force-color-profile=srgb', '--hide-scrollbars'],
        )
        pg = b.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        pg.emulate_media(color_scheme='light')
        pg.route('**/api.github.com/**', handle)
        pg.route('**/edge.microsoft.com/translate/translatetext**', edge_mock)
        pg.route(re.compile(r'.*\.(png|jpg|jpeg|svg|webp)(\?.*)?$'), lambda r: r.continue_())

        # window.open 记录下来：外部跳转的探针
        pg.add_init_script(
            "window.__ext = [];"
            "window.open = (u) => { window.__ext.push(String(u)); return null };"
        )
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
        pg.wait_for_timeout(1000)
        # 自动翻译：等译文出现（缓存为空，会真的打到 mock 的 Edge 端点）
        try:
            pg.wait_for_selector('.md .md-link >> text=发行指南', timeout=15000)
        except Exception:
            print('诊断：md=', pg.evaluate("() => document.querySelector('.md')?.textContent?.slice(0, 200)"))
            print('诊断：links=', pg.evaluate("() => [...document.querySelectorAll('.md .md-link')].map(b => b.textContent)"))
            print('诊断：seg=', pg.evaluate("() => [...document.querySelectorAll('.seg button')].map(b => b.className + ':' + b.textContent)"))
            raise
        pg.wait_for_selector('.md .md-link', timeout=8000)
        pg.wait_for_timeout(600)

        # ── 断言 1：译文里链接活着，标签是译文 ──
        zh_links = pg.evaluate(
            """() => [...document.querySelectorAll('.md .md-link')].map(b => b.textContent)"""
        )
        assert '发行指南' in zh_links, f'译文里参考式链接丢了：{zh_links}'
        assert '代码签名策略' in zh_links, f'译文里第二个链接丢了：{zh_links}'
        print(f'[1] 译文视图链接存活：{zh_links}')

        # ── 断言 2：点 GitHub 链接 → App 内打开（无外部跳转、弹层收起、进入代码页） ──
        pg.click('.md .md-link >> text=发行指南')
        pg.wait_for_timeout(1200)
        ext = ext_urls(pg)
        assert ext == [], f'GitHub 链接不该跳外部：{ext}'
        assert pg.evaluate("() => !document.querySelector('.sheet')"), '弹层没收起'
        top = pg.evaluate("() => document.querySelector('.topbar')?.textContent ?? ''")
        assert 'DISTRIBUTION' in top, f'没进到 App 内代码页：{top!r}'
        pg.screenshot(path=f'{OUT}/trlink-096-inapp.png')
        print(f'[2] GitHub 链接 App 内打开：topbar={top!r}，外部跳转={ext}')
        pg.evaluate("() => window.__ext = []")

        # reload 重进（App 的返回栈不经过浏览器 history；localStorage 保留了账号与译文缓存）
        pg.goto(BASE)
        pg.wait_for_timeout(1500)
        pg.click('.rows button.row')
        pg.wait_for_timeout(1200)
        pg.click('text=项目自述')
        pg.wait_for_timeout(1200)
        # 缓存命中，应直接落在译文视图；先等稳定再切「原文」
        pg.wait_for_selector('.md .md-link >> text=发行指南', timeout=10000)
        pg.click('.seg button:has-text("原文")')
        pg.wait_for_timeout(800)

        # ── 断言 3：原文里参考式链接可点、定义行不再吐 URL ──
        src_links = pg.evaluate(
            """() => [...document.querySelectorAll('.md .md-link')].map(b => ({ t: b.textContent, ti: b.title }))"""
        )
        n_ref = sum(1 for l in src_links if l['ti'].endswith('DISTRIBUTION.md') or l['ti'].endswith('CODE_SIGNING.md'))
        assert n_ref >= 2, f'参考式链接没有渲染成链接：{src_links}'
        body_text = pg.evaluate("() => document.querySelector('.md')?.textContent ?? ''")
        assert '[distribution guide]:' not in body_text, '定义行被当成正文吐出来了'
        assert 'https://www.microsoft.com' not in body_text, '定义行里的 URL 泄漏进正文'
        assert 'windows store' in body_text, '链接文字丢了'
        print(f'[3] 原文视图：参考式链接 {n_ref} 条可点，定义行已剔除')

        # ── 断言 4：外站链接仍然原样外开（不能被 GitHub 规则误吞） ──
        pg.evaluate("() => window.__ext = []")
        pg.click('.md .md-link[title*="example.com"]')
        pg.wait_for_timeout(600)
        ext = ext_urls(pg)
        assert ext == ['https://example.com'], f'外站链接应原样跳外部：{ext}'
        print('[4] 外站链接原样走外部')

        # ── 断言 5：App 没有的页面（releases）→ 站内说明页，绝不外跳 ──
        # 说明页是压栈的，点完这一页就离开自述，所以放最后一段
        pg.evaluate("() => window.__ext = []")
        pg.click('.md .md-link[title*="releases"]')
        pg.wait_for_timeout(700)
        ext = ext_urls(pg)
        assert ext == [], f'GitHub 链接不该再踢去浏览器：{ext}'
        title = pg.evaluate("() => (document.querySelector('.page-title') || {}).textContent || ''")
        assert title == 'App 内暂缺此页', f'releases 没进站内说明页：{title!r}'
        print('[5] 无 App 内页面的 GitHub 链接 → 站内说明页（未外跳）')

        pg.screenshot(path=f'{OUT}/trlink-096-source.png')
        b.close()
        print('全部通过')


if __name__ == '__main__':
    main()

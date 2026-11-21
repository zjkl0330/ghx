"""验证「该留在 App 里的跳转不会再跳去浏览器」（v1.0.2）。

用户的说法是「部分跳转还是跳转到网址而不是留在网站里」。逐个点下来，
漏的是这几处 —— 它们都能渲染 Markdown，却没把 GitHub 链接接进 App 路由：

  · Issue 正文与评论（MarkdownView 没传 ctx / onRoute）
  · PR 描述与审核意见（同上）
  · 通知直读面板的评论（同上）
  · 个人主页自述（有 ctx，但没传 onRoute）
  · 仓库详情简介里的 URL（SpanText 没有 ctx 时只能外开）

要证：
  1. 简介里的 github.com 链接 → App 内仓库页，window.open 没被调用；
  2. Issue 正文里的 blob 链接 → App 内代码页；
  3. Issue 正文里的 issue 链接 → App 内 #2；
  4. 对照组：releases 链接 App 没有页面，仍然交系统浏览器（不能误吞）；
  5. 通知评论里的链接 → App 内代码页；
  6. 主页自述里的链接 → App 内仓库页。

    pnpm build && npx vite preview --port 4173
    xvfb-run -a python3 scripts/verify-applinks.py
"""

import base64
import json
import os
import re

from playwright.sync_api import sync_playwright

OUT = '/workspace/ghx/docs/screenshots'
BASE = 'http://127.0.0.1:4173/'
OWNER = 'zjkl0330'
REPO = 'ghx'

ISSUE_BODY = """修了一个跳转问题，细节在 [src/index.ts](https://github.com/O/R/blob/main/src/index.ts)。

同一个问题也见 [issue 2](https://github.com/O/R/issues/2)，版本说明在 [发行页](https://github.com/O/R/releases)。
""".replace('O', OWNER).replace('R', REPO)

COMMENT_BODY = '补充一处 [实现](./src/index.ts) 与 [上游](https://github.com/O/R/pull/7)。'.replace(
    'O', OWNER
).replace('R', REPO)

DESC = f'一个用来验证站内跳转的仓库，源码见 https://github.com/{OWNER}/{REPO}/blob/main/src/index.ts 。'

repo = {
    'id': 1,
    'name': REPO,
    'full_name': f'{OWNER}/{REPO}',
    'owner': {'login': OWNER, 'avatar_url': ''},
    'private': False,
    'visibility': 'public',
    'archived': False,
    'disabled': False,
    'description': DESC,
    'language': 'TypeScript',
    'stargazers_count': 12,
    'forks_count': 2,
    'open_issues_count': 2,
    'pushed_at': '2026-11-21T09:12:00Z',
    'updated_at': '2026-11-21T09:12:00Z',
    'created_at': '2026-01-12T08:00:00Z',
    'default_branch': 'main',
    'permissions': {'admin': True, 'maintain': True, 'push': True, 'pull': True},
}

user = {
    'login': OWNER, 'id': 1, 'name': '指尖可乐', 'type': 'User',
    'avatar_url': '', 'html_url': f'https://github.com/{OWNER}',
    'public_repos': 1, 'public_gists': 0, 'followers': 128, 'following': 12,
    'bio': '白天上学，晚上折腾自托管。', 'company': None, 'location': None,
    'blog': None, 'twitter_username': None, 'created_at': '2025-03-01T08:00:00Z',
}

issue1 = {
    'number': 1,
    'title': '正文里的链接应该留在 App 里',
    'state': 'open',
    'state_reason': None,
    'body': ISSUE_BODY,
    'user': {'login': OWNER, 'avatar_url': ''},
    'labels': [],
    'assignees': None,
    'comments': 1,
    'created_at': '2026-11-20T08:00:00Z',
    'updated_at': '2026-11-20T08:00:00Z',
    'closed_at': None,
    'html_url': f'https://github.com/{OWNER}/{REPO}/issues/1',
}

issue2 = {
    **issue1,
    'number': 2,
    'title': '第二条 Issue',
    'body': '只是为了验证 #2 能被点开。',
    'comments': 0,
    'html_url': f'https://github.com/{OWNER}/{REPO}/issues/2',
}

comment = {
    'id': 55,
    'body': COMMENT_BODY,
    'user': {'login': 'octocat', 'avatar_url': ''},
    'created_at': '2026-11-20T09:00:00Z',
    'updated_at': '2026-11-20T09:00:00Z',
}

pr = {
    'number': 3,
    'title': '描述里的链接也该留在 App 里',
    'state': 'open',
    'draft': False,
    'merged': False,
    'merged_at': None,
    'mergeable': True,
    'mergeable_state': 'clean',
    'body': '改了 [入口](https://github.com/O/R/blob/main/src/index.ts)，关联 [issue 2](https://github.com/O/R/issues/2)。'.replace('O', OWNER).replace('R', REPO),
    'user': {'login': OWNER, 'avatar_url': ''},
    'labels': [],
    'assignees': None,
    'milestone': None,
    'head': {'ref': 'feat', 'sha': 'c' * 40, 'label': f'{OWNER}:feat'},
    'base': {'ref': 'main', 'sha': 'd' * 40, 'label': f'{OWNER}:main'},
    'commits': 0,
    'additions': 1,
    'deletions': 0,
    'changed_files': 1,
    'created_at': '2026-11-20T08:00:00Z',
    'updated_at': '2026-11-20T08:00:00Z',
    'html_url': f'https://github.com/{OWNER}/{REPO}/pull/3',
    'requested_reviewers': None,
}

review = {
    'id': 91,
    'state': 'COMMENTED',
    'body': '审核意见里也带一个 [链接](https://github.com/O/R/issues/2)。'.replace('O', OWNER).replace('R', REPO),
    'user': {'login': 'octocat', 'avatar_url': ''},
    'submitted_at': '2026-11-20T09:00:00Z',
}

thread = {
    'id': '77',
    'unread': True,
    'reason': 'comment',
    'updated_at': '2026-11-20T09:00:00Z',
    'subject': {
        'title': '正文里的链接应该留在 App 里',
        'type': 'Issue',
        'url': f'https://api.github.com/repos/{OWNER}/{REPO}/issues/1',
        'latest_comment_url': f'https://api.github.com/repos/{OWNER}/{REPO}/issues/comments/55',
    },
    'repository': {
        'id': 1,
        'name': REPO,
        'full_name': f'{OWNER}/{REPO}',
        'owner': {'login': OWNER},
        'private': False,
    },
}

README = """# ghx

一个 GitHub 客户端。自述里的链接也要留在 App 里：[源码目录](https://github.com/O/R/tree/main/src)。
""".replace('O', OWNER).replace('R', REPO)

readme_file = {
    'name': 'README.md', 'path': 'README.md', 'sha': 'a' * 40, 'size': len(README),
    'content': base64.b64encode(README.encode()).decode(), 'encoding': 'base64',
    'html_url': f'https://github.com/{OWNER}/{REPO}/blob/main/README.md',
}

HEADERS = {
    'x-ratelimit-limit': '5000',
    'x-ratelimit-remaining': '4871',
    'x-ratelimit-reset': '1793800000',
    'x-oauth-scopes': 'repo, read:user, workflow, notifications',
    'access-control-expose-headers': (
        'x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset, '
        'x-oauth-scopes, link, etag'
    ),
}


def ok(route, body, status=200):
    route.fulfill(
        status=status,
        content_type='application/json',
        headers=HEADERS,
        body=json.dumps(body),
    )


def handle(route):
    url = route.request.url
    path = re.sub(r'^https://api\.github\.com', '', url).split('?')[0]
    prefix = f'/repos/{OWNER}/{REPO}'

    if path == '/user':
        return ok(route, user)
    if path == '/user/repos':
        return ok(route, [repo])
    if path in ('/user/starred', '/notifications'):
        return ok(route, [thread] if path == '/notifications' else [])
    if path == '/rate_limit':
        return ok(route, {'resources': {'core': {'limit': 5000, 'remaining': 4871, 'reset': 1793800000}}})
    if path == f'{prefix}/readme':
        return ok(route, readme_file)
    if re.match(rf'^{prefix}/issues/\d+/comments$', path):
        return ok(route, [comment])
    if re.match(rf'^{prefix}/issues/\d+$', path):
        n = int(path.rsplit('/', 1)[1])
        return ok(route, issue1 if n == 1 else issue2)
    if path == f'{prefix}/issues':
        return ok(route, [issue1, issue2])
    if path == f'{prefix}/pulls':
        return ok(route, [pr])
    if path == f'{prefix}/pulls/3':
        return ok(route, pr)
    if path == f'{prefix}/pulls/3/reviews':
        return ok(route, [review])
    if path in (f'{prefix}/pulls/3/commits', f'{prefix}/pulls/3/files'):
        return ok(route, [])
    if path == f'{prefix}/contents/src':
        return ok(route, [{
            'name': 'index.ts', 'path': 'src/index.ts', 'sha': 'b' * 40, 'size': 24,
            'type': 'file', 'html_url': f'https://github.com/{OWNER}/{REPO}/blob/main/src/index.ts',
        }])
    if path == f'{prefix}/contents/src/index.ts':
        code = 'export const hello = 1\n'
        return ok(route, {
            'name': 'index.ts', 'path': 'src/index.ts', 'sha': 'b' * 40, 'size': len(code),
            'type': 'file', 'encoding': 'base64',
            'content': base64.b64encode(code.encode()).decode(),
            'html_url': f'https://github.com/{OWNER}/{REPO}/blob/main/src/index.ts',
        })
    if path.startswith(f'{prefix}/contents') or path.startswith(f'{prefix}/git/'):
        return ok(route, [])
    if path == prefix:
        return ok(route, repo)
    if path == f'/users/{OWNER}':
        return ok(route, user)
    if path == f'/users/{OWNER}/repos':
        return ok(route, [])
    if path == f'/repos/{OWNER}/{OWNER}/readme':
        return ok(route, {**readme_file, 'path': 'README.md'})
    return ok(route, repo)


STATE = """() => ({
  ext: window.__ext.slice(),
  title: (document.querySelector('.page-title') || {}).textContent || '',
  sheet: !!document.querySelector('.sheet'),
  links: [...document.querySelectorAll('.md-link')].map(b => b.textContent),
  toast: (document.querySelector('.toast') || {}).textContent || '',
})"""


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as pw:
        b = pw.chromium.launch(
            headless=False,
            args=['--no-sandbox', '--force-color-profile=srgb', '--hide-scrollbars'],
        )
        pg = b.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        pg.emulate_media(color_scheme='light')
        errors = []
        noise = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        # 资源加载（加速站 raw / 头像 / 字体）不在本脚本的 mock 范围，单独归类：
        # 它们反映的是「测试环境没铺全线路」，不是页面逻辑坏了。JS 异常才算失败。
        pg.on('console', lambda m: noise.append(m.text) if m.type == 'error' else None)
        pg.route('**/api.github.com/**', handle)
        pg.route('**/edge.microsoft.com/translate/translatetext**',
                 lambda r: r.fulfill(status=200, content_type='application/json', body='[]'))
        pg.route(re.compile(r'.*\.(png|jpg|jpeg|svg|webp)(\?.*)?$'), lambda r: r.abort())
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

        # ── 1. 仓库详情简介里的 URL ──
        pg.click('.rows button.row')
        pg.wait_for_timeout(900)
        pg.wait_for_selector('.det-desc .md-link', timeout=8000)
        pg.click('.det-desc .md-link')
        pg.wait_for_timeout(1200)
        s = pg.evaluate(STATE)
        assert s['ext'] == [], f'简介链接跳去了浏览器：{s["ext"]}'
        assert s['title'] == 'index.ts', f'简介链接没进代码页，标题是 {s["title"]!r}'
        assert not s['sheet'], '进页面后详情弹层还盖着'
        print('✓ 详情简介 URL → App 内代码页')

        # ── 2. Issue 正文里的 blob 链接 ──
        pg.click('button[aria-label="返回"]')
        pg.wait_for_timeout(600)
        pg.click('.rows button.row')
        pg.wait_for_timeout(900)
        pg.click('.actrow:has-text("仓库主页")')
        pg.wait_for_timeout(900)
        pg.click('.seg button:has-text("Issues")')
        pg.wait_for_selector('.row.issue-row', timeout=10000)
        pg.click('.row.issue-row >> nth=0')
        pg.wait_for_selector('.md-link', timeout=10000)
        assert pg.locator('.md-link').count() >= 3, 'Issue 正文的链接没渲染出来'
        pg.click('.md-link:has-text("src/index.ts")')
        pg.wait_for_timeout(900)
        s = pg.evaluate(STATE)
        assert s['ext'] == [], f'Issue 正文链接跳去了浏览器：{s["ext"]}'
        assert s['title'] == 'index.ts', f'没进代码页，标题是 {s["title"]!r}'
        print('✓ Issue 正文 blob 链接 → App 内代码页')

        # ── 3. Issue 正文里的 issue 链接 ──
        pg.click('button[aria-label="返回"]')
        pg.wait_for_selector('.md-link', timeout=10000)
        pg.click('.md-link:has-text("issue 2")')
        pg.wait_for_timeout(900)
        s = pg.evaluate(STATE)
        assert s['ext'] == [], f'issue 链接跳去了浏览器：{s["ext"]}'
        assert s['title'] == '#2', f'没进 #2，标题是 {s["title"]!r}'
        print('✓ Issue 正文 issue 链接 → App 内 #2')

        # ── 4. App 没有的页面：站内说明页，绝不外跳 ──
        pg.click('button[aria-label="返回"]')
        pg.wait_for_selector('.md-link', timeout=10000)
        mark = len(pg.evaluate(STATE)['ext'])
        pg.click('.md-link:has-text("发行页")')
        pg.wait_for_timeout(800)
        s = pg.evaluate(STATE)
        assert len(s['ext']) == mark, f'releases 不该再踢去浏览器：{s["ext"]}'
        assert s['title'] == 'App 内暂缺此页', f'releases 没进站内说明页，标题是 {s["title"]!r}'
        assert not s['sheet'], '说明页不该再压着弹层'
        assert pg.locator('text=去仓库看看').count() > 0, '说明页缺少回仓库的入口'
        assert pg.locator('text=复制链接').count() > 0, '说明页缺少复制入口'
        pg.screenshot(path=f'{OUT}/v103-webonly.png')
        print('✓ 对照：releases → 站内说明页（未外跳）')

        # ── 4b. PR 描述与审核意见里的链接 ──
        # 现在停在站内说明页；先回 issue，再退仓库页，切到 PR 页签
        pg.click('button[aria-label="返回"]')
        pg.wait_for_selector('.md-link', timeout=10000)
        pg.click('button[aria-label="返回"]')
        pg.wait_for_selector('.row.issue-row', timeout=10000)
        pg.click('button[aria-label="返回"]')
        pg.wait_for_timeout(700)
        if pg.locator('.seg button:has-text("PR")').count() == 0:
            # 上一层是主界面（仓库页是从事详情弹层进的），重新走一遍
            pg.wait_for_selector('.rows button.row', timeout=10000)
            pg.click('.rows button.row')
            pg.wait_for_timeout(800)
            pg.click('.actrow:has-text("仓库主页")')
            pg.wait_for_timeout(900)
        pg.click('.seg button:has-text("PR")')
        pg.wait_for_selector('.row:has-text("描述里的链接")', timeout=10000)
        pg.click('.row:has-text("描述里的链接") >> nth=0')
        pg.wait_for_selector('.md-link', timeout=10000)
        mark = len(pg.evaluate(STATE)['ext'])
        pg.click('.md-link:has-text("issue 2")')
        pg.wait_for_timeout(900)
        s = pg.evaluate(STATE)
        assert len(s['ext']) == mark, f'PR 描述链接跳去了浏览器：{s["ext"]}'
        assert s['title'] == '#2', f'PR 描述链接没进 #2，标题是 {s["title"]!r}'
        print('✓ PR 描述链接 → App 内 #2')

        pg.click('button[aria-label="返回"]')
        pg.wait_for_selector('.md-link', timeout=10000)
        # 审核意见里的链接：往下滚到「审核」区
        mark = len(pg.evaluate(STATE)['ext'])
        pg.click('.comment .md-link >> nth=0')
        pg.wait_for_timeout(900)
        s = pg.evaluate(STATE)
        assert len(s['ext']) == mark, f'PR 审核意见链接跳去了浏览器：{s["ext"]}'
        assert s['title'] == '#2', f'PR 审核意见链接没进 #2，标题是 {s["title"]!r}'
        print('✓ PR 审核意见链接 → App 内 #2')

        # ── 5. 通知直读里的评论链接 ──
        # 现在停在 issue 1（返回两层：issue → issues 列表 → 仓库页 → 主界面）
        for _ in range(4):
            btn = pg.locator('button[aria-label="返回"]')
            if btn.count() == 0:
                break
            btn.first.click()
            pg.wait_for_timeout(500)
        pg.click('.bell-btn')
        pg.wait_for_selector('.notif-row', timeout=10000)
        pg.click('.notif-row .row-main >> nth=0')
        pg.wait_for_timeout(900)
        mark = len(pg.evaluate(STATE)['ext'])
        pg.click('.thread-list .md-link >> nth=0')
        pg.wait_for_timeout(900)
        s = pg.evaluate(STATE)
        assert len(s['ext']) == mark, f'通知评论链接跳去了浏览器：{s["ext"]}'
        assert s['title'] == 'index.ts', f'通知评论链接没进代码页，标题是 {s["title"]!r}'
        print('✓ 通知评论链接 → App 内代码页')

        # ── 6. 个人主页自述里的链接 ──
        # 回到主界面：通知页 → 主界面（返回一次），再点仓库行，从详情页 owner 进个人页
        for _ in range(5):
            if pg.locator('.rows button.row').count() > 0:
                break
            btn = pg.locator('button[aria-label="返回"]')
            if btn.count() == 0:
                break
            btn.first.click()
            pg.wait_for_timeout(500)
        pg.wait_for_selector('.rows button.row', timeout=10000)
        pg.click('.rows button.row')
        pg.wait_for_timeout(800)
        pg.click('.owner-link')
        pg.wait_for_selector('.preadme-body', timeout=12000)
        assert pg.locator('.preadme-body .md-link').count() > 0, '主页自述里的链接没渲染出来'
        mark = len(pg.evaluate(STATE)['ext'])
        pg.click('.preadme-body .md-link >> nth=0')
        pg.wait_for_timeout(900)
        s = pg.evaluate(STATE)
        assert len(s['ext']) == mark, f'主页自述链接跳去了浏览器：{s["ext"]}'
        assert s['title'] == 'src', f'主页自述链接没进代码页，标题是 {s["title"]!r}'
        print('✓ 主页自述链接 → App 内代码页')

        pg.screenshot(path=f'{OUT}/v102-applinks.png')
        if noise:
            print(f'（忽略 {len(noise)} 条资源加载噪音，例如 {noise[0][:80]}…）')
        assert not errors, f'console 有报错：{errors[:3]}'
        b.close()
        print('\n全部通过，截图 docs/screenshots/v102-applinks.png')


if __name__ == '__main__':
    main()

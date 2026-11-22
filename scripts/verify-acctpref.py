"""验证账号偏好：设置里的多账号开关 + 每账号现场落盘（v1.1.1）。

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

README = """# SoftEther VPN

An Open-Source Multi-protocol VPN Program
https://www.softether.org/

Stable Edition is available on
https://github.com/O/R/tree/stable
which the non-developer user can stable use.

[Icons8](https://icons8.com/) 🡒 generously supports this project with free licenses.
""".replace('O', OWNER).replace('R', REPO).replace('O', OWNER).replace('R', REPO)

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




STATE = """() => ({
  pref: localStorage.getItem('ghx.acct.pref'),
  ws: Object.keys(localStorage).filter((k) => k.startsWith('ghx.ws.')),
  hasRow: !!document.querySelector('.tglrow'),
})"""


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as pw:
        b = pw.chromium.launch(
            headless=False,
            args=['--no-sandbox', '--force-color-profile=srgb', '--hide-scrollbars'],
        )
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        pg = ctx.new_page()
        pg.emulate_media(color_scheme='light')
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.route('**/api.github.com/**', handle)
        pg.route('**/edge.microsoft.com/translate/translatetext**',
                 lambda r: r.fulfill(status=200, content_type='application/json', body='[]'))
        pg.route(re.compile(r'.*\.(png|jpg|jpeg|svg|webp)(\?.*)?$'), lambda r: r.abort())
        pg.goto(BASE)
        pg.wait_for_timeout(800)

        pg.click('.who-btn')
        pg.wait_for_timeout(300)
        pg.click('text=添加账号')
        pg.wait_for_timeout(400)
        pg.fill('input[placeholder="例如 主力令牌"]', '主力令牌')
        pg.fill('input[placeholder="ghp_… 或 github_pat_…"]', 'ghp_' + 'x' * 36)
        pg.click('text=加密保存')
        pg.wait_for_timeout(3500)

        # 进设置：头像 → 个人页 → 设置（加完账号可能已经停在个人页）
        if pg.locator('button:has-text("设置")').count() == 0:
            pg.click('.avatar-btn')
            pg.wait_for_timeout(800)
        pg.click('button:has-text("设置")')
        pg.wait_for_timeout(800)
        row = pg.locator('.tglrow:has-text("切回账号时接着上次看")')
        assert row.count() == 1, '设置里没有多账号开关'
        box = row.locator('input.tgl')
        assert box.is_checked(), '默认应勾选「接着上次看」'
        pg.screenshot(path=f'{OUT}/acctpref-111.png')
        s = pg.evaluate(STATE)
        assert s['pref'] is None or json.loads(s['pref'])['keepWorkspace'] is True, \
            f'默认值不该落盘：{s["pref"]}'

        # 关掉 → 立即落盘
        box.uncheck()
        pg.wait_for_timeout(500)
        s = pg.evaluate(STATE)
        pref = json.loads(s['pref']) if s['pref'] else {}
        assert pref.get('keepWorkspace') is False, f'关闭后没写盘：{s["pref"]}'
        # v1.1.2 起同一份偏好里还带「默认勾几个账号」，旧字段不能被覆盖掉
        assert pref.get('multiCount') == 0, f'multiCount 丢了：{s["pref"]}'

        # 重新载入：开关保持关闭
        pg.reload()
        pg.wait_for_timeout(1500)
        if pg.locator('button:has-text("设置")').count() == 0:
            pg.click('.avatar-btn')
            pg.wait_for_timeout(700)
        pg.click('button:has-text("设置")')
        pg.wait_for_timeout(800)
        assert not pg.locator('.tglrow:has-text("切回账号时接着上次看") input.tgl').is_checked(), '重启后偏好没恢复'
        assert not errors, f'JS 异常：{errors}'
        print('✓ 多账号开关默认开，关闭后落盘 ghx.acct.pref，重载后保持关闭')
        b.close()


if __name__ == '__main__':
    main()

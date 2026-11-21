"""验证「Issue 正文翻译 + 链接保活 + 图片失败重试/不加载」（v1.0.3）。

用户提的三件事：
  1. 翻译不能遗落链接和跳转 —— 译文里的链接必须还能点，且点进 App 内；
  2. GitHub 跳转不能跳浏览器 —— releases 这类没有页面的地址落站内说明页；
  3. 图片加载不出来要给「重试」「不加载」。

本脚本覆盖 1、2 的后半段与 3；跳转的完整矩阵在 verify-applinks.py。

    pnpm build && npx vite preview --port 4173
    xvfb-run -a python3 scripts/verify-v103.py
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
IMG = f'https://raw.githubusercontent.com/{OWNER}/{REPO}/main/docs/preview.png'

BODY = f"""This issue tracks a broken link: [Open file](https://github.com/{OWNER}/{REPO}/blob/main/src/index.ts).

See https://github.com/{OWNER}/{REPO}/issues/2 for details.

We also added ![preview]({IMG}) for reference.
"""

repo = {
    'id': 1, 'name': REPO, 'full_name': f'{OWNER}/{REPO}',
    'owner': {'login': OWNER, 'avatar_url': ''},
    'private': False, 'visibility': 'public', 'archived': False, 'disabled': False,
    'description': '翻译与图片验证仓库。', 'language': 'TypeScript',
    'stargazers_count': 1, 'forks_count': 0, 'open_issues_count': 1,
    'pushed_at': '2026-11-21T09:12:00Z', 'updated_at': '2026-11-21T09:12:00Z',
    'created_at': '2026-01-12T08:00:00Z', 'default_branch': 'main',
    'permissions': {'admin': True, 'maintain': True, 'push': True, 'pull': True},
}

user = {
    'login': OWNER, 'id': 1, 'name': '指尖可乐', 'type': 'User', 'avatar_url': '',
    'html_url': f'https://github.com/{OWNER}', 'public_repos': 1, 'public_gists': 0,
    'followers': 1, 'following': 1, 'bio': None, 'company': None, 'location': None,
    'blog': None, 'twitter_username': None, 'created_at': '2025-03-01T08:00:00Z',
}

issue = {
    'number': 1, 'title': '正文翻译要保住链接', 'state': 'open', 'state_reason': None,
    'body': BODY, 'user': {'login': OWNER, 'avatar_url': ''}, 'labels': [],
    'assignees': None, 'comments': 0,
    'created_at': '2026-11-20T08:00:00Z', 'updated_at': '2026-11-20T08:00:00Z',
    'closed_at': None, 'html_url': f'https://github.com/{OWNER}/{REPO}/issues/1',
}

pr = {
    'number': 3, 'title': '描述也要翻', 'state': 'open', 'draft': False, 'merged': False,
    'merged_at': None, 'mergeable': True, 'mergeable_state': 'clean',
    'body': f'Review the [changes](https://github.com/{OWNER}/{REPO}/blob/main/src/index.ts) please.',
    'user': {'login': OWNER, 'avatar_url': ''}, 'labels': [], 'assignees': None, 'milestone': None,
    'head': {'ref': 'feat', 'sha': 'c' * 40, 'label': f'{OWNER}:feat'},
    'base': {'ref': 'main', 'sha': 'd' * 40, 'label': f'{OWNER}:main'},
    'commits': 0, 'additions': 1, 'deletions': 0, 'changed_files': 1,
    'created_at': '2026-11-20T08:00:00Z', 'updated_at': '2026-11-20T08:00:00Z',
    'html_url': f'https://github.com/{OWNER}/{REPO}/pull/3', 'requested_reviewers': None,
}

HEADERS = {
    'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4871',
    'x-ratelimit-reset': '1793800000', 'x-oauth-scopes': 'repo, read:user, workflow, notifications',
    'access-control-expose-headers': (
        'x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset, x-oauth-scopes, link, etag'
    ),
}


def ok(route, body, status=200):
    route.fulfill(status=status, content_type='application/json', headers=HEADERS, body=json.dumps(body))


def handle(route):
    url = route.request.url
    path = re.sub(r'^https://api\.github\.com', '', url).split('?')[0]
    prefix = f'/repos/{OWNER}/{REPO}'
    if path == '/user':
        return ok(route, user)
    if path == '/user/repos':
        return ok(route, [repo])
    if path in ('/user/starred', '/notifications'):
        return ok(route, [])
    if path == '/rate_limit':
        return ok(route, {'resources': {'core': {'limit': 5000, 'remaining': 4871, 'reset': 1793800000}}})
    if path == f'{prefix}/issues':
        return ok(route, [issue])
    if path == f'{prefix}/issues/1':
        return ok(route, issue)
    if path == f'{prefix}/issues/2':
        return ok(route, {**issue, 'number': 2, 'title': '第二条', 'body': '只是为了验证裸 URL。', 'comments': 0})
    if re.match(rf'^{prefix}/issues/\d+/comments$', path):
        return ok(route, [])
    if path == f'{prefix}/pulls':
        return ok(route, [pr])
    if path == f'{prefix}/pulls/3':
        return ok(route, pr)
    if path in (f'{prefix}/pulls/3/reviews', f'{prefix}/pulls/3/commits', f'{prefix}/pulls/3/files'):
        return ok(route, [])
    if path == f'{prefix}/contents/src/index.ts':
        code = 'export const hello = 1\n'
        return ok(route, {
            'name': 'index.ts', 'path': 'src/index.ts', 'sha': 'b' * 40, 'size': len(code),
            'type': 'file', 'encoding': 'base64',
            'content': base64.b64encode(code.encode()).decode(),
        })
    if path.startswith(f'{prefix}/contents') or path.startswith(f'{prefix}/git/'):
        return ok(route, [])
    if path == prefix:
        return ok(route, repo)
    return ok(route, repo)


TRANSLATIONS = [
    ('This issue tracks a broken link:', '这条 Issue 记录一个坏掉的链接：'),
    ('Open file', '打开文件'),
    ('Review the', '请审阅'),
    ('please.', '谢谢。'),
    ('See', '参见'),
    ('for details.', '了解详情。'),
    ('We also added', '另外补了一张'),
    ('for reference.', '作为参考。'),
]


def edge_mock(route):
    try:
        items = json.loads(route.request.post_data or '[]')
    except Exception:
        items = []
    out = []
    for t in items:
        for src, dst in TRANSLATIONS:
            t = t.replace(src, dst)
        out.append(t)
    route.fulfill(
        status=200,
        content_type='application/json',
        body=json.dumps([{'translations': [{'text': t, 'to': 'zh-CN'}]} for t in out]),
    )


STATE = """() => ({
  ext: window.__ext.slice(),
  title: (document.querySelector('.page-title') || {}).textContent || '',
  body: (document.querySelector('.detail-body') || {}).innerText || '',
  links: [...document.querySelectorAll('.detail-body .md-link')].map(b => b.textContent),
  fail: !!document.querySelector('.md-img-fail'),
  failText: (document.querySelector('.md-img-fail') || {}).innerText || '',
  skip: !!document.querySelector('.md-img-skip'),
  skipText: (document.querySelector('.md-img-skip') || {}).innerText || '',
  translated: !!document.querySelector('.tr-mark'),
  width: document.documentElement.scrollWidth,
  client: document.documentElement.clientWidth,
})"""


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=False, args=['--no-sandbox', '--force-color-profile=srgb', '--hide-scrollbars'])
        pg = b.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        pg.emulate_media(color_scheme='light')
        errors, noise = [], []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: noise.append(m.text) if m.type == 'error' else None)
        pg.route('**/api.github.com/**', handle)
        pg.route('**/edge.microsoft.com/translate/translatetext**', edge_mock)
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

        pg.click('.rows button.row')
        pg.wait_for_timeout(800)
        pg.click('.actrow:has-text("仓库主页")')
        pg.wait_for_timeout(800)
        pg.click('.seg button:has-text("Issues")')
        pg.wait_for_selector('.row.issue-row', timeout=10000)
        pg.click('.row.issue-row >> nth=0')
        pg.wait_for_selector('.detail-body .md', timeout=10000)

        # ── 1. 正文被翻成中文，链接还在 ──
        try:
            pg.wait_for_selector('.detail-body >> text=这条 Issue 记录', timeout=15000)
        except Exception:
            print('诊断：', pg.evaluate(STATE))
            raise
        s = pg.evaluate(STATE)
        assert s['translated'], '译标没出现'
        assert '这条 Issue 记录' in s['body'], f'正文没翻：{s["body"][:120]}'
        assert '打开文件' in s['links'], f'译文里的链接丢了：{s["links"]}'
        print('✓ Issue 正文已译，且链接仍在：', s['links'])

        # ── 2. 译文里的链接点进 App 内（不外跳） ──
        mark = len(s['ext'])
        pg.click('.detail-body .md-link:has-text("打开文件")')
        pg.wait_for_timeout(900)
        s = pg.evaluate(STATE)
        assert len(s['ext']) == mark, f'译文链接跳去了浏览器：{s["ext"]}'
        assert s['title'] == 'index.ts', f'译文链接没进代码页，标题 {s["title"]!r}'
        print('✓ 译文链接 → App 内代码页')

        # ── 2b. 裸 URL：译文里仍是可点的站内链接 ──
        pg.click('button[aria-label="返回"]')
        pg.wait_for_selector('.md-link', timeout=10000)
        bare = pg.locator('.detail-body .md-link:has-text("issues/2")')
        assert bare.count() > 0, f'裸 URL 没变成链接：{pg.evaluate(STATE)["links"]}'
        mark = len(pg.evaluate(STATE)['ext'])
        bare.first.click()
        pg.wait_for_timeout(900)
        s = pg.evaluate(STATE)
        assert len(s['ext']) == mark, f'裸 URL 跳去了浏览器：{s["ext"]}'
        assert s['title'] == '#2', f'裸 URL 没进 #2，标题 {s["title"]!r}'
        print('✓ 裸 URL 译文保持可点，且站内打开')

        # ── 3. 看原文 / 看译文 ──
        pg.click('button[aria-label="返回"]')
        pg.wait_for_selector('.detail-body .md', timeout=10000)
        pg.click('text=看原文')
        pg.wait_for_timeout(400)
        s = pg.evaluate(STATE)
        assert 'This issue tracks' in s['body'], f'切回原文失败：{s["body"][:100]}'
        assert pg.locator('.detail-body .md-link').count() > 0, '原文里的链接没了'
        pg.click('text=看译文')
        pg.wait_for_timeout(400)
        s = pg.evaluate(STATE)
        assert '这条 Issue 记录' in s['body'], '切回译文失败'
        print('✓ 原文 / 译文切换正常，两端链接都在')

        # ── 4. 图片失败：重试 + 不加载 ──
        pg.wait_for_selector('.md-img-fail', timeout=20000)
        s = pg.evaluate(STATE)
        assert '重试' in s['failText'] and '不加载' in s['failText'], f'失败占位缺动作：{s["failText"]!r}'
        pg.screenshot(path=f'{OUT}/v103-imgfail.png')

        pg.click('.md-img-fail button:has-text("不加载")')
        pg.wait_for_timeout(300)
        s = pg.evaluate(STATE)
        assert s['skip'], '点「不加载」后没折叠成占位'
        assert '已跳过一张图片' in s['skipText'], f'跳过文案不对：{s["skipText"]!r}'
        print('✓ 图片失败 → 不加载 → 折叠为占位')

        pg.click('.md-img-skip button:has-text("加载")')
        pg.wait_for_timeout(800)
        s = pg.evaluate(STATE)
        assert not s['skip'], '点「加载」后没恢复'
        print('✓ 占位里点「加载」→ 重新请求')

        # ── 5. 重试按钮真的会重新挂载 ──
        pg.wait_for_selector('.md-img-fail', timeout=20000)
        pg.click('.md-img-fail button:has-text("重试")')
        pg.wait_for_timeout(600)
        s = pg.evaluate(STATE)
        assert s['width'] <= s['client'], f'390 宽溢出：{s["width"]} > {s["client"]}'
        print('✓ 「重试」不报错，390 宽不溢出')

        # ── 6. PR 描述同样要翻，链接同样要留 ──
        for _ in range(4):
            if pg.locator('.seg button:has-text("PR")').count() > 0:
                break
            btn = pg.locator('button[aria-label="返回"]')
            if btn.count() == 0:
                break
            btn.first.click()
            pg.wait_for_timeout(500)
        if pg.locator('.seg button:has-text("PR")').count() == 0:
            pg.wait_for_selector('.rows button.row', timeout=10000)
            pg.click('.rows button.row')
            pg.wait_for_timeout(800)
            pg.click('.actrow:has-text("仓库主页")')
            pg.wait_for_timeout(800)
        pg.click('.seg button:has-text("PR")')
        pg.wait_for_selector('.row:has-text("描述也要翻")', timeout=10000)
        pg.click('.row:has-text("描述也要翻") >> nth=0')
        pg.wait_for_selector('.detail-body .md', timeout=10000)
        try:
            pg.wait_for_selector('.detail-body >> text=请审阅', timeout=15000)
        except Exception:
            print('诊断：', pg.evaluate(STATE))
            raise
        s = pg.evaluate(STATE)
        assert s['links'], f'PR 译文的链接丢了：{s["body"][:120]}'
        mark = len(s['ext'])
        pg.click('.detail-body .md-link >> nth=0')
        pg.wait_for_timeout(900)
        s = pg.evaluate(STATE)
        assert len(s['ext']) == mark and s['title'] == 'index.ts', f'PR 译文链接没站内打开：{s["title"]!r}'
        print('✓ PR 描述已译，链接仍站内可点')

        if noise:
            print(f'（忽略 {len(noise)} 条资源加载噪音）')
        assert not errors, f'JS 报错：{errors[:2]}'
        b.close()
        print('\n全部通过，截图 docs/screenshots/v103-imgfail.png')


if __name__ == '__main__':
    main()

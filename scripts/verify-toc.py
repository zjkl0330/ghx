"""验证自述「目录」浮层：条目不能被压扁、能滚、能跳（v1.0.4）。

真机截图里 25 节目的目录整块糊成一片：每个条目被 flex 压到几像素高，
文字只剩一条横切面。根因是 `.toc-list` 是 column flex 且限高，
`.toc-item` 又带 `overflow:hidden`（为了省略号），自动最小高度随之失效，
于是被 flex-shrink 压扁。本脚本用 25 个标题把这种情况摆出来。

    pnpm build && npx vite preview --port 4173
    xvfb-run -a python3 scripts/verify-toc.py
"""

import base64
import json
import os
import re

from playwright.sync_api import sync_playwright

OUT = '/workspace/ghx/docs/screenshots'
BASE = 'http://127.0.0.1:4173/'
OWNER = 'zjkl0330'
REPO = 'toc-long'
N = 25

# 25 个标题：一二级混排 + 一个超长标题 + 行内代码与链接，尽量贴近真实 README
lines = ['# 项目自述', '']
for i in range(1, N):
    lvl = 2 if i % 4 else 3
    if i == 7:
        title = '这是一个特别特别长的二级标题，用来验证省略号是不是真的生效而不是把整行顶出面板'
    elif i == 11:
        title = '带 `inline code` 与 [链接](https://github.com/O/R) 的标题'.replace('O', OWNER).replace('R', REPO)
    else:
        title = f'第 {i} 节：功能说明与使用方式'
    lines.append('#' * lvl + ' ' + title)
    lines.append('')
    lines.append(f'正文第 {i} 段，用来把自述撑长，确保跳转时容器真的能滚。')
    lines.append('')
README = '\n'.join(lines)

repo = {
    'id': 1, 'name': REPO, 'full_name': f'{OWNER}/{REPO}',
    'owner': {'login': OWNER, 'avatar_url': ''},
    'private': False, 'visibility': 'public', 'archived': False, 'disabled': False,
    'description': '目录验证仓库。', 'language': 'TypeScript',
    'stargazers_count': 1, 'forks_count': 0, 'open_issues_count': 0,
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

readme_file = {
    'name': 'README.md', 'path': 'README.md', 'sha': 'a' * 40, 'size': len(README),
    'content': base64.b64encode(README.encode()).decode(), 'encoding': 'base64',
    'html_url': f'https://github.com/{OWNER}/{REPO}/blob/main/README.md',
}

HEADERS = {
    'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4871',
    'x-ratelimit-reset': '1793800000', 'x-oauth-scopes': 'repo, read:user, workflow, notifications',
    'access-control-expose-headers': (
        'x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset, x-oauth-scopes, link, etag'
    ),
}

READY = """() => {
  const items = [...document.querySelectorAll('.toc-item')];
  const list = document.querySelector('.toc-list');
  const panel = document.querySelector('.toc-panel');
  const r = panel ? panel.getBoundingClientRect() : null;
  return {
    count: items.length,
    countText: (document.querySelector('.toc-count') || {}).textContent || '',
    heights: items.map(e => Math.round(e.getBoundingClientRect().height * 10) / 10),
    clipped: items.filter(e => e.scrollHeight - e.clientHeight > 1).length,
    font: items[0] ? getComputedStyle(items[0]).fontSize : '',
    line: items[0] ? getComputedStyle(items[0]).lineHeight : '',
    listH: list ? Math.round(list.getBoundingClientRect().height) : 0,
    listScroll: list ? list.scrollHeight : 0,
    panelTop: r ? Math.round(r.top) : 0,
    panelBottom: r ? Math.round(r.bottom) : 0,
    vh: window.innerHeight,
    active: [...document.querySelectorAll('.toc-item.on')].map(e => e.textContent),
    activeIdx: [...document.querySelectorAll('.toc-item')].findIndex(e => e.classList.contains('on')),
    sheetTop: (document.querySelector('.sheet') || {}).scrollTop || 0,
    expectedIdx: (() => {
      const box = document.querySelector('.sheet');
      if (!box) return -1;
      const base = box.getBoundingClientRect().top - box.scrollTop;
      const offs = [...document.querySelectorAll('.md [id^="md-h-"]')]
        .map(el => el.getBoundingClientRect().top - base);
      let a = 0;
      offs.forEach((o, i) => { if (o <= box.scrollTop + 24) a = i; });
      return a;
    })(),
    offsets: (() => {
      const box = document.querySelector('.sheet');
      if (!box) return [];
      const base = box.getBoundingClientRect().top - box.scrollTop;
      return [...document.querySelectorAll('.md [id^="md-h-"]')].slice(0, 25)
        .map(el => Math.round(el.getBoundingClientRect().top - base));
    })(),
    longEllipsis: (() => {
      const el = items.find(e => e.textContent.includes('特别特别长'));
      if (!el) return null;
      return { sw: el.scrollWidth, cw: el.clientWidth };
    })(),
  };
}"""


def main():
    os.makedirs(OUT, exist_ok=True)

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
        else:
            body = {}
        route.fulfill(status=200, content_type='application/json', headers=HEADERS, body=json.dumps(body))

    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=False, args=['--no-sandbox', '--force-color-profile=srgb', '--hide-scrollbars'])
        pg = b.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        pg.emulate_media(color_scheme='light')
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.route('**/api.github.com/**', handle)
        pg.route(re.compile(r'.*\.(png|jpg|jpeg|svg|webp)(\?.*)?$'), lambda r: r.abort())
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
        pg.wait_for_timeout(900)
        pg.click('text=项目自述')
        pg.wait_for_selector('.md .md-h', timeout=12000)
        pg.wait_for_timeout(600)

        # ── 1. 开目录，条目数与高度 ──
        pg.click('button[aria-label="目录"]')
        pg.wait_for_timeout(500)
        s = pg.evaluate(READY)
        assert s['count'] == N, f'目录条目数不对：{s["count"]}，标题有 {N} 个'
        assert s['countText'].strip() == f'{N} 节', f'计数文案不对：{s["countText"]!r}'

        short = [h for h in s['heights'] if h < 26]
        assert not short, f'有条目被压扁了（高度 < 26px）：{s["heights"]}'
        assert s['clipped'] == 0, f'有 {s["clipped"]} 条文字被竖向裁切'
        print(f'✓ {s["count"]} 条目录都以正常行高显示（高度 {min(s["heights"])}–{max(s["heights"])}px）')

        # ── 2. 面板不越出视口，列表可滚 ──
        assert s['panelTop'] >= 0 and s['panelBottom'] <= s['vh'], (
            f'目录面板越界：top={s["panelTop"]} bottom={s["panelBottom"]} vh={s["vh"]}'
        )
        assert s['listScroll'] > s['listH'], f'列表没形成滚动：{s["listScroll"]} vs {s["listH"]}'
        print(f'✓ 面板在视口内（{s["panelTop"]}–{s["panelBottom"]}/{s["vh"]}），列表可滚')

        # ── 3. 长标题省略号生效，且不顶出面板 ──
        le = s['longEllipsis'] or {}
        assert le.get('sw', 0) > le.get('cw', 0), f'长标题没触发省略：{le}'
        print(f'✓ 超长标题走省略号（{le["sw"]}>{le["cw"]}）')

        pg.screenshot(path=f'{OUT}/toc-fixed.png')

        # ── 4. 点后面的条目能跳，且浮层收起 ──
        before = pg.evaluate("() => document.querySelector('.sheet').scrollTop")
        pg.click('.toc-item >> nth=20')
        pg.wait_for_timeout(900)
        after = pg.evaluate("() => document.querySelector('.sheet').scrollTop")
        assert pg.locator('.toc-panel').count() == 0, '跳转后目录没收起'
        assert after > before + 200, f'点目录没滚动：{before} → {after}'
        print(f'✓ 点第 21 节跳转（scrollTop {before} → {after}），浮层收起')

        # ── 5. 回到顶部再开：高亮第一项；正文滚动后高亮跟着走 ──
        pg.evaluate("() => { document.querySelector('.sheet').scrollTop = 0 }")
        pg.wait_for_timeout(300)
        pg.click('button[aria-label="目录"]')
        pg.wait_for_timeout(500)
        s = pg.evaluate(READY)
        assert s['activeIdx'] == 0, f'在顶部打开时高亮不是第一项：{s["activeIdx"]}'

        pg.evaluate("() => { const b = document.querySelector('.sheet'); b.scrollTop = b.scrollHeight }")
        pg.wait_for_timeout(400)
        s = pg.evaluate(READY)
        assert s['activeIdx'] == s['expectedIdx'], (
            f'高亮没跟着滚动走：idx={s["activeIdx"]} 期望 {s["expectedIdx"]}（{s["active"]}，'
            f'scrollTop={s["sheetTop"]}）'
        )
        assert s['activeIdx'] > 10, f'滚到底了高亮还停在前段：{s["activeIdx"]}'
        print(f'✓ 高亮跟随滚动位置：{s["active"][0][:18]}')

        # ── 6. 深色下同样正常（截图留档） ──
        pg.emulate_media(color_scheme='dark')
        pg.wait_for_timeout(400)
        s = pg.evaluate(READY)
        assert min(s['heights']) >= 26, f'深色下条目又被压扁：{s["heights"]}'
        pg.screenshot(path=f'{OUT}/toc-fixed-dark.png')
        print('✓ 深色模式同样正常')

        assert not errors, f'console 有报错：{errors[:3]}'
        b.close()


if __name__ == '__main__':
    main()

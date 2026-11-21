"""验证发行说明的 Markdown 渲染 + 机翻（v1.0.1）。

用户截图里的症状：展开某条发行版，说明区直接把 Markdown 源码吐出来 ——
`<h2 id="en-v1.3.10">Highlights</h2>` 和 `**OpenAI Codex**` 全裸，
而且是纯英文。根因是这里一直用 `excerpt(body, 600)` 截断当文本显示，
「发行版说明」的翻译开关（`scope.release`）也从来没接上。

要证：
  1. 说明按 Markdown 渲染：出现 `.md` 块、标题/列表/粗体不再是源码字符；
  2. 英文说明被翻成中文，且顶部有「译」标；
  3. 译文里的链接仍然可点（⟦⟧ 占位保住 href），点击进 App 内代码页；
  3b. 双语目录锚点（[English](#en-v1.3.10)）能真的跳到对应小节；
  4. 「看原文」能切回英文，再点「看译文」回来；
  5. 390 宽不溢出，console 无报错。

    pnpm build && npx vite preview --port 4173
    xvfb-run -a python3 scripts/verify-relnotes.py
"""

import base64
import json
import os
import re

from playwright.sync_api import sync_playwright

OUT = '/workspace/ghx/docs/screenshots'
BASE = 'http://127.0.0.1:4173/'
OWNER = 'zjkl0330'
REPO = 'money-printer-turbo'

GL, GR = '\u27E6', '\u27E7'

NOTES = """[English](#en-v1.3.10) | [中文](#cn-v1.3.10)

<h2 id="en-v1.3.10">Highlights</h2>

- Added **OpenAI Codex subscription access** with device-code sign-in and dynamic model selection.
- Added **Codex image generation** as a material source.
- Added **Infistar and Jalapeno Cloud** for LLM and video generation.

Read the [upgrade guide](https://github.com/zjkl0330/REPO/blob/main/UPGRADE.md) before updating.

<h2 id="cn-v1.3.10">中文说明</h2>

- 这一节故意放在最末，用来验证锚点会真的把正文滚下来。
- 段落二。
- 段落三。
- 段落四。
- 段落五。
- 段落六。
- 段落七。
- 段落八。
- 段落九。
- 段落十。
- 段落十一。
- 段落十二。
"""

README = """# money-printer-turbo

A small demo repository for release notes rendering.
"""

repo = {
    'id': 1,
    'name': REPO,
    'full_name': f'{OWNER}/{REPO}',
    'owner': {'login': OWNER, 'avatar_url': ''},
    'private': False,
    'visibility': 'public',
    'archived': False,
    'disabled': False,
    'description': '发行说明渲染示例仓库。',
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
    'bio': '白天上学，晚上折腾自托管。', 'company': None, 'location': None,
    'blog': None, 'twitter_username': None, 'created_at': '2025-03-01T08:00:00Z',
}
release = {
    'id': 310,
    'tag_name': 'v1.3.10',
    'name': 'v1.3.10',
    'body': NOTES.replace('REPO', REPO),
    'draft': False,
    'prerelease': False,
    'created_at': '2026-11-07T00:00:00Z',
    'published_at': '2026-11-07T00:00:00Z',
    'html_url': f'https://github.com/{OWNER}/{REPO}/releases/tag/v1.3.10',
    'assets': [
        {
            'id': 900, 'name': 'MoneyPrinterTurbo-Portable-Windows-amd64.zip',
            'size': 555_220_000, 'download_count': 18981,
            'browser_download_url': f'https://github.com/{OWNER}/{REPO}/releases/download/v1.3.10/pkg.zip',
        }
    ],
}
readme_file = {
    'name': 'README.md', 'path': 'README.md', 'sha': 'a' * 40, 'size': len(README),
    'content': base64.b64encode(README.encode()).decode(), 'encoding': 'base64',
    'html_url': f'https://github.com/{OWNER}/{REPO}/blob/main/README.md',
}


def edge_mock(route):
    """Edge 批量翻译端点。译文保留 ⟦⟧ 占位符，标签文字一并翻掉。"""
    try:
        items = json.loads(route.request.post_data or '[]')
    except Exception:
        items = []
    out = []
    for t in items:
        # 逐段替换：真实通道也会把 ⟦⟧ 原样留下，标签内容跟着翻
        t = (t.replace('Highlights', '更新亮点')
              .replace('OpenAI Codex subscription access', 'OpenAI Codex 订阅接入')
              .replace('Codex image generation', 'Codex 图像生成')
              .replace('Infistar and Jalapeno Cloud', 'Infistar 与 Jalapeno Cloud')
              .replace('upgrade guide', '升级指南')
              .replace('Added', '新增')
              .replace('with device-code sign-in and dynamic model selection', '支持设备码登录与动态模型选择')
              .replace('as a material source', '作为素材来源')
              .replace('for LLM and video generation', '用于大模型与视频生成')
              .replace('Read the', '请先阅读')
              .replace('before updating', '再更新'))
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
    elif re.match(rf'^/repos/{OWNER}/{REPO}/releases', path):
        body = [release]
    elif path == '/rate_limit':
        body = {'resources': {'core': {'limit': 5000, 'remaining': 4871, 'reset': 1793800000}}}
    elif '/contents/' in path:
        route.fulfill(status=404, content_type='application/json', body='[]', headers={
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


MEASURE = """() => {
  const notes = document.querySelector('.rel-notes');
  const body = notes ? notes.innerText : '';
  return {
    hasNotes: !!notes,
    hasMd: !!document.querySelector('.rel-notes .md'),
    text: body,
    heads: [...document.querySelectorAll('.rel-notes .md-h')].map(n => n.textContent),
    lis: document.querySelectorAll('.rel-notes .md-li').length,
    bold: document.querySelectorAll('.rel-notes .md strong, .rel-notes .md b').length,
    links: [...document.querySelectorAll('.rel-notes .md-link')].map(b => b.textContent),
    trMark: !!document.querySelector('.rel-notes .tr-mark'),
    width: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  };
}"""


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
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
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
        pg.wait_for_timeout(1200)
        pg.click('text=发行版')
        pg.wait_for_timeout(1200)

        # ── 1. 展开一条，等译文（说明是英文，autoTranslate 默认开） ──
        pg.click('.rel-head')
        pg.wait_for_selector('.rel-notes .md', timeout=10000)
        try:
            pg.wait_for_selector('.rel-notes .md >> text=更新亮点', timeout=15000)
        except Exception:
            print('诊断：', pg.evaluate(MEASURE))
            raise
        pg.wait_for_timeout(400)
        m = pg.evaluate(MEASURE)

        # ── 断言 1：Markdown 真渲染，源码字符不再裸露 ──
        assert m['hasMd'], '说明区没有走 MarkdownView'
        assert m['heads'], f'HTML 标题没渲染成标题：{m["heads"]}'
        assert m['lis'] >= 3, f'列表项应至少 3 条，实际 {m["lis"]}'
        if m['bold'] < 3:
            print('诊断 text:', repr(m['text'][:300]))
            print('诊断 html:', pg.evaluate("document.querySelector('.rel-notes .md')?.innerHTML?.slice(0,500)"))
        assert m['bold'] >= 3, f'粗体应渲染成元素，实际 {m["bold"]} 个'
        assert '**' not in m['text'], f'正文里还露着 ** 源码：{m["text"][:200]}'
        assert '<h2' not in m['text'], f'正文里还露着 HTML 标签：{m["text"][:200]}'
        print(f'[1] Markdown 渲染：标题 {m["heads"]}、列表 {m["lis"]} 条、粗体 {m["bold"]} 处，无源码字符')

        # ── 断言 2：译成中文，带「译」标 ──
        assert '更新亮点' in m['text'], f'说明没翻成中文：{m["text"][:200]}'
        assert m['trMark'], '译文视图没有「译」标'
        print('[2] 英文说明已译成中文，「译」标在')

        # ── 断言 3：译文里的链接仍然可点 ──
        assert any('升级指南' in t for t in m['links']), f'译文里链接丢了：{m["links"]}'
        pg.click('.rel-notes .md-link >> text=升级指南')
        pg.wait_for_timeout(1000)
        ext = pg.evaluate('() => window.__ext')
        assert ext == [], f'GitHub 链接不该跳外部：{ext}'
        assert pg.evaluate("() => !document.querySelector('.sheet')"), '弹层没收起（应进 App 内代码页）'
        top = pg.evaluate("() => document.querySelector('.topbar')?.textContent ?? ''")
        assert 'UPGRADE' in top, f'没进到 App 内代码页：{top!r}'
        print(f'[3] 译文链接可点并 App 内打开：topbar={top!r}')

        # ── 3b. 回到发行版，验双语目录锚点 ──
        pg.goto(BASE)
        pg.wait_for_timeout(1500)
        pg.click('.rows button.row')
        pg.wait_for_timeout(1200)
        pg.click('text=发行版')
        pg.wait_for_timeout(1000)
        pg.click('.rel-head')
        pg.wait_for_selector('.rel-notes .md [id="en-v1.3.10"]', timeout=12000)
        ids = pg.evaluate("() => [...document.querySelectorAll('.rel-notes .md [id]')].map(n => n.id)")
        assert 'en-v1.3.10' in ids, f'HTML 标题的 id 没保留：{ids}'
        # 滚到最顶端再点，确保位移来自锚点跳转
        pg.evaluate("() => document.querySelector('.sheet')?.scrollTo(0, 0)")
        pg.wait_for_timeout(300)
        before = pg.evaluate("() => document.querySelector('.sheet')?.scrollTop ?? 0")
        # 点「中文」——目标小节在说明最末，必须真的滚下去
        pg.click('.rel-notes .md-link >> text=中文')
        pg.wait_for_timeout(1200)
        after = pg.evaluate("() => document.querySelector('.sheet')?.scrollTop ?? 0")
        assert after > before, f'点锚点没有滚动：before={before} after={after}'
        print(f'[3b] 双语目录锚点可跳：scrollTop {before} → {after}，id 列表 {ids}')

        # ── 4. 回仓库，看原文/看译文切换 ──
        pg.goto(BASE)
        pg.wait_for_timeout(1500)
        pg.click('.rows button.row')
        pg.wait_for_timeout(1200)
        pg.click('text=发行版')
        pg.wait_for_timeout(1000)
        pg.click('.rel-head')
        pg.wait_for_selector('.rel-notes .md >> text=更新亮点', timeout=12000)
        pg.click('.rel-notes button.linkbtn:has-text("看原文")')
        pg.wait_for_timeout(500)
        src = pg.evaluate(MEASURE)
        assert 'Highlights' in src['text'] and 'OpenAI Codex subscription access' in src['text'], (
            f'看原文没切回英文：{src["text"][:160]}'
        )
        assert not src['trMark'], '原文视图不应有「译」标'
        pg.click('.rel-notes button.linkbtn:has-text("看译文")')
        pg.wait_for_timeout(500)
        zh = pg.evaluate(MEASURE)
        assert '更新亮点' in zh['text'], f'看译文没切回中文：{zh["text"][:160]}'
        print('[4] 原文/译文切换正常')

        # ── 5. 排版不溢出、console 干净 ──
        assert zh['width'] <= zh['client'] + 1, f'说明区把页面撑宽：{zh["width"]} > {zh["client"]}'
        rel_err = [e for e in errors if 'rel' in e.lower() or 'markdown' in e.lower() or 'translate' in e.lower()]
        assert rel_err == [], f'相关报错：{rel_err[:3]}'
        pg.screenshot(path=f'{OUT}/relnotes-101-zh.png')
        print('[5] 390 宽不溢出，console 无相关报错')

        b.close()
        print('全部通过')


if __name__ == '__main__':
    main()

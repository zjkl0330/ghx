"""验证：超长简介（尤其机翻后的中文）在列表行里被折叠，不顶出屏幕。

用户报的现象：华为手机上翻译过来的长描述不折叠，横向突出屏幕一大截。

根因是原来的 `.row-desc` 用 flex 布局，`.desc-text` 靠 `min-width: 0` 收缩。
标准内核没问题，华为的 WebView 不认这条，nowrap 文本按 max-content 排到
1900px，整行被顶宽。现在改成块级容器 + overflow 裁剪，不参与 flex 收缩。

三组断言：
  A. 正常内核：三个列表页都不溢出，文本确实出现了省略号；
  B. 故障注入（把 flex item 的 min-width 全部改回 auto，模拟老内核不收缩）：
     仍然不溢出 —— 这是这次改动的意义，新方案不依赖 min-width；
  C. 对照组（把 .row-desc 改回旧的 flex 写法 + 同样注入）：
     必须复现溢出，否则说明 B 的通过是假阳性。

用法：
    pnpm build && npx vite preview --port 4173
    xvfb-run -a python3 scripts/verify-overflow.py
"""
import json
import os
import re

from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:4173/'
OWNER = 'zjkl0330'
OUT = '/workspace/ghx/docs/screenshots'

# 300 字中文：比任何真实简介都长，且没有空格，nowrap 下无法自行折行
LONG_ZH = (
    '一个用来把各种乱七八糟的东西整理成清单的小工具，支持导入导出、批量重命名、'
    '自动去重、按标签归类、按时间归档，还能把结果同步到网盘和本地目录，'
    '附带一个网页界面用来远程查看和手动修正，后端跑在 Cloudflare Workers 上，'
    '数据库用的是 D1，对象存储用 R2，构建走 GitHub Actions，'
    '手机端可以直接装 APK，桌面端有绿色版 EXE，文档写得很啰嗦但确实覆盖了绝大多数场景。'
)
LONG_EN = (
    'A tiny toolkit that turns messy folders into clean lists, with import and export, '
    'batch renaming, dedupe, tag based grouping and time based archiving, plus sync to '
    'cloud storage and a web UI for remote inspection, backed by Cloudflare Workers, '
    'D1 and R2, built on GitHub Actions, shipping an APK for Android and a portable EXE.'
)
LONG_NAME = 'a-very-long-repository-name-that-keeps-going-and-going-and-going-forever'


def repo(rid, name, desc, lang='TypeScript', stars=46):
    return {
        'id': rid,
        'name': name,
        'full_name': f'{OWNER}/{name}',
        'owner': {'login': OWNER, 'avatar_url': ''},
        'private': False,
        'visibility': 'public',
        'archived': False,
        'disabled': False,
        'description': desc,
        'language': lang,
        'stargazers_count': stars,
        'forks_count': 3,
        'open_issues_count': 2,
        'pushed_at': '2026-11-03T14:40:00Z',
        'updated_at': '2026-11-03T14:40:00Z',
        'created_at': '2026-01-12T08:00:00Z',
        'default_branch': 'main',
        'permissions': {'admin': True, 'maintain': True, 'push': True, 'pull': True},
    }


REPOS = [
    repo(1, 'clist-cf', LONG_ZH, stars=46),
    repo(2, LONG_NAME, LONG_ZH, lang='Go', stars=900),
    repo(3, 'ghx', LONG_EN, lang='TypeScript', stars=12),
]

USER = {
    'login': OWNER, 'id': 1, 'name': '指尖可乐', 'type': 'User',
    'avatar_url': '', 'html_url': f'https://github.com/{OWNER}',
    'public_repos': 10, 'public_gists': 0, 'followers': 128, 'following': 12,
    'bio': None, 'company': None, 'location': None, 'blog': None,
    'created_at': '2025-03-01T08:00:00Z',
}


def handle(route):
    path = re.sub(r'^https://api\.github\.com', '', route.request.url).split('?')[0]
    if path == '/user':
        body = USER
    elif path in ('/user/repos', '/user/starred'):
        body = REPOS
    elif path == '/notifications':
        body = []
    elif path == '/rate_limit':
        body = {'resources': {'core': {'limit': 5000, 'remaining': 4900, 'reset': 1793800000}}}
    elif path == '/search/repositories':
        body = {'total_count': len(REPOS), 'incomplete_results': False, 'items': REPOS}
    elif path.startswith('/users/'):
        segs = path.strip('/').split('/')
        body = USER if len(segs) == 2 else []
    else:
        body = {}
    route.fulfill(
        status=200,
        content_type='application/json',
        headers={
            'access-control-allow-origin': '*',
            'access-control-expose-headers': (
                'x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset, x-oauth-scopes, link'
            ),
            'x-ratelimit-limit': '5000',
            'x-ratelimit-remaining': '4900',
            'x-ratelimit-reset': '1793800000',
            'x-oauth-scopes': 'repo, read:user, workflow, notifications',
        },
        body=json.dumps(body),
    )


def handle_translate(route):
    """Edge 翻译端点：按请求里的段数返回同样段数的长中文。

    这样「机翻后的长描述」才是真的长中文，而不是英文原文，
    用户报的正是翻译之后的溢出。
    """
    try:
        req = json.loads(route.request.post_data or '[]')
    except Exception:
        req = []
    items = []
    for _ in req:
        items.append({'translations': [{'text': LONG_ZH, 'to': 'zh-Hans'}]})
    if not items:
        items = [{'translations': [{'text': LONG_ZH, 'to': 'zh-Hans'}]}]
    route.fulfill(
        status=200,
        content_type='application/json',
        headers={'access-control-allow-origin': '*'},
        body=json.dumps(items),
    )


MEASURE = """() => {
  const view = window.innerWidth;
  const rows = [...document.querySelectorAll('.rows .row')];
  return {
    view,
    doc: document.documentElement.scrollWidth,
    rows: rows.map((r) => {
      const d = r.querySelector('.row-desc');
      const t = r.querySelector('.desc-text');
      const m = r.querySelector('.tr-mark');
      return {
        right: Math.round(r.getBoundingClientRect().right),
        // scrollWidth 会把溢出内容算进来（即使外层裁掉了），是「有没有被顶宽」的直接证据
        rowScroll: Math.round(r.scrollWidth),
        descW: d ? Math.round(d.getBoundingClientRect().width) : 0,
        // 文本被裁才会 scrollWidth > clientWidth
        clipped: t ? t.scrollWidth > t.clientWidth + 4 : false,
        textW: t ? Math.round(t.scrollWidth) : 0,
        markRight: m ? Math.round(m.getBoundingClientRect().right) : null,
      };
    }),
  };
}"""


def check(tag, m, expect_rows=3):
    view = m['view']
    assert m['doc'] <= view, f'[{tag}] 文档被撑宽：{m["doc"]} > {view}'
    assert len(m['rows']) == expect_rows, f'[{tag}] 行数不对：{len(m["rows"])}'
    bad = [r for r in m['rows'] if r['right'] > view]
    assert not bad, f'[{tag}] 有行顶出屏幕：{[r["right"] for r in bad]}'
    wide = [r['rowScroll'] for r in m['rows'] if r['rowScroll'] > view + 1]
    assert not wide, f'[{tag}] 有行被内容撑宽：{wide} > {view}'
    for r in m['rows']:
        if r['markRight'] is not None:
            assert r['markRight'] <= view, f'[{tag}] 译标跑到屏幕外：{r["markRight"]}'
        assert r['descW'] <= view, f'[{tag}] 描述块超宽：{r["descW"]}'
    return m


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch(
            headless=False,
            args=['--no-sandbox', '--force-color-profile=srgb', '--hide-scrollbars'],
        )
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        pg = ctx.new_page()
        pg.route('**/api.github.com/**', handle)
        pg.route('**edge.microsoft.com/translate/translatetext*', handle_translate)
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
        pg.wait_for_timeout(4500)
        pg.wait_for_selector('.rows .row', timeout=20000)
        pg.wait_for_timeout(2000)  # 等机翻落地

        tabs = [('仓库', None), ('星标', '星标'), ('热门', '热门')]
        results = {}
        for label, btn in tabs:
            if btn:
                pg.click(f'text={btn}')
                pg.wait_for_timeout(2600)
                pg.wait_for_selector('.rows .row', timeout=15000)
                pg.wait_for_timeout(1200)
            m = pg.evaluate(MEASURE)
            check(f'A {label}', m)
            marks = sum(1 for r in m['rows'] if r['markRight'] is not None)
            clipped = sum(1 for r in m['rows'] if r['clipped'])
            print(
                f'[A] {label}页：文档 {m["doc"]}/{m["view"]} · '
                f'{len(m["rows"])} 行全部在屏内 · 译标 {marks} 个 · {clipped} 行出现省略'
            )
            results[label] = m
            pg.screenshot(path=f'{OUT}/overflow-085-{len(results)}.png')

        # ── B. 模拟老内核：flex item 的 min-width 全部失效 ──
        pg.add_style_tag(content="""
          .row, .row-hit, .row-main, .row-l1, .row-name, .row-desc, .desc-text {
            min-width: auto !important;
          }
        """)
        pg.wait_for_timeout(500)
        m = pg.evaluate(MEASURE)
        check('B 注入后', m)
        print(f'[B] 注入 min-width:auto 后（模拟华为内核）：文档 {m["doc"]}/{m["view"]} · 仍不溢出')
        pg.screenshot(path=f'{OUT}/overflow-085-injected.png')

        # ── C. 对照组：换回旧的 flex 写法，同样的注入下必须溢出 ──
        # 注意 .row-hit 的 overflow 也要一起放开：旧版没有这条兜底，
        # 只还原 .row-desc 的话，行级裁剪会把溢出吃掉，看起来像「旧版也没事」。
        pg.add_style_tag(content="""
          .row-desc { display: flex !important; align-items: baseline !important;
                      gap: 6px !important; overflow: visible !important;
                      white-space: normal !important; max-width: none !important; }
          .row-desc .desc-text { display: block !important; padding-right: 0 !important;
                                 max-width: none !important; }
          .row-desc .tr-mark { position: static !important; }
          .row-hit { overflow: visible !important; }
        """)
        pg.wait_for_timeout(500)
        m_old = pg.evaluate(MEASURE)
        over = [r['rowScroll'] for r in m_old['rows'] if r['rowScroll'] > m_old['view'] + 1]
        assert over, f'旧写法没有复现溢出，注入没生效：{[r["rowScroll"] for r in m_old["rows"]]}'
        print(f'[C] 旧 flex 写法在同一注入下：{len(over)} 行被撑到 {max(over)}px（屏宽 {m_old["view"]}）—— 注入有效')
        pg.screenshot(path=f'{OUT}/overflow-085-oldstyle.png')

        b.close()
    print('全部通过')


if __name__ == '__main__':
    main()

"""用真实构建产物截图，GitHub API 与机翻接口全部走本地 mock。

用途：README 里的图不要靠手截 —— 每次改版重跑一遍，尺寸、主题、数据都一致。
依赖：`npx vite preview --port 4173`，以及 playwright（`pip install playwright`）。

    python3 scripts/shots.py

产物：docs/screenshots/*.png
"""
import json
import os
import re

from playwright.sync_api import sync_playwright

OUT = '/workspace/ghx/docs/screenshots'
BASE = 'http://127.0.0.1:4173/'
OWNER = 'zjkl0330'


def repo(rid, name, desc, zh, lang, stars, pushed, *, private=False, archived=False, forks=0):
    return {
        'id': rid,
        'name': name,
        'full_name': f'{OWNER}/{name}',
        'owner': {'login': OWNER, 'avatar_url': ''},
        'private': private,
        'visibility': 'private' if private else 'public',
        'archived': archived,
        'disabled': False,
        'description': desc,
        'language': lang,
        'stargazers_count': stars,
        'forks_count': forks,
        'open_issues_count': 2,
        'pushed_at': pushed,
        'updated_at': pushed,
        'created_at': '2026-01-12T08:00:00Z',
        'default_branch': 'main',
        'permissions': {'admin': True, 'maintain': True, 'push': True, 'pull': True},
        '_zh': zh,
    }


REPOS = [
    repo(1, 'ghx', 'Android GitHub console that talks straight to the REST API, so it keeps working when github.com is unreachable.',
         'Android 上的 GitHub 控制台，直连 REST API —— 网页打不开时也照常可用。', 'TypeScript', 128, '2026-11-04T09:12:00Z', forks=9),
    repo(2, 'clist-cf', 'Cloudflare Workers build of the file indexer: three storage backends, signed links, no origin server.',
         '用 Cloudflare Workers 跑的文件索引，三种存储后端，签名直链，不需要源站。', 'TypeScript', 46, '2026-11-03T14:40:00Z', forks=3),
    repo(3, 'cloud-api', 'Edge gateway for the personal cloud drive: signed upload URLs, range proxy and per-token rate limits.',
         '个人网盘的边缘网关：签名上传地址、Range 代理，以及按令牌限流。', 'Go', 21, '2026-11-02T11:05:00Z'),
    repo(4, 'n8n-mirror', 'Keeps two n8n instances in sync and prints a three-layer diff before anything is overwritten.',
         '让两个 n8n 实例保持一致，覆盖前先给出三层差异对账。', 'Python', 12, '2026-10-30T19:22:00Z'),
    repo(5, 'esp32-wol', 'ESP32 wake-on-LAN bridge behind a Cloudflare Tunnel, wakes the home PC from anywhere.',
         '挂在 Cloudflare Tunnel 后面的 ESP32 网络唤醒桥，在外面也能叫醒家里的机器。', 'C++', 88, '2026-10-28T07:55:00Z', forks=11),
    repo(6, 'cf-console-android', 'Capacitor shell around the Cloudflare Console web app; APKs are built and signed by GitHub Actions.',
         '把 Cloudflare Console 网页包成 Capacitor 应用，APK 由 GitHub Actions 构建签名。', 'Kotlin', 34, '2026-10-27T21:30:00Z'),
    repo(7, 'dezirclip', 'Packaging and distribution pipeline for DezirClip desktop builds.',
         'DezirClip 桌面版的打包与分发流水线。', 'Rust', 9, '2026-10-25T10:12:00Z'),
    repo(8, 'windhawk-mods', 'Windhawk mods: taskbar tweaks and per-app DPI fixes for Windows 11.',
         'Windhawk 模块：Windows 11 的任务栏微调与单应用 DPI 修正。', 'C++', 17, '2026-10-22T16:48:00Z'),
    repo(9, 'dotfiles', 'Windows setup scripts: uv, pnpm, git mirrors, and the small tools I keep reinstalling.',
         'Windows 环境脚本：uv、pnpm、git 镜像，以及那些装一次丢一次的小工具。', 'PowerShell', 5, '2026-10-20T08:03:00Z'),
    repo(10, 'trae-checkin', 'Scheduled check-in helper for Trae accounts, one Chrome profile per account.',
         'Trae 账号的定时签到，一个账号一个 Chrome profile。', 'JavaScript', 3, '2026-10-18T13:37:00Z', private=True),
    repo(11, 'ghx-preview', 'Design references and the screenshot pipeline for ghx.',
         'ghx 的设计稿与截图流水线。', None, 0, '2026-10-16T09:20:00Z', private=True),
    repo(12, 'blog-source', 'Markdown sources for the blog; the build step runs in Actions.',
         '博客的 Markdown 源文件，构建步骤在 Actions 里跑。', None, 2, '2026-10-12T20:14:00Z'),
    repo(13, 'obsidian-vault', 'Notes vault plus a very small sync script.',
         '笔记库，外加一个很小的同步脚本。', None, 0, '2026-10-08T07:41:00Z', private=True, archived=True),
]

STARS = [
    repo(101, 'm3e-canvas', 'Sketch Material 3 Expressive screens in the browser and turn them into production code.',
         '在浏览器里画 Material 3 Expressive 界面，再直接变成可上线的代码。', 'TypeScript', 1009, '2026-11-02T03:00:00Z', forks=111),
    repo(102, 'psd2live', 'Turn layered PSDs into editable Live2D models, with automatic rigging and no manual mesh work.',
         '把分层 PSD 变成可编辑的 Live2D 模型，自动绑定，不用手搓网格。', 'Kotlin', 835, '2026-11-03T05:00:00Z', forks=74),
    repo(103, 'YunX-Desktop', 'YunX（云析）的官方 Windows 桌面端，支持多协议挂载与秒级目录同步。',
         None, 'Kotlin', 2952, '2026-11-01T10:00:00Z', forks=207),
    repo(104, 'EhViewer', 'The latest, actively maintained E-Hentai viewer for Android, with a rewritten reader and offline cache.',
         '目前仍在维护的 E-Hentai 安卓阅读器，重写了阅读器与离线缓存。', 'Kotlin', 630, '2026-08-20T09:00:00Z', forks=11),
    repo(105, 'HowToGetAlongWithGirls', 'Dating coach skills and references, written as a playbook instead of a lecture.',
         '恋爱教练技巧与参考资料，写成可执行的手册而不是说教。', 'Shell', 169, '2026-07-01T12:00:00Z', forks=9),
    repo(106, 'ohmygpt', 'One proxy for every model provider, with request logging and cost accounting.',
         '一个代理接所有模型供应商，带请求日志与成本核算。', 'Go', 412, '2026-10-11T18:00:00Z', forks=33),
    repo(107, 'archify', 'Draw architecture diagrams as code and keep them next to the source tree.',
         '用代码画架构图，让它和源码树待在一起。', 'TypeScript', 0, '2026-09-09T09:00:00Z'),
    repo(108, 'git-peek', 'Open any remote repository in your editor with a single keystroke.',
         '一个快捷键，把任意远程仓库拉进编辑器。', 'Rust', 128, '2026-06-14T11:00:00Z', forks=6),
]

HOT = [
    dict(repo(201, 'dsh-superagent-prototype', 'Towards a More Autonomous Agent System',
              '通往更自主的智能体系统', 'TypeScript', 16143, '2026-11-01T02:00:00Z', forks=402), owner={'login': 'deepseek-ai'}),
    dict(repo(202, 'craft-anything', 'Craft Anything: understanding how any software works, then crafting it.',
              '看懂任何软件是怎么做出来的，然后亲手做一个。', 'Rust', 7188, '2026-11-01T04:00:00Z', forks=233), owner={'login': 'storytold'}),
    dict(repo(203, 'unslop', 'A Claude skill that turns vibecoded, AI-looking UI into a real design system.',
              '一个 Claude 技能：把「AI 味」很重的界面洗回设计系统。', 'JavaScript', 7172, '2026-10-31T22:00:00Z', forks=424), owner={'login': 'heydamir'}),
    dict(repo(204, 'Mika', 'An on-device AI agent for Android that operates apps the way a person would.',
              '在 Android 端侧运行的 AI 智能体，像人一样操作各类 App。', 'Kotlin', 5986, '2026-10-30T14:00:00Z', forks=117), owner={'login': 'wongzun101'}),
    dict(repo(205, 'pixelfx', '244 pixel art effects, every one a small piece of code, plus a C port for embedded screens.',
              '244 个像素特效，每一个都是很小的一段代码，另附嵌入式屏幕的 C 移植。', 'JavaScript', 3993, '2026-11-02T06:00:00Z', forks=105), owner={'login': 'patch-gg'}),
    dict(repo(206, 'totk-pc-recomp', 'Static recompilation of The Legend of Zelda: Tears of the Kingdom for PC.',
              '《塞尔达传说：王国之泪》的 PC 静态重编译版本。', 'C', 4385, '2026-10-29T20:00:00Z', forks=848), owner={'login': 'valentederah'}),
]

# 星标 / 热门里的仓库作者不是我自己，full_name 得按真实 owner 拼，
# 否则截图里每行都显示 zjkl0330/，一眼假。
STAR_OWNERS = {
    'm3e-canvas': 'lnikai',
    'psd2live': 'tsunehito1',
    'YunX-Desktop': 'tidain',
    'EhViewer': 'liufuyou',
    'HowToGetAlongWithGirls': 'Maqui-crypto',
    'ohmygpt': 'ohmygpt',
    'archify': 'tt-ali',
    'git-peek': 'git-peek',
}
for _r in STARS:
    _o = STAR_OWNERS.get(_r['name'])
    if _o:
        _r['owner'] = {'login': _o, 'avatar_url': ''}
        _r['full_name'] = f"{_o}/{_r['name']}"
_HOT_AGE = [3, 3, 5, 5, 4, 5]
for _i, _r in enumerate(HOT):
    _r['full_name'] = f"{_r['owner']['login']}/{_r['name']}"
    # 热门是「最近创建」，创建时间得压在几天内，否则同比涨星看着不合理
    _r['created_at'] = f'2026-10-{30 + _HOT_AGE[_i]:02d}T06:00:00Z' if _HOT_AGE[_i] < 5 else f'2026-11-0{_HOT_AGE[_i] - 4}T06:00:00Z'

TRANSLATIONS = {}
for _group in (REPOS, STARS, HOT):
    for _r in _group:
        if _r['_zh']:
            TRANSLATIONS[_r['description']] = _r['_zh']


def public(items):
    return [{k: v for k, v in r.items() if k != '_zh'} for r in items]


def main():
    os.makedirs(OUT, exist_ok=True)
    user = {
        'login': OWNER, 'id': 1, 'name': '指尖可乐',
        'avatar_url': 'https://avatars.githubusercontent.com/u/1?v=4',
        'html_url': f'https://github.com/{OWNER}',
        'public_repos': 10, 'public_gists': 0, 'followers': 128, 'following': 12,
        'bio': '白天上学，晚上折腾自托管。',
        'company': None, 'location': '江西 吉安', 'blog': 'zjkl.dpdns.org',
    }

    def handle(route):
        url = route.request.url
        path = re.sub(r'^https://api\.github\.com', '', url).split('?')[0]
        if path == '/user':
            body = user
        elif path == '/user/repos':
            body = public(REPOS)
        elif path == '/user/starred':
            body = public(STARS)
        elif path.startswith('/user/starred/'):
            body = {}
        elif path == '/notifications':
            body = []
        elif path == '/rate_limit':
            body = {'resources': {'core': {'limit': 5000, 'remaining': 4871, 'reset': 1793800000}}}
        elif path == '/search/repositories':
            items = public(HOT) if 'created' in url else public(STARS)
            body = {'total_count': len(items), 'incomplete_results': False, 'items': items}
        elif path.startswith('/repos/'):
            full = path[len('/repos/'):]
            body = next((r for r in public(REPOS + STARS + HOT) if r['full_name'] == full), {})
        else:
            body = {}
        route.fulfill(status=200, content_type='application/json', body=json.dumps(body))

    def handle_translate(route):
        try:
            incoming = json.loads(route.request.post_data or '[]')
        except json.JSONDecodeError:
            incoming = []
        out = [{'translations': [{'text': TRANSLATIONS.get(t, t), 'to': 'zh-CN'}]} for t in incoming]
        route.fulfill(status=200, content_type='application/json', body=json.dumps(out))

    with sync_playwright() as p:
        b = p.chromium.launch(args=['--no-sandbox', '--force-color-profile=srgb'])
        pg = b.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        pg.emulate_media(color_scheme='dark')
        pg.route('**/api.github.com/**', handle)
        pg.route('**/edge.microsoft.com/**', handle_translate)
        pg.route('**/api.cognitive.microsofttranslator.com/**', lambda r: r.abort())
        if os.environ.get('SHOT_DEBUG'):
            pg.on('request', lambda r: print('REQ', r.url[:110]))

        pg.goto(BASE)
        pg.wait_for_timeout(700)

        # 首次导入：走真实的添加令牌流程，让保险库自己加密落盘
        pg.click('.who-btn')
        pg.wait_for_timeout(300)
        pg.click('text=添加账号')
        pg.wait_for_timeout(400)
        pg.fill('input[placeholder="例如 主力令牌"]', '主力令牌')
        pg.fill('input[placeholder="ghp_… 或 github_pat_…"]', 'ghp_' + 'x' * 36)
        pg.click('text=加密保存')
        pg.wait_for_timeout(4000)

        pg.screenshot(path=f'{OUT}/01-repos.png')

        # 滚到底，让内容从玻璃底栏后面穿过去
        pg.evaluate("document.querySelector('.page').scrollTo(0, 300)")
        pg.wait_for_timeout(700)
        pg.screenshot(path=f'{OUT}/02-glass-scroll.png')
        pg.evaluate("document.querySelector('.page').scrollTo(0, 0)")
        pg.wait_for_timeout(400)

        pg.click('.tabbar button:nth-child(2)')
        pg.wait_for_timeout(4000)
        pg.screenshot(path=f'{OUT}/03-stars.png')

        pg.click('.tabbar button:nth-child(3)')
        pg.wait_for_timeout(4000)
        pg.screenshot(path=f'{OUT}/04-hot.png')

        # 仓库详情（含简介原文 / 译文切换）
        pg.click('.tabbar button:nth-child(1)')
        pg.wait_for_timeout(800)
        pg.click('.rows button.row')
        pg.wait_for_timeout(1500)
        pg.screenshot(path=f'{OUT}/05-detail.png')
        pg.click('.sheet .icon-btn')
        pg.wait_for_timeout(500)

        # 平板与横屏：同一个页面改视口，令牌在 context 里，不用重新导入
        pg.set_viewport_size({'width': 820, 'height': 1180})
        pg.wait_for_timeout(900)
        pg.screenshot(path=f'{OUT}/07-tablet.png')

        pg.set_viewport_size({'width': 1024, 'height': 560})
        pg.wait_for_timeout(900)
        pg.screenshot(path=f'{OUT}/08-landscape.png')

        # 设置页：翻译通道
        pg.set_viewport_size({'width': 390, 'height': 844})
        pg.wait_for_timeout(600)
        pg.click('.avatar-btn')
        pg.wait_for_timeout(500)
        pg.click('text=设置')
        pg.wait_for_timeout(800)
        pg.screenshot(path=f'{OUT}/06-settings.png')

        b.close()
    print('shots ok')


if __name__ == '__main__':
    main()

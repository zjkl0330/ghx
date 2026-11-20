"""验证两件事：测速**并发**（不再是六条线路排队等到天荒地老），以及**一天只测一次**。

依赖：`npx vite preview --port 4173`，playwright，xvfb。
    xvfb-run -a python3 scripts/verify-speed.py

怎么让测速可控：探针在 Web 端走 `fetch`，所以在页面里包一层 `window.fetch`，
按域名给不同延迟（模拟真实线路差异），并记录每条的开始/结束时刻、同时运行的峰值。
这样既不用等真实网络，也能拿到「是否真的并发」的硬证据。

断言口径：
1. 首次打开面板：六条线路全部测完，且**同时最多 3 条在跑**（peak == 3）；
2. 总耗时明显短于串行之和（wall < 串行理论值的 70%）；
3. 关掉面板、重开同一个包：**一条测速请求都不发**；
4. 换一个仓库的另一个包：同样不发 —— 看板按站点存，不是按文件存；
5. 点「重新测速」：真的再发一轮；
6. 把看板日期改成昨天再 reload：自动重测（「每天一次」的那一天到了）。
"""
import json
import os
import re

from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:4173/'
OUT = '/workspace/ghx/docs/screenshots'
OWNER = 'zjkl0330'

# 每条线路的模拟延迟（毫秒）：与实测的相对快慢一致，官方最慢
DELAY = {
    'gh.zjkl0330.dpdns.org': 200,
    'ghproxy.imciel.com': 120,
    'gh-proxy.com': 300,
    'ghfast.top': 400,
    'ghproxy.net': 500,
    'github.com': 900,
}

WRAP = """
(() => {
  const DELAY = %s;
  window.__probe = { log: [], peak: 0, running: 0, seen: [] };
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    let host = '';
    try { host = new URL(url, location.href).hostname; } catch (e) {}
    const isProbe = Object.prototype.hasOwnProperty.call(DELAY, host) && url.includes('/releases/download/');
    if (!isProbe) return real(input, init);
    const s = window.__probe;
    const t0 = performance.now();
    s.running += 1;
    s.peak = Math.max(s.peak, s.running);
    s.seen.push(host);
    await new Promise((r) => setTimeout(r, DELAY[host] || 300));
    s.running -= 1;
    const body = new Uint8Array(256 * 1024);
    s.log.push({ host: host, start: Math.round(t0), end: Math.round(performance.now()) });
    return new Response(body, { status: 200, headers: { 'content-length': String(body.length) } });
  };
})();
""" % json.dumps(DELAY)

REPOS = [
    {
        'id': i,
        'name': f'repo-{i:02d}',
        'full_name': f'{OWNER}/repo-{i:02d}',
        'owner': {'login': OWNER, 'avatar_url': ''},
        'private': False,
        'visibility': 'public',
        'archived': False,
        'disabled': False,
        'description': '自测用仓库，简介一行就够。',
        'language': 'TypeScript',
        'stargazers_count': 1200 - i * 7,
        'forks_count': 30 + i,
        'open_issues_count': 0,
        'pushed_at': '2026-11-18T10:00:00Z',
        'updated_at': '2026-11-18T10:00:00Z',
        'created_at': '2025-06-01T08:00:00Z',
        'default_branch': 'main',
        'permissions': {'admin': True, 'maintain': True, 'push': True, 'pull': True},
    }
    for i in range(1, 7)
]

USER = {
    'login': OWNER, 'id': 1, 'name': '指尖可乐', 'type': 'User',
    'avatar_url': '', 'html_url': f'https://github.com/{OWNER}',
    'public_repos': 6, 'public_gists': 0, 'followers': 128, 'following': 12,
    'bio': None, 'company': None, 'location': None, 'blog': None,
    'created_at': '2025-03-01T08:00:00Z',
}


def asset(i, name, size):
    return {
        'id': i, 'name': name, 'size': size, 'download_count': 12,
        'browser_download_url': f'https://github.com/{OWNER}/repo-01/releases/download/v1/{name}',
    }


def release_for(repo_name):
    n = int(repo_name.split('-')[1])
    return [{
        'id': 1000 + n,
        'tag_name': 'v1.0.0',
        'name': 'v1.0.0',
        'body': '自测用发行版',
        'draft': False,
        'prerelease': False,
        'created_at': '2026-11-01T00:00:00Z',
        'published_at': '2026-11-01T00:00:00Z',
        'html_url': f'https://github.com/{OWNER}/{repo_name}/releases/tag/v1.0.0',
        'assets': [asset(n, f'{repo_name}-v1.apk', 4_392_600)],
    }]


def handle(route):
    url = route.request.url
    path = re.sub(r'^https://api\.github\.com', '', url).split('?')[0]

    m = re.match(r'^/repos/[^/]+/([^/]+)/releases$', path)
    if m:
        body = release_for(m.group(1))
    elif path == '/user':
        body = USER
    elif path == '/user/repos':
        body = REPOS
    elif path == '/notifications':
        body = []
    elif path == '/rate_limit':
        body = {'resources': {'core': {'limit': 5000, 'remaining': 4900, 'reset': 1793800000}}}
    elif re.match(r'^/repos/[^/]+/[^/]+$', path):
        name = path.split('/')[-1]
        body = next((r for r in REPOS if r['name'] == name), REPOS[0])
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


def probe_state(pg):
    return pg.evaluate('() => ({ n: window.__probe.log.length, peak: window.__probe.peak })')


def wait_probe_done(pg, timeout=60):
    """
    等测速真的跑完。

    不能只看按钮文案 —— 面板刚挂载时按钮还写着「开始测速」，effect 要下一拍才启动，
    这时候读会立刻判「已完成」，然后拿到批间那个 3/6 的半截结果。
    所以先等第一发请求落地，再等「没有正在跑的」且按钮不再写「测速中」。
    """
    for _ in range(25):
        if pg.evaluate('() => window.__probe.seen.length') > 0:
            break
        pg.wait_for_timeout(200)
    else:
        return False

    for _ in range(timeout):
        st = pg.evaluate("() => ({run: window.__probe.running, "
                         "label: (document.querySelector('button.multi-all') || {}).textContent || ''})")
        if st['run'] == 0 and '测速中' not in st['label']:
            return True
        pg.wait_for_timeout(300)
    return False


def back_to_list(pg):
    """关掉所有弹层回到仓库列表。弹层有「关闭」按钮就点它，没有就点遮罩左上角。"""
    for _ in range(4):
        masks = pg.evaluate("() => document.querySelectorAll('.mask').length")
        if masks == 0 and pg.locator('.rows .row').count() > 0:
            return True
        btn = pg.locator('.icon-btn[aria-label="关闭"]')
        if btn.count() > 0:
            btn.first.click()
        else:
            pg.mouse.click(6, 200)
        pg.wait_for_timeout(600)
    return pg.evaluate("() => document.querySelectorAll('.mask').length") == 0


def open_asset_sheet(pg, repo_name):
    """仓库列表 → 仓库 → 发行版 → 第一条附件 → 下载面板"""
    pg.locator('.row', has_text=repo_name).first.click()
    pg.wait_for_timeout(900)
    pg.click('text=发行版')
    pg.wait_for_timeout(900)
    pg.click('.rel-asset button')
    pg.wait_for_selector('.multi-row', timeout=20000)


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch(
            headless=False,
            args=['--no-sandbox', '--force-color-profile=srgb', '--hide-scrollbars'],
        )
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        ctx.add_init_script(WRAP)
        pg = ctx.new_page()
        pg.route('**/api.github.com/**', handle)
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
        pg.wait_for_timeout(3200)
        pg.wait_for_selector('.rows .row', timeout=20000)

        # ── 1. 首次打开：并发 + 总耗时 ──
        open_asset_sheet(pg, 'repo-01')
        assert wait_probe_done(pg), '测速超时没结束'
        pg.wait_for_timeout(400)

        st = probe_state(pg)
        log = pg.evaluate('() => window.__probe.log')
        n = st['n']
        # 线路条数不是常数：当前镜像若本身就是某个代理，它不会重复占位
        rows_n = pg.locator('.multi-row').count()
        assert n == rows_n, f'{rows_n} 行线路却测了 {n} 条'
        assert rows_n >= 5, f'线路只有 {rows_n} 条'
        assert st['peak'] == 3, f'并发峰值应为 3，实际 {st["peak"]}'

        wall = max(x['end'] for x in log) - min(x['start'] for x in log)
        # 串行理论值按**实际测到的这些站点**算，不写死六条
        delays = sorted(DELAY[x['host']] for x in log)
        serial = sum(delays)
        theory = sum(max(delays[i:i + 3]) for i in range(0, len(delays), 3))
        print(f'[1] {rows_n} 条线路 · 峰值 {st["peak"]} 并发 · 实测 {wall}ms '
              f'（串行 {serial}ms / 三并发理论 {theory}ms）')
        assert wall < serial * 0.7, f'没快到 30% 以上，仍是串行：{wall}ms vs {serial}ms'

        # 最快的是 imciel（120ms），且官方就算 900ms 也不能排第一
        first = pg.locator('.multi-row').first.inner_text().replace('\n', ' ')
        print('[1] 第一行：', first)
        assert 'imciel' in first, f'最快的应该是 ghproxy.imciel.com，实际 {first!r}'

        note = pg.locator('.dl-note').inner_text()
        print('[1] 时间提示：', note)
        assert '测过' in note and '每天' in note, f'缺少「今天测过」提示：{note!r}'
        pg.screenshot(path=f'{OUT}/speed-089-panel.png')

        # ── 2. 关掉再开同一个包：不发请求 ──
        pg.click('.btns .btn.ghost')          # 稍后
        pg.wait_for_timeout(600)
        before = probe_state(pg)['n']
        pg.click('.rel-asset button')          # 同一个发行版附件
        pg.wait_for_selector('.multi-row', timeout=20000)
        pg.wait_for_timeout(1500)
        after = probe_state(pg)['n']
        rows_text = [pg.locator('.multi-row').nth(i).inner_text().replace('\n', ' ')
                     for i in range(pg.locator('.multi-row').count())]
        assert after == before, f'重开面板又测了一遍：{before} → {after}'
        assert all('未测' not in t for t in rows_text), f'有线路显示未测：{rows_text}'
        print(f'[2] 关掉重开：新增请求 0 条，六行全部有速度')

        # ── 3. 换仓库换包：共用同一份看板 ──
        pg.click('.btns .btn.ghost')
        pg.wait_for_timeout(500)
        assert back_to_list(pg), '没能回到仓库列表'
        open_asset_sheet(pg, 'repo-03')
        pg.wait_for_timeout(1500)
        n3 = probe_state(pg)['n']
        assert n3 == before, f'换一个包又重测了：{before} → {n3}'
        rows3 = [pg.locator('.multi-row').nth(i).inner_text().replace('\n', ' ')
                 for i in range(pg.locator('.multi-row').count())]
        assert all('未测' not in t for t in rows3), f'换包后有线路未测：{rows3}'
        print('[3] 换仓库换包：新增请求 0 条 —— 看板按站点存，所有包共用')

        # ── 4. 手动重新测速：真的再跑一轮 ──
        pg.click('button.multi-all')
        pg.wait_for_timeout(300)
        label = pg.locator('button.multi-all').inner_text()
        assert '测速中' in label, f'点了重新测速却没有开始：{label!r}'
        assert wait_probe_done(pg), '手动重测超时'
        n4 = probe_state(pg)['n']
        # 换过仓库，线路表可能少一条（当前镜像本身就是某个代理时不重复占位），按当下行数算
        rows4 = pg.locator('.multi-row').count()
        assert n4 == before + rows4, f'手动重测应新增 {rows4} 条，实际 {n4 - before}'
        print(f'[4] 手动重新测速：新增 {n4 - before} 条')

        # ── 5. 把看板改成昨天，reload 后应该自动重测 ──
        pg.evaluate("""() => {
          const raw = localStorage.getItem('ghx.speed.board');
          const b = JSON.parse(raw);
          const d = new Date(b.at);
          d.setDate(d.getDate() - 1);
          b.at = d.getTime();
          localStorage.setItem('ghx.speed.board', JSON.stringify(b));
          localStorage.removeItem('ghx.prefetch.done');
        }""")
        pg.reload()
        pg.wait_for_timeout(1200)
        pg.wait_for_selector('.rows .row', timeout=20000)
        open_asset_sheet(pg, 'repo-01')
        assert wait_probe_done(pg), '看板过期后没有自动重测'
        n5 = probe_state(pg)['n']
        rows5 = pg.locator('.multi-row').count()
        assert n5 == rows5, f'看板过期应重测 {rows5} 条，实际 {n5} 条'
        rows_text5 = [pg.locator('.multi-row').nth(i).inner_text().replace('\n', ' ')
                      for i in range(rows5)]
        assert all('未测' not in t for t in rows_text5), f'重测后仍有未测：{rows_text5}'
        print(f'[5] 看板改成昨天 → reload 后自动重测 {n5} 条')

        pg.screenshot(path=f'{OUT}/speed-089-reprobe.png')
        b.close()
        print('全部断言通过')


if __name__ == '__main__':
    main()

"""跨内核渲染对比：同一份 theme.css 在 Chromium 与 WebKit 下是不是长得一样。

用途：改玻璃底栏、镜面环、safe-area 这类「靠合成层吃饭」的样式之前先跑一遍，
避免把 Chromium 上调好的参数当成全平台真理。

    pnpm build
    npx vite preview --port 4199 --strictPort &
    xvfb-run -a python3 scripts/probe-webkit.py

依赖 playwright 的 webkit 内核：`python3 -m playwright install webkit`
（Linux 还需要 `playwright install-deps`，或手装 libwoff1 / libsecret-1-0 / libhyphen0 等）。

退出码：0 表示两边一致（关键像素差 ≤3），1 表示分叉，需要人看一眼。
"""
import glob
import sys

from PIL import Image
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:4199/'
CSS_GLOB = '/workspace/ghx/dist/assets/index-*.css'
OUT = '/tmp'
TOLERANCE = 8   # 区域均值差阈值。不用单像素差：文字抗锯齿在 WebKit 上明显更粗，
                # 单点能差 70，但那不是玻璃的问题。

# 条纹用 position:fixed 铺满视口，不产生滚动条。
# 第一版没这么做，两边滚动位置不同，底栏背后压着的内容根本不是同一段，
# 亮度差了 50 个单位，看起来像「WebKit 采样不到压暗层」—— 纯属假象。
STRIPES = ''.join(
    '<div style="position:absolute;left:0;right:0;top:%dpx;height:14px;background:%s"></div>'
    % (i * 14, '#ffffff' if i % 2 == 0 else '#000000')
    for i in range(61)
)

DOM = """
<div style="position:fixed;inset:0;overflow:hidden">%s</div>
<div class="app with-tabs" style="position:relative">
  <div class="page"><div class="topbar"><div class="topbar-title">probe</div></div></div>
</div>
<div class="glass-backdrop"></div>
<nav class="tabbar">
  <button class="on"><span>仓库</span></button>
  <button><span>星标</span></button>
  <button><span>热门</span></button>
</nav>
""" % STRIPES

EXTRA = 'html,body{margin:0;overflow:hidden}'

PROBE = """() => {
  const bar = document.querySelector('.tabbar');
  const cs = getComputedStyle(bar);
  const after = getComputedStyle(bar, '::after');
  return {
    backdrop: cs.backdropFilter || cs.webkitBackdropFilter || '',
    bg: cs.backgroundColor,
    maskComposite: after.maskComposite || after.webkitMaskComposite || '',
    maskImage: after.maskImage || after.webkitMaskImage || '',
    rimBg: after.backgroundImage.slice(0, 46),
    rect: bar.getBoundingClientRect().toJSON(),
  };
}"""


def render(engine: str, tag: str):
    with sync_playwright() as p:
        kwargs = {'headless': False}
        if engine == 'chromium':
            kwargs['args'] = [
                '--no-sandbox', '--force-color-profile=srgb',
                '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
            ]
        browser = getattr(p, engine).launch(**kwargs)
        page = browser.new_page(viewport={'width': 390, 'height': 844})
        page.emulate_media(color_scheme='dark')
        page.set_content('<html data-theme="dark"><body>%s</body></html>' % DOM)
        page.add_style_tag(content=open(glob.glob(CSS_GLOB)[0], encoding='utf-8').read())
        page.add_style_tag(content=EXTRA)
        page.wait_for_timeout(450)
        if page.evaluate('window.scrollY') != 0:
            page.evaluate('window.scrollTo(0, 0)')
            page.wait_for_timeout(120)
        info = page.evaluate(PROBE)
        path = f'{OUT}/probe-{tag}.png'
        page.screenshot(path=path)
        version = browser.version
        browser.close()
        return info, path, version


def luma(px):
    return 0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2]


def main() -> int:
    left, left_png, v1 = render('chromium', 'chromium')
    right, right_png, v2 = render('webkit', 'webkit')

    print(f'chromium {v1}  vs  webkit {v2}')
    ok = True
    for key in ('backdrop', 'bg', 'maskComposite', 'maskImage', 'rimBg'):
        same = left[key] == right[key]
        ok &= same
        print(f'  {key:14} {"=" if same else "≠"} {left[key][:52]!r}')
        if not same:
            print(f'  {"":14}   webkit: {right[key][:52]!r}')

    rect = left['rect']
    a = Image.open(left_png).convert('RGB')
    b = Image.open(right_png).convert('RGB')
    y_in = int(rect['top']) + 14

    def region(img, x0, x1, y0, y1):
        ps = [img.getpixel((x, y)) for x in range(x0, x1) for y in range(y0, y1)]
        return tuple(sum(p[i] for p in ps) / len(ps) for i in range(3))

    # 只比「没有文字、没有药丸」的空白区。文字抗锯齿两边差得多，会盖住真正的差异。
    boxes = {
        'bar-mid': (200, 330, int(rect['top']) + 4, int(rect['bottom']) - 4),
        'bar-right': (322, 368, int(rect['top']) + 4, int(rect['bottom']) - 4),
        'above': (200, 330, int(rect['top']) - 30, int(rect['top']) - 2),
    }
    worst = 0.0
    for name, (x0, x1, y0, y1) in boxes.items():
        pa, pb = region(a, x0, x1, y0, y1), region(b, x0, x1, y0, y1)
        d = max(abs(pa[i] - pb[i]) for i in range(3))
        worst = max(worst, d)
        print(f'  {name:14} Δ={d:4.1f}  chromium={tuple(round(v) for v in pa)} webkit={tuple(round(v) for v in pb)}')
    ok &= worst <= TOLERANCE

    # 背景高频条纹被抹平说明 blur 真的在跑；没抹平就是兜底的实色分支
    for name, img in (('chromium', a), ('webkit', b)):
        steps = [abs(luma(img.getpixel((x, y_in))) - luma(img.getpixel((x + 8, y_in))))
                 for x in range(x0 + 20, x1 - 20, 8)]
        flat = sum(steps) / len(steps)
        print(f'  {name:14} blur step={flat:.1f}')
        if flat > 6:
            print(f'  !! {name} 的条纹没有被抹平，backdrop-filter 可能没生效')
            ok = False

    print('结果：', '一致' if ok else '有分叉，看 /tmp/probe-*.png')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())

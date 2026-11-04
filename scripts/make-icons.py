#!/usr/bin/env python3
"""从 assets/icon/*.svg 生成 Android 各密度的图标与启动图。

渲染交给无头 Chromium（能把渐变/模糊/滤镜都画对），拼合交给 Pillow。
不是构建依赖：只在改图标时手动跑一次，产物直接提交进 res/。
"""
import os
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, 'android/app/src/main/res')
ICON_DIR = os.path.join(ROOT, 'assets/icon')
FONT_BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'


def render(svg_name: str, size: int, out_png: str) -> None:
    """把一个 svg 渲染成 size×size 的透明 PNG。

    无头 Chromium 的截图高度会比 --window-size 少几十像素（底部被视口裁掉），
    所以窗口开大一圈，再把左上角 size×size 裁出来。
    """
    html = os.path.join(ICON_DIR, '_render.html')
    with open(html, 'w', encoding='utf-8') as f:
        f.write(
            '<!doctype html><html><head><meta charset="utf-8"><style>'
            'html,body{margin:0;padding:0;background:transparent;overflow:hidden}'
            f'img{{display:block;width:{size}px;height:{size}px}}'
            f'</style></head><body><img src="{svg_name}"></body></html>'
        )
    shot = out_png + '.shot.png'
    subprocess.run(
        [
            'chromium', '--headless=new', '--no-sandbox', '--disable-gpu',
            '--hide-scrollbars', '--default-background-color=00000000',
            '--force-device-scale-factor=1', '--virtual-time-budget=2500',
            f'--window-size={size},{size + 240}',
            f'--screenshot={shot}', f'file://{html}',
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    os.remove(html)
    Image.open(shot).convert('RGBA').crop((0, 0, size, size)).save(out_png)
    os.remove(shot)


def trim(im: Image.Image, box: int) -> Image.Image:
    """裁掉透明边并按最长边缩放到 box，得到正方形图"""
    bbox = im.getchannel('A').point(lambda a: 255 if a > 12 else 0).getbbox()
    if bbox:
        im = im.crop(bbox)
    side = max(im.size)
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    canvas.paste(im, ((side - im.width) // 2, (side - im.height) // 2))
    return canvas.resize((box, box), Image.LANCZOS)


def paste_center(base: Image.Image, mark: Image.Image) -> Image.Image:
    out = base.copy()
    out.alpha_composite(mark, ((base.width - mark.width) // 2, (base.height - mark.height) // 2))
    return out


def masked_round(im: Image.Image) -> Image.Image:
    mask = Image.new('L', im.size, 0)
    ImageDraw.Draw(mask).ellipse((0, 0, im.width - 1, im.height - 1), fill=255)
    out = im.copy()
    out.putalpha(mask)
    return out


def main() -> None:
    tmp = tempfile.mkdtemp()

    tile_src = os.path.join(tmp, 'tile.png')
    mark_src = os.path.join(tmp, 'mark.png')
    render('ghx-tile.svg', 1024, tile_src)
    render('ghx-mark.svg', 1400, mark_src)

    tile = Image.open(tile_src).convert('RGBA')
    mark = trim(Image.open(mark_src).convert('RGBA'), 560)  # 钥匙占底板 55%

    full = paste_center(tile, mark)

    # 传统图标：mdpi..xxxhdpi
    for dpi, px in {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}.items():
        out = full.resize((px, px), Image.LANCZOS)
        out.save(os.path.join(RES, f'mipmap-{dpi}/ic_launcher.png'))
        masked_round(out).save(os.path.join(RES, f'mipmap-{dpi}/ic_launcher_round.png'))

    # 自适应图标前景：108dp 画布，内容收在中间 66dp 安全区内
    for dpi, px in {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}.items():
        fg = Image.new('RGBA', (px, px), (0, 0, 0, 0))
        m = trim(Image.open(mark_src).convert('RGBA'), int(px * 0.56))
        fg.alpha_composite(m, ((px - m.width) // 2, (px - m.height) // 2))
        fg.save(os.path.join(RES, f'mipmap-{dpi}/ic_launcher_foreground.png'))

    # 启动图：深色底 + 居中标记 + 字标
    splash_sizes = {
        'drawable/splash.png': (480, 320),
        'drawable-land-mdpi/splash.png': (480, 320),
        'drawable-land-hdpi/splash.png': (800, 480),
        'drawable-land-xhdpi/splash.png': (1280, 720),
        'drawable-land-xxhdpi/splash.png': (1600, 960),
        'drawable-land-xxxhdpi/splash.png': (1920, 1280),
        'drawable-port-mdpi/splash.png': (320, 480),
        'drawable-port-hdpi/splash.png': (480, 800),
        'drawable-port-xhdpi/splash.png': (720, 1280),
        'drawable-port-xxhdpi/splash.png': (960, 1600),
        'drawable-port-xxxhdpi/splash.png': (1280, 1920),
    }
    for rel, (w, h) in splash_sizes.items():
        base = Image.new('RGBA', (w, h), (13, 17, 23, 255))
        d = ImageDraw.Draw(base)
        # 顶部一抹绿光，和图标同源
        glow = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        gd = ImageDraw.Draw(glow)
        r = int(min(w, h) * 0.55)
        gd.ellipse((w // 2 - r, -r, w // 2 + r, r), fill=(94, 224, 138, 26))
        base.alpha_composite(glow.filter(ImageFilter.GaussianBlur(r // 3)))

        m = trim(Image.open(mark_src).convert('RGBA'), int(min(w, h) * 0.30))
        cy = int(h * 0.46)
        base.alpha_composite(m, ((w - m.width) // 2, cy - m.height // 2))

        font_size = max(14, int(min(w, h) * 0.085))
        try:
            font = ImageFont.truetype(FONT_BOLD, font_size)
        except OSError:
            font = ImageFont.load_default()
        text = 'ghx'
        tracking = int(font_size * 0.14)
        width = sum(d.textlength(ch, font=font) for ch in text) + tracking * (len(text) - 1)
        x = (w - width) / 2
        ty = cy + m.height // 2 + int(min(w, h) * 0.06)
        for ch in text:
            d.text((x, ty), ch, font=font, fill=(230, 237, 243, 235))
            x += d.textlength(ch, font=font) + tracking
        base.convert('RGB').save(os.path.join(RES, rel))

    print('ok')


if __name__ == '__main__':
    main()

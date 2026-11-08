#!/usr/bin/env python3
"""图标候选实验室：同一套玻璃底板 × 六个标记，渲染成对比图。

产物只在 /workspace/ghx-icons/，不进仓库、不进构建 —— 这是选型用的草稿板，
定稿后再把对应的 SVG 落进 assets/icon/。
"""
import os
import subprocess

from PIL import Image, ImageDraw, ImageFont

OUT = '/workspace/ghx-icons'
SVG_DIR = os.path.join(OUT, 'svg')
FONT_CN = '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'

defs = """
  <defs>
    <linearGradient id="bg" x1="0.1" y1="0" x2="0.9" y2="1">
      <stop offset="0" stop-color="#1b2634"/>
      <stop offset="0.55" stop-color="#0e1520"/>
      <stop offset="1" stop-color="#070a0e"/>
    </linearGradient>
    <radialGradient id="aura" cx="0.28" cy="0.12" r="0.76">
      <stop offset="0" stop-color="#4c9bff" stop-opacity="0.30"/>
      <stop offset="0.55" stop-color="#4c9bff" stop-opacity="0.07"/>
      <stop offset="1" stop-color="#4c9bff" stop-opacity="0"/>
    </radialGradient>
    <!-- 必须 userSpaceOnUse：默认的 objectBoundingBox 遇到横线/竖线（包围盒高或宽为 0）
         会把渐变退化成黑色，线条直接消失 -->
    <linearGradient id="mk" gradientUnits="userSpaceOnUse" x1="240" y1="220" x2="790" y2="800">
      <stop offset="0" stop-color="#f4fcff"/>
      <stop offset="0.32" stop-color="#a6e2ff"/>
      <stop offset="0.70" stop-color="#4aa8ff"/>
      <stop offset="1" stop-color="#1e6fe8"/>
    </linearGradient>
    <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0.52" stop-color="#000000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.38"/>
    </linearGradient>
    <filter id="soft" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="48"/>
    </filter>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="22"/>
    </filter>
    <clipPath id="tile"><rect width="1024" height="1024" rx="232"/></clipPath>
  </defs>
"""

TILE_OPEN = """
  <g clip-path="url(#tile)">
    <rect width="1024" height="1024" fill="url(#bg)"/>
    <rect width="1024" height="1024" fill="url(#aura)"/>
    <ellipse cx="300" cy="40" rx="430" ry="120" fill="#ffffff" opacity="0.10" filter="url(#soft)"/>
    <rect width="1024" height="1024" fill="url(#shade)"/>
"""

TILE_CLOSE = """
  </g>
  <rect x="3" y="3" width="1018" height="1018" rx="229" fill="none"
        stroke="#ffffff" stroke-opacity="0.12" stroke-width="6"/>
"""

# 每个标记只写「线条」，外面统一套三遍：冷光 / 投影 / 本体
MARKS = {
    'A': ('终端窗', 'Console', """
      <rect x="238" y="286" width="548" height="452" rx="82"/>
      <path d="M374 428l92 76-92 76"/>
      <path d="M544 576h116"/>
    """, 'line'),
    'B': ('提交图', 'Commit graph', """
      <path d="M398 272v480"/>
      <path d="M398 392h150a56 56 0 0 1 56 56v136"/>
      <circle cx="398" cy="272" r="56" fill="url(#mk)" stroke="none"/>
      <circle cx="398" cy="512" r="56" fill="url(#mk)" stroke="none"/>
      <circle cx="398" cy="752" r="56" fill="url(#mk)" stroke="none"/>
      <circle cx="604" cy="640" r="56" fill="url(#mk)" stroke="none"/>
    """, 'line'),
    'C': ('字母 G', 'Monogram', """
      <path d="M660 348a214 214 0 1 0 0 328v-152H520"/>
    """, 'line'),
    'D': ('看板网格', 'Dashboard', """
      <rect x="272" y="272" width="204" height="204" rx="54" opacity="0.85"/>
      <rect x="548" y="272" width="204" height="204" rx="54" opacity="0.42"/>
      <rect x="272" y="548" width="204" height="204" rx="54" opacity="0.42"/>
      <rect x="548" y="548" width="204" height="204" rx="54"
            fill="url(#mk)" stroke="none"/>
    """, 'line'),
    'E': ('代码尖角', 'Brackets', """
      <path d="M398 384L270 512l128 128"/>
      <path d="M626 384l128 128-128 128"/>
      <path d="M512 424v176"/>
    """, 'line'),
    'F': ('层叠卡片', 'Layers', """
      <rect x="268" y="548" width="488" height="200" rx="62" opacity="0.40"/>
      <rect x="300" y="404" width="424" height="180" rx="58" opacity="0.66"/>
      <rect x="336" y="268" width="352" height="160" rx="54"
            fill="url(#mk)" stroke="none"/>
    """, 'line'),
    'G': ('立方体', 'Cube', """
      <path d="M512 236l216 124-216 124-216-124z"/>
      <path d="M296 360v292l216 124 216-124V360"/>
      <path d="M512 484v292"/>
    """, 'line'),
    'H': ('盾与勾', 'Shield', """
      <path d="M512 240l232 74v214c0 118-92 196-232 250-140-54-232-132-232-250V314z"/>
      <path d="M414 512l70 72 134-140"/>
    """, 'line'),
}


def build_svg(mark: str) -> str:
    body = f"""
  <g fill="none" stroke="url(#mk)" stroke-width="46"
     stroke-linecap="round" stroke-linejoin="round">
    <g opacity="0.30" filter="url(#glow)" stroke-width="54">{mark}</g>
    <g transform="translate(5 10)" stroke="#03121f" stroke-opacity="0.42" stroke-width="50">{mark}</g>
    <g>{mark}</g>
  </g>
"""
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" '
        'width="1024" height="1024">' + defs + TILE_OPEN + body + TILE_CLOSE + '</svg>'
    )


def render(svg_path: str, size: int, out_png: str) -> None:
    html = os.path.join(SVG_DIR, '_r.html')
    with open(html, 'w', encoding='utf-8') as f:
        f.write(
            '<!doctype html><html><head><meta charset="utf-8"><style>'
            'html,body{margin:0;padding:0;background:transparent;overflow:hidden}'
            f'img{{display:block;width:{size}px;height:{size}px}}'
            f'</style></head><body><img src="{os.path.basename(svg_path)}"></body></html>'
        )
    shot = out_png + '.shot.png'
    subprocess.run(
        ['chromium', '--headless=new', '--no-sandbox', '--disable-gpu',
         '--hide-scrollbars', '--default-background-color=00000000',
         '--force-device-scale-factor=1', '--virtual-time-budget=2500',
         f'--window-size={size},{size + 240}',
         f'--screenshot={shot}', f'file://{html}'],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    Image.open(shot).convert('RGBA').crop((0, 0, size, size)).save(out_png)
    os.remove(shot)
    os.remove(html)


def main() -> None:
    os.makedirs(SVG_DIR, exist_ok=True)
    icons = {}
    for key, (cn, en, mark, _kind) in MARKS.items():
        svg = os.path.join(SVG_DIR, f'{key}.svg')
        with open(svg, 'w', encoding='utf-8') as f:
            f.write(build_svg(mark))
        big = os.path.join(OUT, f'{key}.png')
        render(svg, 512, big)
        icons[key] = Image.open(big).convert('RGBA')

    # 对比图：3 × 2
    cell_w, cell_h, gap, margin, header = 420, 450, 20, 44, 132
    cols, rows = 4, 2
    W = margin * 2 + cell_w * cols + gap * (cols - 1)
    H = header + margin * 2 + cell_h * rows + gap * (rows - 1)
    sheet = Image.new('RGBA', (W, H), (240, 243, 247, 255))
    d = ImageDraw.Draw(sheet)

    title_f = ImageFont.truetype(FONT_CN, 34)
    label_f = ImageFont.truetype(FONT_CN, 30)
    sub_f = ImageFont.truetype(FONT_CN, 22)

    d.text((margin, 24), 'ghx 图标候选', font=title_f, fill=(17, 24, 39, 255))
    d.text((margin, 74), '同一块玻璃底板 + 同一束冷光，只换标记；A–H 八版', font=sub_f,
           fill=(107, 118, 136, 255))

    for i, key in enumerate(MARKS):
        r, c = divmod(i, cols)
        x = margin + c * (cell_w + gap)
        y = header + margin + r * (cell_h + gap)
        d.rounded_rectangle([x, y, x + cell_w, y + cell_h], radius=28,
                            fill=(255, 255, 255, 255), outline=(226, 231, 238, 255), width=2)
        big = icons[key].resize((300, 300), Image.LANCZOS)
        sheet.alpha_composite(big, (x + (cell_w - 300) // 2, y + 14))
        small = icons[key].resize((56, 56), Image.LANCZOS)
        sheet.alpha_composite(small, (x + (cell_w - 56) // 2, y + 326))
        d.text((x + 26, y + 396), f'{key}', font=label_f, fill=(23, 32, 46, 255))
        cn, en = MARKS[key][0], MARKS[key][1]
        d.text((x + 66, y + 398), cn, font=label_f, fill=(23, 32, 46, 255))
        d.text((x + 66 + 30 * len(cn) + 12, y + 403), en, font=sub_f, fill=(120, 130, 146, 255))

    sheet.convert('RGB').save(os.path.join(OUT, 'sheet.png'), quality=95)
    print('sheet', sheet.size)


if __name__ == '__main__':
    main()

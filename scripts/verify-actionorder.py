"""仓库详情的操作顺序：进排序态 → 上下移动 → 完成 → 关掉重开仍然生效 → 恢复默认。"""
import importlib.util
import os
import re

from playwright.sync_api import sync_playwright

OUT = '/workspace/ghx/docs/screenshots'
BASE = 'http://127.0.0.1:4173/'

_here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('va', os.path.join(_here, 'verify-apkstore.py'))
va = importlib.util.module_from_spec(spec)
spec.loader.exec_module(va)

# 排序面板里的名字是静态的（不随 star 状态变）
ORDER_DEFAULT = [
    'Star / 取消 Star',
    '编辑简介与话题',
    '归档 / 取消归档',
    '转为私有 / 公开',
    '仓库主页',
    '项目自述',
    '工作流',
    '发行版',
    '复刻',
    '复制仓库地址',
    '下载源码 ZIP',
    '删除仓库',
]

# 真实列表里的文案随状态变：这个夹具仓库已 star、未归档、公开
ACTS_DEFAULT = [
    '取消 Star',
    '编辑简介与话题',
    '归档仓库',
    '转为私有',
    '仓库主页',
    '项目自述',
    '工作流',
    '发行版',
    '复刻',
    '复制仓库地址',
    '下载源码 ZIP',
    '删除仓库',
]


def order(pg):
    return [t.strip() for t in pg.locator('.reorder-row .act-txt b').all_inner_texts()]


def acts(pg):
    return [t.strip() for t in pg.locator('.acts .actrow .act-txt b').all_inner_texts()]


def open_detail(pg):
    pg.click('.tabbar button:has-text("仓库")')
    pg.wait_for_selector('.rows .row', timeout=15000)
    pg.wait_for_timeout(400)
    pg.locator('.rows .row').first.click()
    pg.wait_for_selector('.sheet .acts', timeout=10000)
    pg.wait_for_timeout(500)


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch(
            headless=False, args=['--no-sandbox', '--hide-scrollbars', '--force-color-profile=srgb']
        )
        pg, errors = va.new_page(b)
        # 自述会在后台拉 raw，mock 环境必被 CORS 挡；提前掐掉，console 断言才只反映本次改动
        pg.route(re.compile(r'https://github\.com/.*/raw/.*'), lambda r: r.abort())
        open_detail(pg)

        assert '调整操作顺序' in pg.inner_text('.sheet'), '详情里没有排序入口'
        assert acts(pg) == ACTS_DEFAULT, f'初始顺序不是默认：{acts(pg)}'
        print('[0] 详情 12 项操作，顺序与默认一致')

        # ── 1. 进排序态 ──
        pg.click('.linkbtn:has-text("调整操作顺序")')
        pg.wait_for_selector('.reorder-row', timeout=6000)
        before = order(pg)
        assert before == ORDER_DEFAULT, f'排序态应列出全部 12 项：{before}'
        print('[1] 排序态列出 12 项（含当前仓库不可用的）')

        # ── 2. 把「下载源码 ZIP」上移一格 ──
        idx = before.index('下载源码 ZIP')
        pg.locator('.reorder-row', has_text='下载源码 ZIP').locator('button[aria-label*="上移"]').click()
        pg.wait_for_timeout(300)
        after = order(pg)
        assert after.index('下载源码 ZIP') == idx - 1, f'上移没生效：{after}'
        assert after[idx] == before[idx - 1], '被换下去的那项位置不对'
        print(f'[2] 上移生效：{after[idx - 1]} ↔ {after[idx]}')

        # 首项上移、末项下移应被禁用（不许把按钮点成空操作）
        assert pg.locator('.reorder-row').first.locator('button[aria-label*="上移"]').is_disabled()
        assert pg.locator('.reorder-row').last.locator('button[aria-label*="下移"]').is_disabled()
        print('[3] 首尾箭头正确禁用')

        pg.screenshot(path=f'{OUT}/detail-reorder.png')

        # ── 4. 完成后，真实列表跟着变 ──
        pg.click('.reorder-bar .btn:has-text("完成")')
        pg.wait_for_timeout(500)
        shown = acts(pg)
        assert shown.index('下载源码 ZIP') == idx - 1, f'列表顺序没跟着变：{shown}'
        assert len(shown) == 12, f'应有 12 个操作，实际 {len(shown)}'
        pg.screenshot(path=f'{OUT}/detail-ordered.png')
        print('[4] 完成：列表按新顺序渲染')

        # ── 5. 关掉重开，顺序仍然在 ──
        pg.keyboard.press('Escape')
        pg.wait_for_timeout(500)
        open_detail(pg)
        assert acts(pg) == shown, f'重开后顺序丢了：{acts(pg)}'
        print('[5] 重开详情：顺序持久化')

        # ── 6. 恢复默认 ──
        pg.click('.linkbtn:has-text("调整操作顺序")')
        pg.wait_for_selector('.reorder-row', timeout=6000)
        pg.click('.reorder-bar .linkbtn:has-text("恢复默认")')
        pg.wait_for_timeout(400)
        assert order(pg) == ORDER_DEFAULT, f'恢复默认失败：{order(pg)}'
        pg.click('.reorder-bar .btn:has-text("完成")')
        pg.wait_for_timeout(400)
        assert acts(pg) == ACTS_DEFAULT
        print('[6] 恢复默认：回到出厂顺序')

        # 打开详情时后台会去拉自述原文，mock 环境里被 CORS 挡是环境噪声，
        # 不是应用错误；只对剩下的报错较真
        noise = ('CORS', 'ERR_FAILED', 'README', 'codeload')
        real = [e for e in errors if not any(k in e for k in noise)]
        assert not real, f'console 有报错：{real[:3]}'
        print(f'全部断言通过（忽略 {len(errors) - len(real)} 条跨域噪声）')


if __name__ == '__main__':
    main()

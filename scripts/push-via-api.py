"""github.com 直连断掉时，用 Git Data API 把本地提交送上去。

`git push` 走 github.com:443，这条链路在本机经常连不上；
api.github.com 通常还通，所以改走 blobs → trees → commits → PATCH ref。

能处理「本地与远端内容相同、但 commit hash 不同」的分叉：先把远端 main
的 tree 当 base_tree，再只把本地多出来的改动叠上去。

用法：
    TOKEN=ghp_xxx BASE=3e13a9e python3 scripts/push-via-api.py
  BASE 是「本地用来算差异的起点」，默认 gh/main。
"""
import base64
import os
import subprocess
import sys
import time

import requests

OWNER = 'zjkl0330'
REPO = 'ghx'
API = f'https://api.github.com/repos/{OWNER}/{REPO}'
TOKEN = os.environ.get('TOKEN', '').strip()
if not TOKEN:
    sys.exit('缺 TOKEN 环境变量')

S = requests.Session()
S.headers.update({
    'Authorization': f'Bearer {TOKEN}',
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
})


def call(method, path, timeout=120, **kw):
    for attempt in range(4):
        r = S.request(method, f'{API}{path}', timeout=timeout, **kw)
        if r.status_code < 300:
            return r.json() if r.content else {}
        if r.status_code in (502, 503, 504) and attempt < 3:
            time.sleep(2 + attempt * 2)
            continue
        raise SystemExit(f'{method} {path} -> {r.status_code} {r.text[:400]}')
    raise SystemExit('unreachable')


def git(*args):
    return subprocess.run(['git', *args], capture_output=True, text=True, check=True).stdout


def main():
    head = git('rev-parse', 'HEAD').strip()
    base = git('rev-parse', os.environ.get('BASE', 'gh/main')).strip()

    ref = call('GET', '/git/ref/heads/main')
    remote_sha = ref['object']['sha']
    print(f'本地 {base[:7]}..{head[:7]} · 远端 main {remote_sha[:7]}')

    if remote_sha == head:
        print('已同步，无需推送')
        return

    # 分叉的判定：远端那棵树必须和本地 base 的树一致，
    # 否则差异算不准，宁可停下也不要把别人的提交覆盖掉
    remote_tree = call('GET', f'/git/commits/{remote_sha}')['tree']['sha']
    base_tree = git('rev-parse', f'{base}^{{tree}}').strip()
    if remote_tree != base_tree:
        sys.exit(f'远端树 {remote_tree[:7]} 与本地 {base_tree[:7]} 不一致，先 fetch 对齐')

    files = [l for l in git('diff', '--name-status', base, head).splitlines() if l.strip()]
    print(f'待推送 {len(files)} 个文件')

    tree = []
    for line in files:
        status, path = line.split('\t', 1)
        if status == 'D':
            tree.append({'path': path, 'mode': '100644', 'type': 'blob', 'sha': None})
            print(f'  D {path}')
            continue
        raw = open(path, 'rb').read()
        blob = call('POST', '/git/blobs', timeout=300, json={
            'content': base64.b64encode(raw).decode(),
            'encoding': 'base64',
        })
        mode = '100755' if os.access(path, os.X_OK) else '100644'
        tree.append({'path': path, 'mode': mode, 'type': 'blob', 'sha': blob['sha']})
        print(f'  {status} {path} ({len(raw)}B)')

    new_tree = call('POST', '/git/trees', json={'base_tree': remote_tree, 'tree': tree})
    message = git('log', '-1', '--format=%B', head).rstrip()
    commit = call('POST', '/git/commits', json={
        'message': message,
        'tree': new_tree['sha'],
        'parents': [remote_sha],
    })
    print(f'新提交 {commit["sha"][:7]}（树 {new_tree["sha"][:7]}）')

    call('PATCH', '/git/refs/heads/main', json={'sha': commit['sha'], 'force': False})
    print(f'远端 main 已更新 → {commit["sha"]}')
    print('本地对齐：等 github.com 恢复后 git fetch gh main && git reset --soft gh/main')


if __name__ == '__main__':
    main()

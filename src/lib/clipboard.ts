/**
 * 写剪贴板。
 *
 * Capacitor 里页面是 https://localhost，`navigator.clipboard` 通常可用；
 * 但某些 WebView 在只读选区、非用户手势、或权限被拒时会直接 reject，
 * 所以兜一层 `execCommand('copy')`。两条都失败才返回 false，
 * 调用方据此提示「长按手动选择」。
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      ta.setAttribute('readonly', '')
      document.body.appendChild(ta)
      ta.select()
      ta.setSelectionRange(0, text.length)
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

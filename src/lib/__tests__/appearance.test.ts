import { afterEach, describe, expect, it } from 'vitest'
import {
  ACCENTS,
  APPEARANCE_FIELDS,
  APPEARANCE_KEY,
  DEFAULT_APPEARANCE,
  accentDef,
  accentSwatch,
  applyAppearance,
  normalizeAppearance,
  readAppearance,
  serializeAppearance,
  writeAppearance,
  type Appearance,
} from '../appearance'

/** node 环境没有 localStorage，用一个只有 get/set 的替身 */
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  } as Storage
}

const realStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

function installStorage(store: Storage | undefined) {
  Object.defineProperty(globalThis, 'localStorage', {
    value: store,
    configurable: true,
    writable: true,
  })
}

afterEach(() => {
  if (realStorage) Object.defineProperty(globalThis, 'localStorage', realStorage)
  else Reflect.deleteProperty(globalThis as unknown as Record<string, unknown>, 'localStorage')
})

describe('normalizeAppearance', () => {
  it('空值回退到默认外观', () => {
    expect(normalizeAppearance(null)).toEqual(DEFAULT_APPEARANCE)
    expect(normalizeAppearance(undefined)).toEqual(DEFAULT_APPEARANCE)
    expect(normalizeAppearance('nope')).toEqual(DEFAULT_APPEARANCE)
  })

  it('未知强调色回退天蓝', () => {
    expect(normalizeAppearance({ accent: 'rainbow' }).accent).toBe('blue')
  })

  it('逐字段兜底：老数据缺的新字段不会把已有选择抹掉', () => {
    const a = normalizeAppearance({ accent: 'violet', tabbar: 'dock' })
    expect(a.accent).toBe('violet')
    expect(a.tabbar).toBe('dock')
    expect(a.glass).toBe('normal')
    expect(a.motion).toBe('full')
  })

  it('六类取值都认得', () => {
    const a = normalizeAppearance({
      accent: 'rose',
      tabbar: 'dock',
      tabLabel: 'icon',
      bg: 'glow',
      glass: 'thick',
      motion: 'calm',
    })
    expect(a).toEqual({
      accent: 'rose',
      tabbar: 'dock',
      tabLabel: 'icon',
      bg: 'glow',
      glass: 'thick',
      motion: 'calm',
    })
  })

  it('把 null / 数字 / 布尔当成非法值', () => {
    const a = normalizeAppearance({
      accent: 1,
      tabbar: null,
      tabLabel: true,
      bg: [],
      glass: {},
      motion: 'CALM',
    })
    expect(a).toEqual(DEFAULT_APPEARANCE)
  })
})

describe('applyAppearance', () => {
  it('把六个选择写成 data 属性', () => {
    const root = { dataset: {} as Record<string, string> }
    applyAppearance(
      {
        accent: 'teal',
        tabbar: 'dock',
        tabLabel: 'icon',
        bg: 'glow',
        glass: 'clear',
        motion: 'calm',
      },
      root,
    )
    expect(root.dataset).toEqual({
      accent: 'teal',
      tabbar: 'dock',
      tablabel: 'icon',
      bg: 'glow',
      glass: 'clear',
      motion: 'calm',
    })
  })

  it('写到 DOM 之前先归一化，脏值不会变成不存在的选择器', () => {
    const root = { dataset: {} as Record<string, string> }
    applyAppearance({ ...DEFAULT_APPEARANCE, accent: 'nope' as Appearance['accent'] }, root)
    expect(root.dataset.accent).toBe('blue')
  })

  it('没有根节点时不抛错', () => {
    expect(() => applyAppearance(DEFAULT_APPEARANCE, null)).not.toThrow()
    expect(() =>
      applyAppearance(DEFAULT_APPEARANCE, {} as { dataset?: Record<string, string> }),
    ).not.toThrow()
  })
})

describe('存取', () => {
  it('写入后再读出是同一份', () => {
    installStorage(fakeStorage())
    const a: Appearance = {
      accent: 'amber',
      tabbar: 'dock',
      tabLabel: 'icon',
      bg: 'glow',
      glass: 'thick',
      motion: 'calm',
    }
    writeAppearance(a)
    expect(readAppearance()).toEqual(a)
    expect(globalThis.localStorage.getItem(APPEARANCE_KEY)).toBe(JSON.stringify(a))
  })

  it('坏 JSON 回退默认值，不抛错', () => {
    installStorage(fakeStorage({ [APPEARANCE_KEY]: '{not json' }))
    expect(readAppearance()).toEqual(DEFAULT_APPEARANCE)
  })

  it('没有 localStorage 时读写都不抛', () => {
    installStorage(undefined)
    expect(() => writeAppearance(DEFAULT_APPEARANCE)).not.toThrow()
    expect(readAppearance()).toEqual(DEFAULT_APPEARANCE)
  })

  it('序列化丢掉未知字段', () => {
    const raw = JSON.stringify({ ...DEFAULT_APPEARANCE, injected: 'x' })
    expect(serializeAppearance(JSON.parse(raw) as Appearance)).toBe(
      JSON.stringify(DEFAULT_APPEARANCE),
    )
  })
})

describe('色板', () => {
  it('六个强调色且 key 唯一', () => {
    expect(ACCENTS).toHaveLength(6)
    expect(new Set(ACCENTS.map((a) => a.key)).size).toBe(6)
  })

  it('每个色块都有深浅两档颜色', () => {
    for (const a of ACCENTS) {
      expect(a.dark).toMatch(/^#[0-9a-f]{6}$/)
      expect(a.light).toMatch(/^#[0-9a-f]{6}$/)
      expect(a.label.length).toBeGreaterThan(0)
    }
  })

  it('色块按主题取对应一档', () => {
    const blue = accentDef('blue')
    expect(accentSwatch(blue, 'dark')).toBe('#2f81f7')
    expect(accentSwatch(blue, 'light')).toBe('#0969da')
  })

  it('未知 key 回退到第一项，不会渲染出空色块', () => {
    expect(accentDef('nope' as never)).toBe(ACCENTS[0])
  })

  it('首屏白名单覆盖全部选择', () => {
    expect(APPEARANCE_FIELDS.accent).toEqual(ACCENTS.map((a) => a.key))
    expect(APPEARANCE_FIELDS.tabbar).toContain(DEFAULT_APPEARANCE.tabbar)
    expect(APPEARANCE_FIELDS.tabLabel).toContain(DEFAULT_APPEARANCE.tabLabel)
    expect(APPEARANCE_FIELDS.glass).toContain('thick')
    expect(APPEARANCE_FIELDS.motion).toContain('calm')
  })
})

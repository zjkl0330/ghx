import { describe, expect, it } from 'vitest'
import {
  MAX_TOPICS,
  MAX_TOPIC_LEN,
  mergeTopics,
  normalizeTopic,
  parseTopics,
  topicsToInput,
} from '../topics'

describe('话题归一化', () => {
  it('转小写、空格转连字符、去非法字符', () => {
    expect(normalizeTopic('  React Native ')).toBe('react-native')
    expect(normalizeTopic('C++')).toBe('c')
    expect(normalizeTopic('a@@b')).toBe('ab')
  })

  it('压缩重复连字符并去掉首尾连字符', () => {
    expect(normalizeTopic('--foo---bar--')).toBe('foo-bar')
  })

  it('超长截到 50 字符', () => {
    const long = 'a'.repeat(80)
    expect(normalizeTopic(long)).toHaveLength(MAX_TOPIC_LEN)
  })

  it('中文话题会被清空，不产生无意义的空话题', () => {
    expect(normalizeTopic('前端')).toBe('')
  })
})

describe('话题输入解析', () => {
  it('中英文逗号、顿号、空格都能当分隔符', () => {
    expect(parseTopics('react, tauri，android、kotlin github')).toEqual([
      'react',
      'tauri',
      'android',
      'kotlin',
      'github',
    ])
  })

  it('去重且忽略空项', () => {
    expect(parseTopics('React, react,, ,tauri')).toEqual(['react', 'tauri'])
  })

  it('最多 20 个，多余的丢掉', () => {
    const input = Array.from({ length: 30 }, (_, i) => `t${i}`).join(',')
    expect(parseTopics(input)).toHaveLength(MAX_TOPICS)
  })

  it('回填用逗号加空格', () => {
    expect(topicsToInput(['a', 'b'])).toBe('a, b')
    expect(topicsToInput(null)).toBe('')
  })
})

describe('合并话题（批量加话题）', () => {
  it('保留原有，追加新的', () => {
    expect(mergeTopics(['react'], ['tauri'])).toEqual(['react', 'tauri'])
  })

  it('重复的（大小写不同）不重复加', () => {
    expect(mergeTopics(['React'], ['react', 'vue'])).toEqual(['react', 'vue'])
  })

  it('原有话题也做归一化，脏值丢掉', () => {
    expect(mergeTopics(['Bad Topic', '中文', 'ok'], [])).toEqual(['bad-topic', 'ok'])
  })

  it('合并后不超过 20 个', () => {
    const many = Array.from({ length: 18 }, (_, i) => `t${i}`)
    const out = mergeTopics(many, ['a', 'b', 'c', 'd'])
    expect(out).toHaveLength(MAX_TOPICS)
    expect(out.slice(0, 18)).toEqual(many)
  })

  it('空输入不炸', () => {
    expect(mergeTopics(null, [])).toEqual([])
    expect(mergeTopics(undefined, ['x'])).toEqual(['x'])
  })
})

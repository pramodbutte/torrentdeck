import { describe, it, expect } from 'vitest'
import {
  magnetInfohash,
  magnetName,
  isMagnet,
  extractMagnets,
  dedupeMagnets,
  magnetLabel
} from './magnet'

const HEX = 'magnet:?xt=urn:btih:c9e15763f722f23e98a29decdfae341b98d53056&dn=Ubuntu+24.04'
const HEX_OTHER_TRACKERS =
  'magnet:?xt=urn:btih:C9E15763F722F23E98A29DECDFAE341B98D53056&dn=ubuntu&tr=udp%3A%2F%2Ftracker.example%3A80'
const BASE32 = 'magnet:?xt=urn:btih:MFRGGZDFMZTWQ2LKNNWG23TP&dn=Some%20File'
const NO_HASH = 'magnet:?dn=nameonly'

describe('magnetInfohash', () => {
  it('parses hex btih, lowercased', () => {
    expect(magnetInfohash(HEX)).toBe('c9e15763f722f23e98a29decdfae341b98d53056')
  })
  it('parses base32 btih, lowercased', () => {
    expect(magnetInfohash(BASE32)).toBe('mfrggzdfmztwq2lknnwg23tp')
  })
  it('returns null when absent', () => {
    expect(magnetInfohash(NO_HASH)).toBeNull()
    expect(magnetInfohash('not a magnet')).toBeNull()
  })
})

describe('magnetName', () => {
  it('decodes + and %xx', () => {
    expect(magnetName(HEX)).toBe('Ubuntu 24.04')
    expect(magnetName(BASE32)).toBe('Some File')
  })
  it('null when no dn', () => {
    expect(magnetName('magnet:?xt=urn:btih:abc')).toBeNull()
  })
})

describe('isMagnet / extractMagnets', () => {
  it('detects magnets', () => {
    expect(isMagnet('  magnet:?xt=…')).toBe(true)
    expect(isMagnet('https://x')).toBe(false)
  })
  it('extracts many from multi-line paste, in order', () => {
    const text = `${HEX}\n  \n${BASE32}\nhttps://ignored\n${NO_HASH}`
    expect(extractMagnets(text)).toEqual([HEX, BASE32, NO_HASH])
  })
})

describe('dedupeMagnets', () => {
  it('dedupes by infohash across differing trackers/case, keeps first', () => {
    expect(dedupeMagnets([HEX, HEX_OTHER_TRACKERS, BASE32])).toEqual([HEX, BASE32])
  })
  it('keeps hashless magnets by exact string', () => {
    expect(dedupeMagnets([NO_HASH, NO_HASH, 'magnet:?dn=other'])).toEqual([
      NO_HASH,
      'magnet:?dn=other'
    ])
  })
})

describe('magnetLabel', () => {
  it('prefers dn, falls back to short hash', () => {
    expect(magnetLabel(HEX)).toBe('Ubuntu 24.04')
    expect(magnetLabel('magnet:?xt=urn:btih:c9e15763f722f23e98a29decdfae341b98d53056')).toBe(
      'c9e15763f722f23e…'
    )
  })
})

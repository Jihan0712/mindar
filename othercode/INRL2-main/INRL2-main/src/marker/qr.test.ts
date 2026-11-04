import { describe, expect, it } from 'vitest'
import { markerCode } from './qr.ts'

describe('markerCode', () => {
  it('reads the code from an InRL marker link on any host', () => {
    expect(markerCode('https://inrl2.pages.dev/m/test')).toBe('test')
    expect(markerCode('https://inrl2.marine-469.workers.dev/m/ab12cd34')).toBe('ab12cd34')
    expect(markerCode('http://localhost:5173/m/sample1')).toBe('sample1')
  })

  it('tolerates a trailing slash, query, hash, spaces and upper case', () => {
    expect(markerCode('https://inrl.app/m/test/')).toBe('test')
    expect(markerCode('https://inrl.app/m/test?ref=print#x')).toBe('test')
    expect(markerCode('  https://inrl.app/m/test\n')).toBe('test')
    expect(markerCode('HTTPS://INRL.APP/M/TEST')).toBeNull() // path prefix must be /m/
    expect(markerCode('https://inrl.app/m/TEST')).toBe('test')
  })

  it('rejects anything that is not a marker link', () => {
    expect(markerCode('test')).toBeNull()
    expect(markerCode('')).toBeNull()
    expect(markerCode('https://inrl.app/')).toBeNull()
    expect(markerCode('https://inrl.app/m/')).toBeNull()
    expect(markerCode('https://inrl.app/x/test')).toBeNull()
    expect(markerCode('https://inrl.app/m/test/extra')).toBeNull()
    expect(markerCode('https://inrl.app/u/m/test')).toBeNull()
    expect(markerCode('ftp://inrl.app/m/test')).toBeNull()
    expect(markerCode('javascript:alert(1)//m/test')).toBeNull()
  })

  it('enforces the code format: 4 to 16 lower-case letters and digits', () => {
    expect(markerCode('https://inrl.app/m/abc')).toBeNull()
    expect(markerCode('https://inrl.app/m/abcd')).toBe('abcd')
    expect(markerCode('https://inrl.app/m/abcdefghij123456')).toBe('abcdefghij123456')
    expect(markerCode('https://inrl.app/m/abcdefghij1234567')).toBeNull()
    expect(markerCode('https://inrl.app/m/ab-cd')).toBeNull()
    expect(markerCode('https://inrl.app/m/ab%20cd')).toBeNull()
  })
})

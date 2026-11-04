// Converts the look-test fonts (assets/fonts/*.ttf, SIL OFL) into three.js
// "typeface" JSON so 3D text can be built in the browser without shipping a
// font parser. Only the characters people can type are kept, which keeps the
// files small. The conversion is three.js's own TTFLoader logic.
//
//   node scripts/make-look-fonts.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import opentype from 'opentype.js'

const FONTS = ['UnifrakturCook-Bold', 'TitanOne-Regular', 'Bungee-Regular']
const CHARS = new Set(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 !?&.,'-+#@*",
)

function convert(font) {
  const round = Math.round
  const scale = 100000 / ((font.unitsPerEm || 2048) * 72)
  const glyphs = {}
  for (const ch of CHARS) {
    const glyph = font.charToGlyph(ch)
    if (!glyph || glyph.index === 0) continue
    let o = ''
    for (const c of glyph.path.commands) {
      const type = c.type.toLowerCase() === 'c' ? 'b' : c.type.toLowerCase()
      o += type + ' '
      if (c.x !== undefined) o += round(c.x * scale) + ' ' + round(c.y * scale) + ' '
      if (c.x1 !== undefined) o += round(c.x1 * scale) + ' ' + round(c.y1 * scale) + ' '
      if (c.x2 !== undefined) o += round(c.x2 * scale) + ' ' + round(c.y2 * scale) + ' '
    }
    const box = glyph.getBoundingBox()
    glyphs[ch] = { ha: round(glyph.advanceWidth * scale), x_min: round(box.x1 * scale), x_max: round(box.x2 * scale), o }
  }
  return {
    glyphs,
    familyName: font.getEnglishName('fullName'),
    ascender: round(font.ascender * scale),
    descender: round(font.descender * scale),
    underlinePosition: font.tables.post.underlinePosition,
    underlineThickness: font.tables.post.underlineThickness,
    boundingBox: { xMin: font.tables.head.xMin, xMax: font.tables.head.xMax, yMin: font.tables.head.yMin, yMax: font.tables.head.yMax },
    resolution: 1000,
  }
}

await mkdir('public/look/fonts', { recursive: true })
for (const name of FONTS) {
  const buf = await readFile(`assets/fonts/${name}.ttf`)
  const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  const json = JSON.stringify(convert(font))
  await writeFile(`public/look/fonts/${name}.json`, json)
  console.log(`${name}: ${(json.length / 1024).toFixed(0)} KB`)
}

/** Generate the Linux hicolor icon size set from build/app-icon.png. */

import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = join(root, 'build', 'app-icon.png')
const outDir = join(root, 'build', 'icons')

// Sizes the freedesktop hicolor theme declares (plus 1024 for the largest
// contexts). Icon-theme lookup skips directories the theme does not declare,
// so shipping a lone 1024 entry renders as a missing launcher icon.
const SIZES = [16, 24, 32, 48, 64, 96, 128, 192, 256, 512, 1024]

mkdirSync(outDir, { recursive: true })
for (const size of SIZES) {
  await sharp(source)
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(join(outDir, `${size}x${size}.png`))
}
console.log(`generated ${SIZES.length} Linux icons in ${outDir}`)

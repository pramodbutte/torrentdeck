// electron-builder hooks that make the Linux AppImage self-describing for
// AppImageUpdate (and clear the AppImage catalog's "no update information"
// warning). electron-builder itself never writes this; it only does its own
// electron-updater blockmap + latest-linux.yml.
//
//  artifactBuildCompleted — fires after electron-builder assembled the
//    AppImage but BEFORE it hashes and uploads it (Packager.emitArtifactBuildCompleted
//    runs this hook, then emits artifactCreated → PublishManager). Here we:
//      1. write the update string into the runtime's `.upd_info` ELF section
//         (a 1024-byte zero-filled slot at the start of the file),
//      2. strip and rebuild the embedded blockmap, handing the new
//         size/sha512/blockMapSize back via event.updateInfo so latest-linux.yml
//         and electron-updater's differential download stay consistent,
//      3. run `zsyncmake` to write <AppImage>.zsync next to the AppImage.
//
//  afterAllArtifactBuild — returns the .zsync files so `--publish` uploads them
//    to the GitHub release alongside the AppImage.
//
// Update string (AppImageSpec "gh-releases-zsync" transport):
//   gh-releases-zsync|<owner>|<repo>|latest|<asset glob>.zsync
// owner/repo come from the `publish` block in electron-builder.yml, the glob
// from the artifact name with the version replaced by `*`.
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildBlockMap } = require('app-builder-lib/out/targets/blockmap/blockmap')

const UPD_INFO_SECTION = '.upd_info'
// Runtime is < 1 MiB; its section-header table sits near its end. Read a
// generous prefix of the AppImage so the whole ELF is in memory.
const ELF_READ_BYTES = 4 * 1024 * 1024

function log(msg) {
  console.log(`  • appimageUpdateInfo: ${msg}`)
}

/** Locate a named section in the ELF64 little-endian runtime at the start of `buf`. */
function findElfSection(buf, wanted) {
  if (buf.length < 64 || buf.readUInt32BE(0) !== 0x7f454c46) throw new Error('AppImage does not start with an ELF header')
  if (buf[4] !== 2) throw new Error('AppImage runtime is not ELF64 (only x64/arm64 runtimes are supported)')
  if (buf[5] !== 1) throw new Error('AppImage runtime is not little-endian')
  const shoff = Number(buf.readBigUInt64LE(0x28))
  const shentsize = buf.readUInt16LE(0x3a)
  const shnum = buf.readUInt16LE(0x3c)
  const shstrndx = buf.readUInt16LE(0x3e)
  if (shoff + shnum * shentsize > buf.length) throw new Error('ELF section headers lie beyond the bytes read')
  const section = (i) => {
    const o = shoff + i * shentsize
    return {
      nameOffset: buf.readUInt32LE(o),
      offset: Number(buf.readBigUInt64LE(o + 0x18)),
      size: Number(buf.readBigUInt64LE(o + 0x20)),
    }
  }
  const strtab = section(shstrndx)
  for (let i = 0; i < shnum; i++) {
    const s = section(i)
    const start = strtab.offset + s.nameOffset
    const end = buf.indexOf(0, start)
    if (buf.toString('ascii', start, end) === wanted) return s
  }
  return null
}

function updateString(event) {
  const publish = event.packager.config.publish
  const cfg = Array.isArray(publish) ? publish[0] : publish
  if (cfg == null || typeof cfg !== 'object' || cfg.provider !== 'github' || !cfg.owner || !cfg.repo) {
    throw new Error('AppImage update info needs a `publish` block with provider: github, owner and repo')
  }
  const version = event.packager.appInfo.version
  const base = path.basename(event.file)
  if (!base.includes(version)) throw new Error(`cannot derive asset glob: "${base}" does not contain version ${version}`)
  return `gh-releases-zsync|${cfg.owner}|${cfg.repo}|latest|${base.replace(version, '*')}.zsync`
}

function writeUpdInfo(file, info) {
  const fd = fs.openSync(file, 'r+')
  try {
    const head = Buffer.alloc(ELF_READ_BYTES)
    const n = fs.readSync(fd, head, 0, head.length, 0)
    const section = findElfSection(head.subarray(0, n), UPD_INFO_SECTION)
    if (section == null) throw new Error(`runtime has no ${UPD_INFO_SECTION} section — is toolsets.appimage set?`)
    const payload = Buffer.alloc(section.size) // NUL padded
    if (Buffer.byteLength(info, 'utf8') >= section.size) throw new Error(`update string longer than ${section.size} bytes`)
    payload.write(info, 'utf8')
    fs.writeSync(fd, payload, 0, payload.length, section.offset)
  } finally {
    fs.closeSync(fd)
  }
}

/** Remove the electron-builder blockmap trailer: [deflated blockmap][4-byte BE size]. */
function stripEmbeddedBlockmap(file, expectedBlockMapSize) {
  const { size } = fs.statSync(file)
  const fd = fs.openSync(file, 'r')
  const trailer = Buffer.alloc(4)
  try {
    fs.readSync(fd, trailer, 0, 4, size - 4)
  } finally {
    fs.closeSync(fd)
  }
  const blockMapSize = trailer.readUInt32BE(0)
  if (expectedBlockMapSize != null && blockMapSize !== expectedBlockMapSize) {
    throw new Error(`embedded blockmap size ${blockMapSize} does not match electron-builder's ${expectedBlockMapSize}`)
  }
  fs.truncateSync(file, size - blockMapSize - 4)
}

function makeZsync(file) {
  const out = `${file}.zsync`
  try {
    // -u: URL recorded in the .zsync, relative so it resolves next to the
    // .zsync on the GitHub release.
    execFileSync('zsyncmake', ['-u', path.basename(file), '-o', out, file], { stdio: 'inherit' })
    log(`wrote ${path.basename(out)}`)
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    const msg = 'zsyncmake not found (install the `zsync` package)'
    if (process.env.CI) throw new Error(`${msg}; the release must ship the .zsync`)
    console.warn(`  • appimageUpdateInfo: ${msg}; skipping .zsync for this local build`)
  }
}

exports.artifactBuildCompleted = async function artifactBuildCompleted(event) {
  if (!event.file.endsWith('.AppImage')) return
  const info = updateString(event)
  writeUpdInfo(event.file, info)
  log(`embedded update info "${info}"`)
  stripEmbeddedBlockmap(event.file, event.updateInfo && event.updateInfo.blockMapSize)
  event.updateInfo = await buildBlockMap(event.file, 'deflate')
  log('rebuilt embedded blockmap')
  makeZsync(event.file)
}

exports.afterAllArtifactBuild = function afterAllArtifactBuild(result) {
  return result.artifactPaths
    .filter((p) => p.endsWith('.AppImage'))
    .map((p) => `${p}.zsync`)
    .filter((p) => fs.existsSync(p))
}

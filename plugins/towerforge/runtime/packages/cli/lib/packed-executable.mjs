import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
const PACKED_MAGIC = Buffer.from("TFPK", "ascii");
const PACKED_SUFFIX = ".towerforge-packed";
const cache = new Map();

function hashFile(filePath) {
  const hash = crypto.createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const fd = fs.openSync(filePath, "r");
  try {
    let offset = 0;
    let bytesRead;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, offset);
      if (bytesRead > 0) {
        hash.update(buffer.subarray(0, bytesRead));
        offset += bytesRead;
      }
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function readMagic(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    const magic = Buffer.alloc(4);
    if (fs.readSync(fd, magic, 0, magic.length, 0) !== magic.length) throw new Error("Packed executable is truncated.");
    return magic;
  } finally {
    fs.closeSync(fd);
  }
}

function writeMagic(filePath, magic) {
  const fd = fs.openSync(filePath, "r+");
  try {
    fs.writeSync(fd, magic, 0, magic.length, 0);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function readManifest(packedPath) {
  const value = JSON.parse(fs.readFileSync(`${packedPath}.json`, "utf8"));
  const validHash = (hash) => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash);
  if (
    value?.format !== "towerforge-packed-executable-v1" ||
    !validHash(value.originalSha256) ||
    !validHash(value.packedSha256) ||
    !Number.isSafeInteger(value.size) ||
    value.size < 4
  ) {
    throw new Error("Packed executable manifest is invalid.");
  }
  return value;
}

function ensurePrivateDirectory(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Packed executable destination must be a private directory.");
  try { fs.chmodSync(dir, 0o700); } catch { /* Windows and managed filesystems may ignore POSIX modes. */ }
}

export function packExecutableForBundle(executablePath) {
  if (!readMagic(executablePath).equals(ELF_MAGIC)) throw new Error(`Expected an ELF executable: ${executablePath}`);
  const originalSha256 = hashFile(executablePath);
  const size = fs.statSync(executablePath).size;
  const packedPath = `${executablePath}${PACKED_SUFFIX}`;
  fs.renameSync(executablePath, packedPath);
  writeMagic(packedPath, PACKED_MAGIC);
  fs.chmodSync(packedPath, 0o600);
  const manifest = {
    format: "towerforge-packed-executable-v1",
    size,
    originalSha256,
    packedSha256: hashFile(packedPath)
  };
  fs.writeFileSync(`${packedPath}.json`, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return { packedPath, manifest };
}

export function restorePackedExecutable(packedPath, destinationDir) {
  const manifest = readManifest(packedPath);
  const cacheKey = `${packedPath}:${manifest.originalSha256}`;
  const cached = cache.get(cacheKey);
  if (cached && fs.existsSync(cached)) return cached;
  if (fs.statSync(packedPath).size !== manifest.size || hashFile(packedPath) !== manifest.packedSha256) {
    throw new Error("Packed executable failed integrity verification.");
  }
  if (!readMagic(packedPath).equals(PACKED_MAGIC)) throw new Error("Packed executable marker is invalid.");

  ensurePrivateDirectory(destinationDir);
  const destination = path.join(destinationDir, `claude-${manifest.originalSha256.slice(0, 16)}`);
  if (fs.existsSync(destination)) {
    if (fs.statSync(destination).size !== manifest.size || hashFile(destination) !== manifest.originalSha256) {
      throw new Error("Restored executable failed integrity verification.");
    }
    try { fs.chmodSync(destination, 0o700); } catch { /* Windows and managed filesystems may ignore POSIX modes. */ }
    cache.set(cacheKey, destination);
    return destination;
  }

  const temporary = `${destination}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.copyFileSync(packedPath, temporary, fs.constants.COPYFILE_EXCL);
    writeMagic(temporary, ELF_MAGIC);
    if (fs.statSync(temporary).size !== manifest.size || hashFile(temporary) !== manifest.originalSha256) {
      throw new Error("Restored executable failed integrity verification.");
    }
    fs.chmodSync(temporary, 0o700);
    fs.renameSync(temporary, destination);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  cache.set(cacheKey, destination);
  return destination;
}

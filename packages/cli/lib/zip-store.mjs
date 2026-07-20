import fs from "node:fs";
import path from "node:path";

// Minimal deterministic ZIP writer using the portable "store" method (no compression). Keeping it
// here avoids a system `zip` dependency on Windows and makes release artifacts reproducible.
export function writeDirectoryZip(sourceDir, outputPath, options = {}) {
  const root = fs.realpathSync(sourceDir);
  const excluded = new Set((options.exclude ?? []).map((item) => path.resolve(sourceDir, item)));
  const files = collectFiles(root).filter((entry) => !excluded.has(entry.absolute));
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of files) {
    const name = Buffer.from(entry.relative, "utf8");
    const data = fs.readFileSync(entry.absolute);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 filenames
    local.writeUInt16LE(0, 8); // store
    local.writeUInt16LE(0, 10); // deterministic 00:00
    local.writeUInt16LE(0x0021, 12); // 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4); // Unix, ZIP 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temp = `${outputPath}.tmp-${process.pid}`;
  fs.writeFileSync(temp, Buffer.concat([...localParts, ...centralParts, end]));
  fs.renameSync(temp, outputPath);
  return { outputPath, fileCount: files.length, size: fs.statSync(outputPath).size };
}

function collectFiles(root) {
  const result = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Refusing to archive symlink: ${absolute}`);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) result.push({ absolute, relative: path.relative(root, absolute).split(path.sep).join("/") });
    }
  };
  walk(root);
  return result;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

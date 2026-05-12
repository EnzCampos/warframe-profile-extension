import { deflateRawSync } from "node:zlib";
import { mkdir, readFile, rm, stat, writeFile, readdir, copyFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

let crcTable;

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const distDir = join(rootDir, "dist");
const runtimeEntries = ["manifest.json", "popup.html", "options.html", "icons", "src"];

const packageJson = JSON.parse(await readFile(join(rootDir, "package.json"), "utf8"));
const zipName = `${packageJson.name}-${packageJson.version}.zip`;
const zipPath = join(distDir, zipName);

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

for (const entry of runtimeEntries) {
  await copyRuntimeEntry(join(rootDir, entry), join(distDir, entry));
}

await validateManifest();

const files = await listFiles(distDir);
await writeZip(zipPath, files);

console.log(`Built extension in ${relative(rootDir, distDir)}`);
console.log(`Created ${relative(rootDir, zipPath)}`);

async function copyRuntimeEntry(source, target) {
  const sourceStat = await stat(source);

  if (sourceStat.isDirectory()) {
    await mkdir(target, { recursive: true });
    const entries = await readdir(source, { withFileTypes: true });

    for (const entry of entries) {
      await copyRuntimeEntry(join(source, entry.name), join(target, entry.name));
    }

    return;
  }

  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
}

async function validateManifest() {
  const manifestPath = join(distDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  const requiredFiles = [
    manifest.action?.default_popup,
    manifest.background?.service_worker,
    manifest.options_page,
    ...(manifest.content_scripts ?? []).flatMap((script) => script.js ?? []),
  ].filter(Boolean);

  if (manifest.manifest_version !== 3) {
    throw new Error("manifest.json must use Manifest V3.");
  }

  for (const file of requiredFiles) {
    try {
      await stat(join(distDir, file));
    } catch {
      throw new Error(`manifest.json references a missing file: ${file}`);
    }
  }
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listFiles(fullPath)));
    } else {
      files.push({
        archivePath: relative(distDir, fullPath).split(sep).join("/"),
        fullPath,
      });
    }
  }

  return files.sort((left, right) => left.archivePath.localeCompare(right.archivePath));
}

async function writeZip(target, sourceFiles) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const sourceFile of sourceFiles) {
    const rawData = await readFile(sourceFile.fullPath);
    const compressedData = deflateRawSync(rawData, { level: 9 });
    const name = Buffer.from(sourceFile.archivePath);
    const crc = crc32(rawData);
    const { date, time } = toDosDateTime(new Date());

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressedData.length, 18);
    localHeader.writeUInt32LE(rawData.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, name, compressedData);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(date, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressedData.length, 20);
    centralHeader.writeUInt32LE(rawData.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);

    offset += localHeader.length + name.length + compressedData.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(sourceFiles.length, 8);
  end.writeUInt16LE(sourceFiles.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  await writeFile(target, Buffer.concat([...localParts, centralDirectory, end]));
}

function toDosDateTime(dateValue) {
  const year = Math.max(dateValue.getFullYear(), 1980);

  return {
    date: ((year - 1980) << 9) | ((dateValue.getMonth() + 1) << 5) | dateValue.getDate(),
    time: (dateValue.getHours() << 11) | (dateValue.getMinutes() << 5) | Math.floor(dateValue.getSeconds() / 2),
  };
}

function crc32(data) {
  crcTable ??= createCrcTable();

  let crc = 0xffffffff;

  for (const byte of data) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function createCrcTable() {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
}

export interface ZipFile {
  name: string;
  data: Uint8Array;
}

const ZIP16_MAX = 0xffff;
const ZIP32_MAX = 0xffffffff;
const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const END_RECORD_SIZE = 22;

const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return crc >>> 0;
});

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function write16(target: Uint8Array, offset: number, value: number): number {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  return offset + 2;
}

function write32(target: Uint8Array, offset: number, value: number): number {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
  return offset + 4;
}

function assertClassicZipLimit(value: number, maximum: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${label} exceeds the supported classic ZIP limit.`);
  }
}

function dosDateTime(now: Date): { time: number; date: number } {
  const year = Math.max(1980, now.getFullYear());
  const date = ((year - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  return { time, date };
}

interface PreparedFile extends ZipFile {
  encodedName: Uint8Array;
  crc: number;
  localOffset: number;
}

export function createZip(files: readonly ZipFile[]): Uint8Array {
  assertClassicZipLimit(files.length, ZIP16_MAX, "ZIP file count");

  const encoder = new TextEncoder();
  const prepared: PreparedFile[] = [];
  let localSize = 0;
  let centralSize = 0;
  const { time: dosTime, date: dosDate } = dosDateTime(new Date());

  for (const file of files) {
    const encodedName = encoder.encode(file.name);
    assertClassicZipLimit(encodedName.length, ZIP16_MAX, `ZIP path ${file.name}`);
    assertClassicZipLimit(file.data.length, ZIP32_MAX, `ZIP file ${file.name}`);
    assertClassicZipLimit(localSize, ZIP32_MAX, "ZIP local offset");
    prepared.push({
      ...file,
      encodedName,
      crc: crc32(file.data),
      localOffset: localSize,
    });
    localSize += LOCAL_HEADER_SIZE + encodedName.length + file.data.length;
    centralSize += CENTRAL_HEADER_SIZE + encodedName.length;
    assertClassicZipLimit(localSize, ZIP32_MAX, "ZIP local data");
    assertClassicZipLimit(centralSize, ZIP32_MAX, "ZIP directory");
  }

  const totalSize = localSize + centralSize + END_RECORD_SIZE;
  assertClassicZipLimit(totalSize, ZIP32_MAX, "ZIP archive");
  const result = new Uint8Array(totalSize);
  let localOffset = 0;
  let centralOffset = localSize;

  for (const file of prepared) {
    localOffset = write32(result, localOffset, 0x04034b50);
    localOffset = write16(result, localOffset, 20);
    localOffset = write16(result, localOffset, 0x0800);
    localOffset = write16(result, localOffset, 0);
    localOffset = write16(result, localOffset, dosTime);
    localOffset = write16(result, localOffset, dosDate);
    localOffset = write32(result, localOffset, file.crc);
    localOffset = write32(result, localOffset, file.data.length);
    localOffset = write32(result, localOffset, file.data.length);
    localOffset = write16(result, localOffset, file.encodedName.length);
    localOffset = write16(result, localOffset, 0);
    result.set(file.encodedName, localOffset);
    localOffset += file.encodedName.length;
    result.set(file.data, localOffset);
    localOffset += file.data.length;

    centralOffset = write32(result, centralOffset, 0x02014b50);
    centralOffset = write16(result, centralOffset, 20);
    centralOffset = write16(result, centralOffset, 20);
    centralOffset = write16(result, centralOffset, 0x0800);
    centralOffset = write16(result, centralOffset, 0);
    centralOffset = write16(result, centralOffset, dosTime);
    centralOffset = write16(result, centralOffset, dosDate);
    centralOffset = write32(result, centralOffset, file.crc);
    centralOffset = write32(result, centralOffset, file.data.length);
    centralOffset = write32(result, centralOffset, file.data.length);
    centralOffset = write16(result, centralOffset, file.encodedName.length);
    centralOffset = write16(result, centralOffset, 0);
    centralOffset = write16(result, centralOffset, 0);
    centralOffset = write16(result, centralOffset, 0);
    centralOffset = write16(result, centralOffset, 0);
    centralOffset = write32(result, centralOffset, 0);
    centralOffset = write32(result, centralOffset, file.localOffset);
    result.set(file.encodedName, centralOffset);
    centralOffset += file.encodedName.length;
  }

  let endOffset = localSize + centralSize;
  endOffset = write32(result, endOffset, 0x06054b50);
  endOffset = write16(result, endOffset, 0);
  endOffset = write16(result, endOffset, 0);
  endOffset = write16(result, endOffset, files.length);
  endOffset = write16(result, endOffset, files.length);
  endOffset = write32(result, endOffset, centralSize);
  endOffset = write32(result, endOffset, localSize);
  write16(result, endOffset, 0);
  return result;
}

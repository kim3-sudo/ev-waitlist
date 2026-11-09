import zlib from 'node:zlib';

// A plain square PNG, used as the icon of an Apple pass. Apple requires an icon; the operator
// has no icon setting yet, so every pass gets the same green square.
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ICON_RGB = [22, 101, 52];

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(data, zlib.crc32(typeBuf)));
  return Buffer.concat([length, typeBuf, data, crc]);
}

export function iconPng(size) {
  // Each row starts with a filter byte (0 = none), then the pixels.
  const row = Buffer.alloc(1 + size * 3);
  for (let x = 0; x < size; x += 1) row.set(ICON_RGB, 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

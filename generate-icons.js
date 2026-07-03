const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPNG(size) {
  const w = size, h = size;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  const samples = 4;
  const bg = 10;
  const fg = 245;
  const bgRadius = size * 0.1875;

  // Keep the mark inside a generous safe area so Windows taskbar scaling
  // does not make the PWA icon look larger or lower than nearby icons.
  const cx = w / 2;
  const micW = size * 0.17;
  const micH = size * 0.31;
  const micTop = size * 0.23;
  const micRx = micW / 2;
  const arcR = size * 0.17;
  const arcCy = size * 0.485;
  const arcStroke = size * 0.043;
  const stickTop = size * 0.645;
  const stickBot = size * 0.725;
  const baseW = size * 0.085;

  function isBgPoint(x, y) {
    const r = bgRadius;
    if (x >= r && x <= w - r) return true;
    if (y >= r && y <= h - r) return true;
    const cxCorner = x < r ? r : w - r;
    const cyCorner = y < r ? r : h - r;
    const dx = x - cxCorner, dy = y - cyCorner;
    return dx * dx + dy * dy <= r * r;
  }

  function isMicPoint(x, y) {
    // Mic body (rounded rect = rect + two semicircles)
    const micLeft = cx - micW / 2, micRight = cx + micW / 2;
    const bodyTop = micTop + micRx, bodyBot = micTop + micH - micRx;
    if (x >= micLeft && x <= micRight) {
      if (y >= bodyTop && y <= bodyBot) return true;
      const dtx = x - cx, dty = y - bodyTop;
      if (dty < 0 && (dtx * dtx + dty * dty) <= micRx * micRx) return true;
      const dby = y - bodyBot;
      if (dby > 0 && (dtx * dtx + dby * dby) <= micRx * micRx) return true;
    }

    // Arc (half circle below mic)
    const dx = x - cx, dy = y - arcCy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dy >= 0 && dist >= arcR - arcStroke / 2 && dist <= arcR + arcStroke / 2) return true;

    // Stick and base
    if (Math.abs(x - cx) <= arcStroke / 2 && y >= stickTop && y <= stickBot) return true;
    if (Math.abs(y - stickBot) <= arcStroke / 2 && x >= cx - baseW && x <= cx + baseW) return true;

    return false;
  }

  for (let y = 0; y < h; y++) {
    const ro = y * (w * 4 + 1);
    raw[ro] = 0;
    for (let x = 0; x < w; x++) {
      const px = ro + 1 + x * 4;
      let bgCoverage = 0;
      let micCoverage = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const sampleX = x + (sx + 0.5) / samples;
          const sampleY = y + (sy + 0.5) / samples;
          if (isBgPoint(sampleX, sampleY)) bgCoverage++;
          if (isMicPoint(sampleX, sampleY)) micCoverage++;
        }
      }
      const bgT = bgCoverage / (samples * samples);
      const t = bgCoverage ? micCoverage / bgCoverage : 0;
      const channel = Math.round(bg + (fg - bg) * t);

      raw[px] = channel;
      raw[px + 1] = channel;
      raw[px + 2] = channel;
      raw[px + 3] = Math.round(255 * bgT);
    }
  }

  const compressed = zlib.deflateSync(raw);

  function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xEDB88320 : 0); }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
}

[192, 512].forEach(s => {
  const png = createPNG(s);
  fs.writeFileSync(path.join(__dirname, 'public', `icon-${s}.png`), png);
  console.log(`✓ icon-${s}.png (${png.length} bytes)`);
});

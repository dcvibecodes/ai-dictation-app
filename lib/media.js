'use strict';

function extensionForMime(mimeType) {
  const m = (mimeType || '').toLowerCase();
  if (m.includes('mp4') || m.includes('aac') || m.includes('x-m4a')) return 'm4a';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('wav')) return 'wav';
  if (m.includes('webm')) return 'webm';
  return 'bin';
}

module.exports = { extensionForMime };

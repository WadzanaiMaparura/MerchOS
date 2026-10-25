import sharp from 'sharp';
import { readFileSync } from 'node:fs';

const svg = readFileSync(new URL('./merchos-architecture-slide.svg', import.meta.url));
await sharp(svg, { density: 200 })
  .resize(2560, 1440, { fit: 'contain', background: '#ffffff' })
  .png()
  .toFile(new URL('./merchos-architecture-slide.png', import.meta.url).pathname.replace(/^\//, ''));
console.log('PNG written');

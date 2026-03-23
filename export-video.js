const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const file = process.argv[2] || 'instagram-story.html';
const duration = parseInt(process.argv[3] || '10', 10); // seconds
const fps = 30;
const totalFrames = duration * fps;

// Parse --output flag
const outputIdx = process.argv.indexOf('--output');
const outputPath = outputIdx !== -1 && process.argv[outputIdx + 1]
  ? path.resolve(process.argv[outputIdx + 1])
  : path.join(process.env.HOME, 'Desktop', 'breaking-news-reel.mp4');

const framesDir = '/tmp/breaking-news-frames';

(async () => {
  // Clean and create frames dir
  if (fs.existsSync(framesDir)) fs.rmSync(framesDir, { recursive: true });
  fs.mkdirSync(framesDir, { recursive: true });

  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();

  // Full Instagram story resolution
  await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 2 });

  const filePath = `file://${path.resolve(file)}`;
  await page.goto(filePath, { waitUntil: 'networkidle0', timeout: 30000 });

  // Remove the preview scaling and body padding so story fills viewport
  await page.addStyleTag({
    content: `
      @media screen {
        .story { transform: none !important; margin: 0 !important; }
      }
      body { padding: 0 !important; margin: 0 !important; gap: 0 !important; background: #0c0c14 !important; }
    `
  });

  // Wait for fonts and animations to start
  await new Promise(r => setTimeout(r, 2000));

  console.log(`Capturing ${totalFrames} frames at ${fps}fps (${duration}s)...`);

  const frameInterval = 1000 / fps;

  for (let i = 0; i < totalFrames; i++) {
    const framePath = path.join(framesDir, `frame-${String(i).padStart(4, '0')}.png`);
    await page.screenshot({ path: framePath, type: 'png' });

    // Wait for next frame timing
    if (i < totalFrames - 1) {
      await new Promise(r => setTimeout(r, frameInterval));
    }

    if ((i + 1) % 30 === 0) {
      console.log(`  ${i + 1}/${totalFrames} frames captured (${Math.round((i + 1) / totalFrames * 100)}%)`);
    }
  }

  await browser.close();

  console.log('Encoding video with ffmpeg...');

  // Encode with H.264, high quality, Instagram-compatible
  execSync(`ffmpeg -y -framerate ${fps} -i "${framesDir}/frame-%04d.png" \
    -c:v libx264 -preset slow -crf 18 \
    -pix_fmt yuv420p \
    -vf "scale=1080:1920:flags=lanczos" \
    -movflags +faststart \
    "${outputPath}"`, { stdio: 'inherit' });

  console.log(`\nDone! Video exported to ${outputPath}`);

  // Clean up frames
  fs.rmSync(framesDir, { recursive: true });
})();

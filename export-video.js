const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const file = process.argv[2] || 'instagram-story.html';
const duration = parseInt(process.argv[3] || '15', 10); // seconds (10s animation + 5s hold)
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

  // Override preview scaling for full-resolution capture
  await page.addStyleTag({
    content: `
      @media screen {
        .story { transform: none !important; margin: 0 !important; }
      }
      body { padding: 0 !important; margin: 0 !important; gap: 0 !important; background: #0c0c14 !important; }
    `
  });

  // Wait for fonts to fully load
  await page.evaluate(() => document.fonts.ready);
  await new Promise(r => setTimeout(r, 300));

  // Reset all animations and pause them — we'll seek frame by frame
  await page.evaluate(() => {
    document.getAnimations().forEach(a => {
      a.cancel();
      a.play();
      a.pause();
    });
  });

  console.log(`Capturing ${totalFrames} frames at ${fps}fps (${duration}s)...`);

  for (let i = 0; i < totalFrames; i++) {
    const timeMs = (i / fps) * 1000;

    // Seek every animation to the exact time for this frame
    await page.evaluate((t) => {
      document.getAnimations().forEach(a => {
        a.currentTime = t;
      });
    }, timeMs);

    const framePath = path.join(framesDir, `frame-${String(i).padStart(4, '0')}.png`);
    await page.screenshot({ path: framePath, type: 'png' });

    if ((i + 1) % 30 === 0) {
      console.log(`  ${i + 1}/${totalFrames} frames captured (${Math.round((i + 1) / totalFrames * 100)}%)`);
    }
  }

  await browser.close();

  console.log('Encoding video with ffmpeg...');

  // Encode with H.264, high quality, Instagram-compatible
  // Mix in news-alert.wav audio if it exists
  const ffmpegPath = path.join(__dirname, 'node_modules/ffmpeg-static/ffmpeg');
  const audioFile = path.join(__dirname, 'news-alert.wav');
  const hasAudio = fs.existsSync(audioFile);

  if (hasAudio) {
    console.log('Mixing audio from news-alert.wav...');
    execSync(`"${ffmpegPath}" -y -framerate ${fps} -i "${framesDir}/frame-%04d.png" \
      -i "${audioFile}" \
      -c:v libx264 -preset slow -crf 14 \
      -c:a aac -b:a 192k \
      -pix_fmt yuv420p \
      -vf "scale=1080:1920:flags=lanczos" \
      -movflags +faststart \
      "${outputPath}"`, { stdio: 'inherit' });
  } else {
    execSync(`"${ffmpegPath}" -y -framerate ${fps} -i "${framesDir}/frame-%04d.png" \
      -c:v libx264 -preset slow -crf 14 \
      -pix_fmt yuv420p \
      -vf "scale=1080:1920:flags=lanczos" \
      -movflags +faststart \
      "${outputPath}"`, { stdio: 'inherit' });
  }

  console.log(`\nDone! Video exported to ${outputPath}`);

  // Clean up frames
  fs.rmSync(framesDir, { recursive: true });
})();

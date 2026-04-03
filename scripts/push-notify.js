#!/usr/bin/env node
/**
 * Send a push notification to all Daily Brief subscribers.
 *
 * Uses the web-push library (battle-tested RFC 8291 encryption) to send
 * directly to push service endpoints. Fetches subscriptions from the Worker.
 *
 * Usage:
 *   node scripts/push-notify.js "Morning Briefing is live" --type edition
 *   node scripts/push-notify.js "Breaking: PM resigns" --type breaking
 *   node scripts/push-notify.js "Evening Briefing is live"  (defaults to --type edition)
 *
 * Environment variables:
 *   PUSH_WORKER_URL    — Worker URL (default: https://daily-brief-push.thedailybrief.workers.dev)
 *   PUSH_AUTH_TOKEN    — Bearer token for the Worker endpoints
 *   VAPID_PUBLIC_KEY   — VAPID public key (default: built-in)
 *   VAPID_PRIVATE_KEY  — VAPID private key
 *   VAPID_SUBJECT      — mailto: or https:// (default: mailto:ed@thedailybrief.co.uk)
 */

const webpush = require('web-push');

const WORKER_URL = process.env.PUSH_WORKER_URL || 'https://daily-brief-push.thedailybrief.workers.dev';
const AUTH_TOKEN = process.env.PUSH_AUTH_TOKEN;
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || 'BJ8KRLYBThmYGP1dcFNbMpWRJSTnZfe0nWu7cQKxxwK8-wESiXKk6OfJhYI28MykLxj5xSzggp8whn_DYaEWAKw';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:ed@thedailybrief.co.uk';

const SITE_URL = 'https://thedailybrief.co.uk';
const DEPLOY_POLL_INTERVAL = 10_000; // 10 seconds
const DEPLOY_TIMEOUT = 300_000;      // 5 minutes max

function usage() {
  console.error('Usage: node scripts/push-notify.js "<message>" [--type edition|breaking] [--title "Custom Title"] [--url "/path"] [--no-verify]');
  process.exit(1);
}

/**
 * Wait for the live site to reflect the current sw.js cache version.
 * Reads the local sw.js to get the expected version, then polls the
 * live site until it matches or timeout is reached.
 */
async function waitForDeploy() {
  const fs = require('fs');
  const path = require('path');

  // Read expected version from local sw.js
  const swPath = path.resolve(__dirname, '..', 'sw.js');
  const swContent = fs.readFileSync(swPath, 'utf-8');
  const match = swContent.match(/CACHE_NAME\s*=\s*'([^']+)'/);
  if (!match) {
    console.log('  ⚠ Could not read local SW version — skipping deploy check');
    return true;
  }
  const expectedVersion = match[1];
  console.log(`  Waiting for deploy... (expecting ${expectedVersion})`);

  const start = Date.now();
  while (Date.now() - start < DEPLOY_TIMEOUT) {
    try {
      const res = await fetch(`${SITE_URL}/sw.js?_=${Date.now()}`, {
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (res.ok) {
        const text = await res.text();
        if (text.includes(expectedVersion)) {
          const elapsed = ((Date.now() - start) / 1000).toFixed(0);
          console.log(`  ✓ Live site updated (${elapsed}s)`);
          return true;
        }
      }
    } catch {}
    await new Promise(r => setTimeout(r, DEPLOY_POLL_INTERVAL));
  }

  console.error(`  ✗ Deploy not detected after ${DEPLOY_TIMEOUT / 1000}s — sending notification anyway`);
  return false;
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) usage();

  // Parse args
  let body = '';
  let type = 'edition';
  let title = '';
  let url = '/';
  let verify = true;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--type' && args[i + 1]) { type = args[++i]; continue; }
    if (args[i] === '--title' && args[i + 1]) { title = args[++i]; continue; }
    if (args[i] === '--url' && args[i + 1]) { url = args[++i]; continue; }
    if (args[i] === '--no-verify') { verify = false; continue; }
    if (args[i].startsWith('--')) { console.error(`Unknown flag: ${args[i]}`); usage(); }
    body = args[i];
  }

  if (!body) { console.error('Error: message body is required'); usage(); }
  if (!AUTH_TOKEN) { console.error('Error: PUSH_AUTH_TOKEN environment variable is not set'); process.exit(1); }
  if (!VAPID_PRIVATE) { console.error('Error: VAPID_PRIVATE_KEY environment variable is not set'); process.exit(1); }

  // Default titles
  if (!title) {
    title = type === 'breaking' ? 'Breaking — The Daily Brief' : 'The Daily Brief';
  }

  // Configure web-push with VAPID
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

  // Fetch all subscriptions from Worker
  console.log('Fetching subscribers from Worker...');
  const subsRes = await fetch(`${WORKER_URL}/subscriptions`, {
    headers: { 'Authorization': `Bearer ${AUTH_TOKEN}` },
  });

  if (!subsRes.ok) {
    const err = await subsRes.text();
    console.error(`Failed to fetch subscriptions: ${subsRes.status} ${err}`);
    process.exit(1);
  }

  const { subscriptions } = await subsRes.json();
  console.log(`Found ${subscriptions.length} subscriber(s)`);

  if (!subscriptions.length) {
    console.log('No subscribers — nothing to send.');
    return;
  }

  // Wait for GitHub Pages deploy before notifying
  if (verify) {
    await waitForDeploy();
  }

  const payload = JSON.stringify({ title, body, url, type });

  console.log(`\nSending push notification...`);
  console.log(`  Title: ${title}`);
  console.log(`  Body:  ${body}`);
  console.log(`  Type:  ${type}`);
  console.log(`  URL:   ${url}`);

  let sent = 0;
  let failed = 0;

  const results = await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, payload);
        sent++;
      } catch (err) {
        failed++;
        console.error(`  Failed for ${sub.endpoint.slice(0, 60)}...: ${err.statusCode || err.message}`);
        // Clean up expired/invalid subscriptions
        if (err.statusCode === 404 || err.statusCode === 410) {
          try {
            await fetch(`${WORKER_URL}/unsubscribe`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ endpoint: sub.endpoint }),
            });
            console.log('    → Cleaned stale subscription');
          } catch {}
        }
      }
    })
  );

  console.log(`\nDone! Sent: ${sent}, Failed: ${failed}, Total: ${subscriptions.length}`);
}

main().catch(err => { console.error(err); process.exit(1); });

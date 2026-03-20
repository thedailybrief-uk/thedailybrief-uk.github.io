#!/usr/bin/env node
/**
 * Send a push notification to all Daily Brief subscribers.
 *
 * Usage:
 *   node scripts/push-notify.js "Morning Briefing is live" --type edition
 *   node scripts/push-notify.js "Breaking: PM resigns" --type breaking
 *   node scripts/push-notify.js "Evening Briefing is live"  (defaults to --type edition)
 *
 * Environment variables:
 *   PUSH_WORKER_URL  — Worker URL (default: https://daily-brief-push.thedailybrief.workers.dev)
 *   PUSH_AUTH_TOKEN   — Bearer token for the /push endpoint
 */

const WORKER_URL = process.env.PUSH_WORKER_URL || 'https://daily-brief-push.thedailybrief.workers.dev';
const AUTH_TOKEN = process.env.PUSH_AUTH_TOKEN;

function usage() {
  console.error('Usage: node scripts/push-notify.js "<message>" [--type edition|breaking] [--title "Custom Title"] [--url "/path"]');
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) usage();

  // Parse args
  let body = '';
  let type = 'edition';
  let title = '';
  let url = '/';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--type' && args[i + 1]) { type = args[++i]; continue; }
    if (args[i] === '--title' && args[i + 1]) { title = args[++i]; continue; }
    if (args[i] === '--url' && args[i + 1]) { url = args[++i]; continue; }
    if (args[i].startsWith('--')) { console.error(`Unknown flag: ${args[i]}`); usage(); }
    body = args[i];
  }

  if (!body) { console.error('Error: message body is required'); usage(); }
  if (!AUTH_TOKEN) { console.error('Error: PUSH_AUTH_TOKEN environment variable is not set'); process.exit(1); }

  // Default titles
  if (!title) {
    title = type === 'breaking' ? 'Breaking — The Daily Brief' : 'The Daily Brief';
  }

  console.log(`Sending push notification...`);
  console.log(`  Title: ${title}`);
  console.log(`  Body:  ${body}`);
  console.log(`  Type:  ${type}`);
  console.log(`  URL:   ${url}`);

  const res = await fetch(`${WORKER_URL}/push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AUTH_TOKEN}`,
    },
    body: JSON.stringify({ title, body, type, url }),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error(`Error ${res.status}: ${data.error || JSON.stringify(data)}`);
    process.exit(1);
  }

  console.log(`\nDone! Sent: ${data.sent}, Failed: ${data.failed}, Cleaned: ${data.cleaned}, Total: ${data.total}`);
}

main().catch(err => { console.error(err); process.exit(1); });

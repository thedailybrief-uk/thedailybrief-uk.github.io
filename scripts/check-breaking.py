#!/usr/bin/env python3
"""
Auto-cleanup for expired breaking news on The Daily Brief.

Rules:
  - Each breaking story has a max lifetime of 8 hours from its "posted" timestamp.
  - After 3 hours, if a newer story exists, the older one is removed.
  - If ALL stories are expired (>8h), the array is emptied.
  - If changes are made, the script commits and pushes to both remotes.

Runs via macOS LaunchAgent on wake/login and every 30 minutes.
"""

import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path.home() / "ed-news-briefing"
INDEX = REPO / "index.html"

MAX_AGE_HOURS = 8
ROTATION_HOURS = 3


def parse_breaking_stories(html: str) -> tuple[list, int, int]:
    """Extract the breaking-stories JSON array and its position in the HTML."""
    pattern = r'(<script id="breaking-stories" type="application/json">)\s*(\[[\s\S]*?\])\s*(</script>)'
    match = re.search(pattern, html)
    if not match:
        return [], -1, -1
    try:
        stories = json.loads(match.group(2))
    except json.JSONDecodeError:
        return [], -1, -1
    return stories, match.start(2), match.end(2)


def filter_stories(stories: list) -> tuple[list, bool]:
    """Remove expired stories. Returns (filtered_list, changed)."""
    now = datetime.now(timezone.utc)
    kept = []

    for story in stories:
        posted_str = story.get("posted") or story.get("expires")
        if not posted_str:
            continue
        try:
            posted = datetime.fromisoformat(posted_str.replace("Z", "+00:00"))
        except ValueError:
            continue

        age_hours = (now - posted).total_seconds() / 3600

        # Hard expiry: drop anything older than 8 hours
        if age_hours > MAX_AGE_HOURS:
            continue

        kept.append(story)

    # Rotation: if multiple stories remain and the oldest is >3h, drop it
    if len(kept) > 1:
        kept_with_age = []
        for s in kept:
            posted = datetime.fromisoformat(s["posted"].replace("Z", "+00:00"))
            age = (now - posted).total_seconds() / 3600
            kept_with_age.append((s, age))
        # Sort newest first
        kept_with_age.sort(key=lambda x: x[1])
        # Drop stories older than 3h if a newer one exists
        kept = [s for s, age in kept_with_age if age <= ROTATION_HOURS or s == kept_with_age[0][0]]

    changed = len(kept) != len(stories)
    return kept, changed


def update_html(html: str, new_stories: list, start: int, end: int) -> str:
    """Replace the JSON array in the HTML."""
    if new_stories:
        new_json = json.dumps(new_stories, indent=4, ensure_ascii=False)
    else:
        new_json = "[]"
    return html[:start] + new_json + html[end:]


def git_commit_push():
    """Commit and push changes to both remotes."""
    subprocess.run(["git", "add", "index.html"], cwd=REPO, check=True)
    subprocess.run(
        ["git", "commit", "-m", "chore: Auto-remove expired breaking news"],
        cwd=REPO,
        check=True,
    )
    subprocess.run(["git", "push", "origin", "main"], cwd=REPO, check=True)
    subprocess.run(["git", "push", "org", "main"], cwd=REPO, check=True)


def main():
    if not INDEX.exists():
        print("index.html not found")
        sys.exit(1)

    html = INDEX.read_text(encoding="utf-8")
    stories, start, end = parse_breaking_stories(html)

    if not stories:
        print("No breaking stories found — nothing to do.")
        return

    filtered, changed = filter_stories(stories)

    if not changed:
        print(f"All {len(stories)} breaking stories are still within time limits.")
        return

    removed = len(stories) - len(filtered)
    print(f"Removing {removed} expired breaking story/stories ({len(filtered)} remaining).")

    new_html = update_html(html, filtered, start, end)
    INDEX.write_text(new_html, encoding="utf-8")

    try:
        git_commit_push()
        print("Changes committed and pushed to both remotes.")
    except subprocess.CalledProcessError as e:
        print(f"Git error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()

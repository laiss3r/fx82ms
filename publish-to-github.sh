#!/usr/bin/env bash
set -euo pipefail

REPO_NAME="${1:-fx82ms}"
WORKFLOW_FILE="build-android-apk.yml"
ARTIFACT_NAME="fx82ms-debug-apk"

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is required. Install it, then run: gh auth login" >&2
  exit 1
fi

gh auth status >/dev/null

if [ -e .git ]; then
  echo "A Git repository already exists here; refusing to replace it." >&2
  exit 1
fi

git init --initial-branch=main
login="$(gh api user --jq .login)"
user_id="$(gh api user --jq .id)"
git config user.name "$login"
git config user.email "${user_id}+${login}@users.noreply.github.com"
git add -A
git commit -m "Build fx-82MS Android calculator"

echo "Creating public GitHub repository: ${REPO_NAME}"
gh repo create "$REPO_NAME" --public --source=. --remote=origin --push

echo "Waiting for the Android APK workflow to finish..."
run_id=""
for attempt in $(seq 1 45); do
  run_id="$(gh run list --workflow "$WORKFLOW_FILE" --branch main --limit 1 --json databaseId --jq '.[0].databaseId // empty' 2>/dev/null || true)"
  if [[ "$run_id" =~ ^[0-9]+$ ]]; then break; fi
  sleep 2
done

if [[ ! "$run_id" =~ ^[0-9]+$ ]]; then
  echo "Could not find the workflow run. Check the repository's Actions tab." >&2
  exit 1
fi

gh run watch "$run_id" --exit-status
output_dir="./apk-download-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$output_dir"
gh run download "$run_id" --name "$ARTIFACT_NAME" --dir "$output_dir"
echo "Build succeeded. APK downloaded to: ${output_dir}/app-debug.apk"

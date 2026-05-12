#!/usr/bin/env bash
set -euo pipefail

FUNCTION_NAME="${1:-}"
ENV_ID="${2:-${FOPEN_CLOUD_ENV:-${CLOUD_ENV_ID:-}}}"
PROJECT_PATH="$(cd "$(dirname "$0")" && pwd)"
CLI_PATH="${WECHAT_DEVTOOLS_CLI:-/Applications/wechatwebdevtools.app/Contents/MacOS/cli}"

if [[ -z "$FUNCTION_NAME" ]]; then
  echo "Usage: bash uploadCloudFunction.sh <function-name> [env-id]" >&2
  echo "Example: bash uploadCloudFunction.sh tournaments prod-xxxx" >&2
  exit 1
fi

if [[ -z "$ENV_ID" ]]; then
  echo "Missing env id. Pass it as the second argument or set FOPEN_CLOUD_ENV." >&2
  echo "Example: FOPEN_CLOUD_ENV=prod-xxxx bash uploadCloudFunction.sh ${FUNCTION_NAME}" >&2
  exit 1
fi

if [[ ! -x "$CLI_PATH" ]]; then
  echo "WeChat DevTools CLI not found or not executable: $CLI_PATH" >&2
  exit 1
fi

"$CLI_PATH" cloud functions deploy \
  --project "$PROJECT_PATH" \
  --env "$ENV_ID" \
  --names "$FUNCTION_NAME" \
  --remote-npm-install

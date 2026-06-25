#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"

if command -v python3 >/dev/null 2>&1; then
  PYTHON=python3
else
  PYTHON=python
fi

main() {
  CHROME_LOCATION=""

  case "$(uname -s)" in
    Darwin*)
      if [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
        CHROME_LOCATION="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      fi
      ;;
    MINGW*|MSYS*|CYGWIN*)
      if [ -f "/c/Program Files/Google/Chrome/Application/chrome.exe" ]; then
        CHROME_LOCATION='C:\Program Files\Google\Chrome\Application\chrome.exe'
      fi
      ;;
  esac

  set -- --chrome --key --no-headless --skip-webdriver-menu "$@"

  if [ -n "$CHROME_LOCATION" ]; then
    set -- "$@" --custom-browser-location "$CHROME_LOCATION"
  fi

  exec "$PYTHON" main.py "$@"
}

main "$@"

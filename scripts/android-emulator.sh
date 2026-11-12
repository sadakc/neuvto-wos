#!/usr/bin/env bash
# The Android Emulator the Android tests drive: real Android Chrome, with its
# own on-screen keyboard and address bar, which Chrome on a Mac pretending to
# be a phone has neither of (D119).
#
#   bash scripts/android-emulator.sh start                    boot it with a window, to watch
#   bash scripts/android-emulator.sh start --headless
#   bash scripts/android-emulator.sh start --small [--headless]
#   bash scripts/android-emulator.sh stop
#
# Free: Android Studio's SDK (brew install --cask android-studio android-commandlinetools).
# The first start creates the virtual phone: "neuvto-pixel", a Pixel 7 (412 by
# 915), or with --small "neuvto-small", a 360 by 640 phone, where a sheet and
# the keyboard leave the least room. Both Android 15.
set -euo pipefail

export JAVA_HOME=${JAVA_HOME:-"/Applications/Android Studio.app/Contents/jbr/Contents/Home"}
export ANDROID_HOME=${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}
SDK_BIN=$(ls -d "$ANDROID_HOME"/cmdline-tools/*/bin | head -1)
ADB=$ANDROID_HOME/platform-tools/adb
EMULATOR=$ANDROID_HOME/emulator/emulator
AVD=neuvto-pixel
PROFILE=pixel_7
HEADLESS=
for arg in "${@:2}"; do
  case "$arg" in
    --small) AVD=neuvto-small PROFILE=small_phone ;;
    --headless) HEADLESS=1 ;;
  esac
done
IMAGE="system-images;android-35;google_apis;arm64-v8a"

case "${1:-}" in
  start)
    [ -x "$EMULATOR" ] || {
      echo "No emulator. Install it: $SDK_BIN/sdkmanager emulator platform-tools \"$IMAGE\"" >&2
      exit 1
    }
    if ! "$EMULATOR" -list-avds | grep -qx "$AVD"; then
      echo no | "$SDK_BIN/avdmanager" create avd -n "$AVD" -k "$IMAGE" -d "$PROFILE"
      # A small profile's default memory is too little for Chrome under test: it closes mid-run.
      sed -i '' 's/^hw.ramSize=.*/hw.ramSize=3072/' "$HOME/.android/avd/$AVD.avd/config.ini"
    fi
    if "$ADB" devices | grep -q "^emulator-"; then
      echo "An emulator is already running."
      exit 0
    fi
    flags=(-avd "$AVD" -no-snapshot-save -no-boot-anim -netdelay none -netspeed full)
    [ -n "$HEADLESS" ] && flags+=(-no-window -no-audio)
    nohup "$EMULATOR" "${flags[@]}" >/tmp/neuvto-emulator.log 2>&1 &
    "$ADB" wait-for-device
    until [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do sleep 2; done
    # Playwright starts Chrome with its own flags, which needs adb as root.
    "$ADB" root >/dev/null && "$ADB" wait-for-device
    # Chrome's first-run screens would sit in front of every test.
    "$ADB" shell 'echo "chrome --disable-fre --no-default-browser-check --no-first-run" > /data/local/tmp/chrome-command-line'
    "$ADB" shell am set-debug-app --persistent com.android.chrome >/dev/null
    # The keyboard's stylus tutorial would cover the sheet the first time a field is tapped.
    "$ADB" shell settings put secure stylus_handwriting_enabled 0
    echo "Android Emulator ready."
    ;;
  stop) "$ADB" emu kill ;;
  *)
    sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac

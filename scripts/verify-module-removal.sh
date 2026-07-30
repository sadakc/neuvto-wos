#!/usr/bin/env bash
# The requirement, stated as a test.
#
# "Tomorrow, if there are any code changes, I want to ensure we only touch the
# individual module and not the entire code itself."
#
# So: delete a module's folder, delete its line from the registry, and the
# application must still build. If anything outside the folder depended on it,
# this fails — which is the only way to know the boundary is real rather than
# merely intended.
#
# Restores by copy rather than `git checkout`, because a newly added module is
# untracked and git cannot bring it back. That mistake deleted the Leave module
# during development and reported success.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

MODULES_DIR=src/modules
REGISTRY=$MODULES_DIR/registry.ts
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# A read loop rather than mapfile: macOS ships bash 3.2, where mapfile does not
# exist, and this script has to run for a developer as well as in CI.
MODULES=()
while IFS= read -r d; do
  [ -n "$d" ] && MODULES+=("$d")
done < <(find "$MODULES_DIR" -mindepth 1 -maxdepth 1 -type d | sort)

# A pass with nothing tested is the failure mode this whole discipline exists to
# catch. Silence must not read as success.
if [ ${#MODULES[@]} -eq 0 ]; then
  echo "::error::No modules found under $MODULES_DIR — this check verified nothing."
  exit 1
fi

cp -R "$MODULES_DIR" "$WORK/modules-backup"
ORIGINAL_REGISTRY=$(cat "$REGISTRY")
failed=()

restore() {
  rm -rf "$MODULES_DIR"
  cp -R "$WORK/modules-backup" "$MODULES_DIR"
}

for dir in "${MODULES[@]}"; do
  mod=$(basename "$dir")
  echo "── removing $mod"

  rm -rf "$dir"

  # Drop the import line, then remove the identifier from the array literal.
  # Deleting every line that merely mentions the name takes the export with it,
  # and the build then fails for a reason that has nothing to do with coupling.
  MOD="$mod" python3 - "$REGISTRY" <<'PY'
import os, re, sys, pathlib
mod = os.environ["MOD"]
p = pathlib.Path(sys.argv[1])
kept = [l for l in p.read_text().splitlines()
        if not re.match(rf'\s*import\s*{{\s*{re.escape(mod)}\s*}}\s*from', l)]
text = "\n".join(kept)

def strip_array(m):
    parts = [x.strip() for x in m.group(1).split(",") if x.strip() and x.strip() != mod]
    return "[" + ", ".join(parts) + "]"

p.write_text(re.sub(r"\[([^\]]*)\]", strip_array, text) + "\n")
PY

  if bun run typecheck >"$WORK/out.txt" 2>&1; then
    echo "── $mod removed cleanly, the application still builds"
  else
    echo "── $mod could NOT be removed:"
    tail -20 "$WORK/out.txt" | sed 's/^/     /'
    failed+=("$mod")
  fi

  restore
  printf '%s' "$ORIGINAL_REGISTRY" > "$REGISTRY"
done

if [ ${#failed[@]} -gt 0 ]; then
  echo "::error::Removing ${failed[*]} broke the build. Something outside the module folder depends on it — find it with: grep -rn '@/modules/' src --include='*.ts*' | grep -v '^src/modules/'"
  exit 1
fi

echo
echo "── every module can be removed without touching anything else"

#!/usr/bin/env bash
set -euo pipefail

MARKERS=""
if [[ -n "${LEAK_MARKERS:-}" ]]; then
  MARKERS="${LEAK_MARKERS}"
elif [[ -f ".private/leak-markers.txt" ]]; then
  MARKERS="$(cat .private/leak-markers.txt)"
else
  echo "WARN: Neither LEAK_MARKERS nor .private/leak-markers.txt found; skipping brief-leak check." >&2
  exit 0
fi

TRACKED_FILES=()
while IFS= read -r file; do
  if [[ -n "${file}" && -f "${file}" ]]; then
    TRACKED_FILES+=("${file}")
  fi
done < <(git ls-files)

if [[ ${#TRACKED_FILES[@]} -eq 0 ]]; then
  exit 0
fi

LEAK_FOUND=0
while IFS= read -r marker; do
  marker="${marker#"${marker%%[![:space:]]*}"}"
  marker="${marker%"${marker##*[![:space:]]}"}"
  if [[ -z "${marker}" || "${marker}" == \#* ]]; then
    continue
  fi
  if matches="$(grep -iFl -- "${marker}" "${TRACKED_FILES[@]}" || true)" && [[ -n "${matches}" ]]; then
    while IFS= read -r matched_file; do
      echo "ERROR: Brief leak marker matched in tracked file: ${matched_file}" >&2
    done <<< "${matches}"
    LEAK_FOUND=1
  fi
done <<< "${MARKERS}"

if [[ ${LEAK_FOUND} -ne 0 ]]; then
  exit 1
fi

echo "Brief-leak check passed (${#TRACKED_FILES[@]} tracked files scanned)."

#!/usr/bin/env sh
# Regenerate homebrew/projectinator.rb for the version in package.json (run AFTER npm publish,
# the tarball has to exist), then optionally push it to the tap.
#
#   ./scripts/brew-formula.sh          # update homebrew/projectinator.rb
#   ./scripts/brew-formula.sh --push   # also commit + push it to the tap repo
#
# Tap: https://github.com/smanookian/homebrew-projectinator  (Formula/projectinator.rb)
set -eu
cd "$(dirname "$0")/.."
v=$(node -p "require('./package.json').version")
url="https://registry.npmjs.org/projectinator/-/projectinator-$v.tgz"
# Download first, then hash the file. Piping curl into sha256sum hides curl's failure (the
# pipeline reports sha256sum's status) and happily yields the hash of zero bytes — which once
# produced a formula pinned to e3b0c442..., the sha256 of nothing.
tgz=$(mktemp)
trap 'rm -f "$tgz"' EXIT
curl -sfL "$url" -o "$tgz" || { echo "could not fetch $url — is $v published to npm yet?" >&2; exit 1; }
[ -s "$tgz" ] || { echo "$url returned an empty tarball" >&2; exit 1; }
sha=$(sha256sum "$tgz" | cut -d' ' -f1)
sed -i.bak -e "s|^  url \".*\"|  url \"$url\"|" -e "s|^  sha256 \".*\"|  sha256 \"$sha\"|" homebrew/projectinator.rb
rm -f homebrew/projectinator.rb.bak
echo "homebrew/projectinator.rb → $v ($sha)"

[ "${1:-}" = "--push" ] || { echo "run with --push to publish it to the tap"; exit 0; }
tmp=$(mktemp -d)
git clone -q git@github.com:smanookian/homebrew-projectinator.git "$tmp/tap" 2>/dev/null \
  || git clone -q https://github.com/smanookian/homebrew-projectinator.git "$tmp/tap"
cp homebrew/projectinator.rb "$tmp/tap/Formula/projectinator.rb"
git -C "$tmp/tap" add -A
git -C "$tmp/tap" diff --cached --quiet && { echo "tap already at $v"; rm -rf "$tmp"; exit 0; }
git -C "$tmp/tap" commit -qm "Projectinator $v"
git -C "$tmp/tap" push -q origin HEAD
rm -rf "$tmp"
echo "tap updated → brew upgrade projectinator"

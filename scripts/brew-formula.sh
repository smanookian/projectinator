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
sha=$(curl -sfL "$url" | sha256sum | cut -d' ' -f1)
[ -n "$sha" ] || { echo "could not fetch $url — is $v published?" >&2; exit 1; }
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

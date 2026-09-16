#!/usr/bin/env sh
# Regenerate homebrew/projectinator.rb url + sha256 for the version in package.json
# (run after `npm publish`). Then copy the file into the tap repo and commit.
set -eu
cd "$(dirname "$0")/.."
v=$(node -p "require('./package.json').version")
url="https://registry.npmjs.org/projectinator/-/projectinator-$v.tgz"
sha=$(curl -sfL "$url" | sha256sum | cut -d' ' -f1)
sed -i.bak -e "s|^  url \".*\"|  url \"$url\"|" -e "s|^  sha256 \".*\"|  sha256 \"$sha\"|" homebrew/projectinator.rb
rm -f homebrew/projectinator.rb.bak
echo "homebrew/projectinator.rb → $v ($sha)"

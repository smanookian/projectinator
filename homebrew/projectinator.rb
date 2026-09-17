# Homebrew formula for Projectinator. Lives in the tap smanookian/homebrew-projectinator
# (copy this file there as Formula/projectinator.rb); `scripts/brew-formula.sh` regenerates
# url/sha256 for a release.
#
#   brew tap smanookian/projectinator
#   brew install projectinator
class Projectinator < Formula
  desc "Your AI build team in the terminal: PM, Designer, Developer, Reviewer, Tester, Ops"
  homepage "https://github.com/smanookian/projectinator"
  url "https://registry.npmjs.org/projectinator/-/projectinator-0.21.0.tgz"
  sha256 "bf97a26ec3c36267fa3ba34691cfc4186a358958cceb09281bc70de1dc7369c0"
  license "MIT"

  # Unversioned node (24.x) satisfies the engines field (>=22.19) and, unlike the keg-only
  # node@22, is on PATH — which the launcher's `#!/usr/bin/env node` shebang needs.
  depends_on "node"
  depends_on "git"

  def install
    ENV["PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD"] = "1"
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  def caveats
    <<~EOS
      Projects are stored under $PROJECTINATOR_HOME/projects (default: inside the
      package). Set it to keep builds across upgrades:
        export PROJECTINATOR_HOME=~/.projectinator
      For the Tester to really run your apps (headless Chromium):
        npx playwright install chromium
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/projectinator --version")
    assert_match "doctor", shell_output("#{bin}/projectinator --help")
  end
end

# Homebrew formula for Projectinator. Lives in the tap smanookian/homebrew-projectinator
# (copy this file there as Formula/projectinator.rb); `scripts/brew-formula.sh` regenerates
# url/sha256 for a release.
#
#   brew tap smanookian/projectinator
#   brew install projectinator
class Projectinator < Formula
  desc "Your AI build team in the terminal: PM, Designer, Developer, Reviewer, Tester, Ops"
  homepage "https://github.com/smanookian/projectinator"
  url "https://registry.npmjs.org/projectinator/-/projectinator-0.15.0.tgz"
  sha256 "6fbbaf747c05ea06a38997d5d0ea134453340e6a2d923946407f7c60d7942f24"
  license "MIT"

  depends_on "node@22"
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

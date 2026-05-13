# Construct — Homebrew formula template.
#
# Authoritative copy lives in the construct repo at templates/homebrew/
# construct.rb. The tap repo (geraldmaron/homebrew-construct) carries the
# active formula at Formula/construct.rb and is updated by the release
# workflow's Homebrew bump step on every tag push.
#
# When the release pipeline fires for `vX.Y.Z`, dawidd6/action-homebrew-bump-
# formula rewrites the url + sha256 fields for each platform from the
# matching GitHub Release asset. The placeholder SHAs below are only used
# when seeding the tap by hand the first time.
class Construct < Formula
  desc "Local-first agent orchestration layer for AI coding tools"
  homepage "https://github.com/geraldmaron/construct"
  version "0.1.0"
  license "Elastic-2.0"

  livecheck do
    url :stable
    strategy :github_latest
  end

  on_macos do
    on_arm do
      url "https://github.com/geraldmaron/construct/releases/download/v0.1.0/construct-darwin-arm64"
      sha256 "REPLACE_ON_FIRST_RELEASE_DARWIN_ARM64"
    end
    on_intel do
      url "https://github.com/geraldmaron/construct/releases/download/v0.1.0/construct-darwin-x64"
      sha256 "REPLACE_ON_FIRST_RELEASE_DARWIN_X64"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/geraldmaron/construct/releases/download/v0.1.0/construct-linux-arm64"
      sha256 "REPLACE_ON_FIRST_RELEASE_LINUX_ARM64"
    end
    on_intel do
      url "https://github.com/geraldmaron/construct/releases/download/v0.1.0/construct-linux-x64"
      sha256 "REPLACE_ON_FIRST_RELEASE_LINUX_X64"
    end
  end

  def install
    bin.install Dir["construct-*"].first => "construct"
  end

  def caveats
    <<~EOS
      To finish setup on this machine, run:
        construct setup

      Construct uses a local Postgres container (via Docker) for hybrid
      retrieval. If Docker is not installed, Construct falls back to a JSON
      vector index — no hard requirement.

      To wire up hooks and agents per project, add Construct as a dev
      dependency in that project:
        npm install -D @geraldmaron/construct
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/construct version")
  end
end

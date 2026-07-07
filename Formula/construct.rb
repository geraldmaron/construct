# Formula/construct.rb — Homebrew formula for the Bun-compiled Construct binary.
#
# Standard Homebrew tap layout (this file, at Formula/construct.rb in the source
# repo, is what a tap repo's Formula/ directory carries verbatim). Distinct from
# templates/homebrew/construct.rb, which is the existing template for the
# Node-SEA-compiled binaries already shipping via geraldmaron/homebrew-construct
# (see docs/operations/maintenance/homebrew-tap.md) — the two formulas reference
# different release assets and are not interchangeable until the Bun path is
# verified end to end and one is chosen as the shipped binary. Placeholder SHAs
# below are filled in by whichever CI job publishes the Bun binaries; see
# release.yml's existing `homebrew` job for the regenerate-from-release pattern
# this should follow once wired up.
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
        construct init

      Construct uses a local Postgres container (via Docker) for hybrid
      retrieval. If Docker is not installed, Construct falls back to a JSON
      vector index — no hard requirement.
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/construct version")
  end
end

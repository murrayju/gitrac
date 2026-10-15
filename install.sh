#!/bin/bash
# gitrac installer - Install script for macOS/Linux
# Usage: curl -fsSL https://get.gitrac.dev | bash
#
# Environment:
#   GITRAC_VERSION       install a specific version (e.g. 0.2.0) instead of the latest
#   GITRAC_INSTALL_DIR   install directory (default: ~/.local/bin)
#   GITRAC_NONINTERACTIVE=1  never prompt (don't offer to edit your shell rc file)

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

REPO="murrayju/gitrac"
INSTALL_DIR="${GITRAC_INSTALL_DIR:-$HOME/.local/bin}"
# How the install dir is written into shell rc files (keep $HOME unexpanded)
if [ "$INSTALL_DIR" = "$HOME/.local/bin" ]; then
  # shellcheck disable=SC2016
  PATH_ENTRY='$HOME/.local/bin'
else
  PATH_ENTRY="$INSTALL_DIR"
fi
BINARY_NAME="gitrac"

# Detect OS and architecture early (needed by functions)
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin)
    OS_TYPE="darwin"
    SHELL_RC="$HOME/.zshrc"
    ;;
  Linux)
    OS_TYPE="linux"
    if [ -f "$HOME/.zshrc" ]; then
      SHELL_RC="$HOME/.zshrc"
    else
      SHELL_RC="$HOME/.bashrc"
    fi
    ;;
  *)
    OS_TYPE="unknown"
    SHELL_RC="$HOME/.bashrc"
    ;;
esac

case "$ARCH" in
  x86_64|amd64)
    ARCH_TYPE="x64"
    ;;
  arm64|aarch64)
    ARCH_TYPE="arm64"
    ;;
  *)
    ARCH_TYPE="unknown"
    ;;
esac

# --- Function definitions ---

is_interactive() {
  [ -z "$GITRAC_NONINTERACTIVE" ] || return 1
  # When piped (`curl ... | bash`), stdin is the script, so prompts read from
  # /dev/tty. It must actually be openable (it exists but fails in CI/cron).
  { : < /dev/tty; } 2>/dev/null
}

prompt_yn() {
  local prompt="$1"
  local reply
  read -r -p "$prompt [y/N]: " reply < /dev/tty
  [[ "$reply" =~ ^[Yy]$ ]]
}

print_manual_path_instructions() {
  echo ""
  echo "To add it manually, run:"
  echo "  echo 'export PATH=\"$PATH_ENTRY:\$PATH\"' >> $SHELL_RC"
}

ensure_path_configured() {
  # Check if the install dir is in PATH
  if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
    echo ""
    echo -e "${YELLOW}!${NC} $INSTALL_DIR is not in your PATH"

    # Check if the rc file already adds it to PATH
    if grep -qF "$INSTALL_DIR" "$SHELL_RC" 2>/dev/null ||
      { [ "$INSTALL_DIR" = "$HOME/.local/bin" ] && grep -qE '\.local/bin' "$SHELL_RC" 2>/dev/null; }; then
      : # PATH already configured
    elif is_interactive; then
      if prompt_yn "Add $INSTALL_DIR to PATH in $SHELL_RC?"; then
        {
          echo ""
          echo '# Added by gitrac installer'
          echo "export PATH=\"$PATH_ENTRY:\$PATH\""
        } >> "$SHELL_RC"
        echo -e "${GREEN}✓${NC} Added $INSTALL_DIR to PATH in $SHELL_RC"
      else
        print_manual_path_instructions
      fi
    else
      print_manual_path_instructions
    fi

    # Export for current session
    export PATH="$INSTALL_DIR:$PATH"
    echo -e "${YELLOW}!${NC} Restart your shell or run: source $SHELL_RC"
  fi
}

verify_installation() {
  echo ""
  echo -e "${BLUE}Verifying installation...${NC}"

  # Give shell a moment to recognize new binary
  hash -r 2>/dev/null || true

  local version
  if ! version="$("$INSTALL_DIR/$BINARY_NAME" --version 2>/dev/null)"; then
    echo -e "${RED}Error: $INSTALL_DIR/$BINARY_NAME was installed but does not run.${NC}"
    exit 1
  fi

  if command -v "$BINARY_NAME" &> /dev/null; then
    echo -e "${GREEN}✓${NC} gitrac $version is installed!"
    echo ""
    echo -e "${GREEN}${BOLD}Installation complete!${NC}"
    echo ""
    echo "Get started:"
    echo "  cd your-repo"
    echo "  gitrac init        # create .issues/"
    echo "  gitrac             # open the web UI"
    echo ""
    echo "Docs: https://github.com/$REPO#readme"
  else
    echo -e "${YELLOW}!${NC} gitrac $version installed but not found in PATH yet"
    echo ""
    echo "Restart your shell or run:"
    echo "  source $SHELL_RC"
    echo ""
    echo "Then verify with:"
    echo "  gitrac --version"
  fi
}

install_binary() {
  echo ""
  echo -e "${BLUE}Downloading pre-compiled binary...${NC}"

  # Check for unsupported platform
  if [ "$OS_TYPE" = "darwin" ] && [ "$ARCH_TYPE" = "x64" ]; then
    echo -e "${RED}Error: Pre-compiled binaries are not available for Intel Macs (darwin-x64).${NC}"
    echo ""
    echo "If you have an Apple Silicon Mac, the darwin-arm64 binary should work."
    echo ""
    echo "To build from source, clone the repo and use bun:"
    echo "  git clone https://github.com/$REPO.git"
    echo "  cd gitrac && ./bun install && ./bun run scripts/build.ts"
    echo ""
    exit 1
  fi

  BINARY_FILE="gitrac-${OS_TYPE}-${ARCH_TYPE}"

  # Create install directory if it doesn't exist
  mkdir -p "$INSTALL_DIR"

  # Download binary
  TEMP_DIR=$(mktemp -d)
  trap 'rm -rf "$TEMP_DIR"' EXIT

  # Support pinning to a specific version via GITRAC_VERSION env var
  if [ -n "$GITRAC_VERSION" ]; then
    GITRAC_VERSION="${GITRAC_VERSION#v}"
    DOWNLOAD_URL="https://github.com/$REPO/releases/download/v${GITRAC_VERSION}/$BINARY_FILE"
    echo "Detected \$GITRAC_VERSION in env. Fetching version ${GITRAC_VERSION}..."
  else
    DOWNLOAD_URL="https://github.com/$REPO/releases/latest/download/$BINARY_FILE"
    echo "Fetching latest release..."
  fi

  if ! curl -fSL -o "$TEMP_DIR/$BINARY_FILE" "$DOWNLOAD_URL" 2>/dev/null; then
    echo -e "${RED}Error: Failed to download binary.${NC}"
    echo ""
    echo "This could mean:"
    echo "  - No releases have been published yet"
    if [ -n "$GITRAC_VERSION" ]; then
      echo "  - Version ${GITRAC_VERSION} does not exist"
    fi
    echo "  - The release doesn't have a binary for $OS_TYPE-$ARCH_TYPE"
    echo ""
    echo "Releases: https://github.com/$REPO/releases"
    exit 1
  fi

  chmod +x "$TEMP_DIR/$BINARY_FILE"
  mv "$TEMP_DIR/$BINARY_FILE" "$INSTALL_DIR/$BINARY_NAME"

  echo -e "${GREEN}✓${NC} Installed to $INSTALL_DIR/$BINARY_NAME"

  # Ensure the install dir is in PATH
  ensure_path_configured

  verify_installation
}

# --- Main script ---

echo -e "${BLUE}${BOLD}"
cat <<'BANNER'
        _ _
   __ _(_) |_ _ __ __ _  ___
  / _` | | __| '__/ _` |/ __|
 | (_| | | |_| | | (_| | (__
  \__, |_|\__|_|  \__,_|\___|
  |___/
BANNER
echo -e "${NC}"
echo -e "${BLUE}gitrac Installer${NC}"
echo ""

# Check for curl
if ! command -v curl &> /dev/null; then
  echo -e "${RED}Error: curl is required but not installed.${NC}"
  echo ""
  exit 1
fi

# Validate OS detection
if [ "$OS_TYPE" = "unknown" ]; then
  echo -e "${RED}Error: Unsupported OS: $OS${NC}"
  echo "gitrac currently supports macOS and Linux."
  exit 1
fi

if [ "$ARCH_TYPE" = "unknown" ]; then
  echo -e "${RED}Error: Unsupported architecture: $ARCH${NC}"
  exit 1
fi

echo -e "${GREEN}✓${NC} Detected: $OS_TYPE-$ARCH_TYPE"

# Check for existing installation
EXISTING_GITRAC=$(command -v gitrac 2>/dev/null || true)
if [ -n "$EXISTING_GITRAC" ]; then
  echo -e "${YELLOW}!${NC} Existing gitrac found at: $EXISTING_GITRAC"
fi

if ! command -v git &> /dev/null; then
  echo -e "${YELLOW}!${NC} git was not found; gitrac needs git to be installed"
fi

install_binary

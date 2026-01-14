#!/bin/bash
# Install Claude Code and clean up old versions

set -e

echo "🧹 Cleaning up old Claude binaries..."

# Remove old system claude if exists
if [ -f /usr/bin/claude ]; then
  echo "Removing /usr/bin/claude..."
  sudo rm -f /usr/bin/claude
fi

echo "📦 Installing Claude Code via bun..."
bun install -g @anthropic-ai/claude-code

echo "🔗 Setting up symlink..."
CLAUDE_PATH="$(which claude 2>/dev/null || echo "$HOME/.bun/bin/claude")"
if [ -f "$CLAUDE_PATH" ]; then
  sudo ln -sf "$CLAUDE_PATH" /usr/bin/claude
  echo "Symlinked $CLAUDE_PATH -> /usr/bin/claude"
fi

echo "✅ Done! Verifying installation..."
which claude
claude --version

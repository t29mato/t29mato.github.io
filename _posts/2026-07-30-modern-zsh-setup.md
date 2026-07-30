---
layout: post
title: "Rebuilding My zsh Environment: From p10k/peco to Starship and fzf"
date: 2026-07-30
description: "A walkthrough of modernizing a mostly-empty .zshrc with Starship, fzf, zoxide, eza, bat, and zsh plugins — plus fixing mojibake icons by installing a Nerd Font and pointing Terminal.app at it."
tags: [zsh, macos, terminal, dotfiles]
---

I used to run Powerlevel10k for my prompt and peco for fuzzy history search, but at some point my `.zshrc` had been stripped down to almost nothing — just a `PATH` export for Turso. Time to rebuild it with a more current toolset.

## Starting point

Before touching anything, I checked what was actually installed:

- `.zshrc` contained a single `PATH` line, no prompt framework, no plugins.
- Neither Powerlevel10k nor peco were present anymore.
- Homebrew had none of `starship`, `fzf`, `zoxide`, `eza`, `bat`, or `fd` installed.

Since I wanted to compare before/after, I backed up the existing dotfiles first:

```sh
mkdir -p ~/.dotfiles_backup
cp ~/.zshrc ~/.dotfiles_backup/.zshrc.bak_$(date +%Y%m%d_%H%M%S)
cp ~/.zprofile ~/.dotfiles_backup/.zprofile.bak_$(date +%Y%m%d_%H%M%S)
```

## The new toolset

| Purpose | Before | After |
|---|---|---|
| Prompt | none | [Starship](https://starship.rs/) |
| History / file search | peco (removed) | [fzf](https://github.com/junegunn/fzf) — `Ctrl+R` history, `Ctrl+T` files, `Alt+C` cd |
| `cd` | builtin | [zoxide](https://github.com/ajeetdsouza/zoxide) — `z <frecency-ranked dir>` |
| `ls` | builtin | [eza](https://github.com/eza-community/eza) — icons + git status |
| `cat` | builtin | [bat](https://github.com/sharkdp/bat) — syntax highlighting |
| Completion / highlighting | none | `zsh-autosuggestions` + `zsh-syntax-highlighting` |

Installed in one shot:

```sh
brew install starship fzf zsh-autosuggestions zsh-syntax-highlighting zoxide eza bat fd
```

`fzf` 0.74 supports `fzf --zsh` for one-line shell integration, so there was no need for the old `$(brew --prefix)/opt/fzf/install` script dance.

The resulting `.zshrc`:

```sh
# Turso
export PATH="$PATH:/Users/t29mato/.turso"

# --- Starship prompt ---
eval "$(starship init zsh)"

# --- fzf (history search: Ctrl+R, file search: Ctrl+T, cd search: Alt+C) ---
source <(fzf --zsh)

# --- zoxide (smarter cd, use `z` instead of `cd`) ---
eval "$(zoxide init zsh)"

# --- eza (modern ls) ---
alias ls="eza --icons"
alias ll="eza -l --icons --git"
alias la="eza -la --icons --git"
alias lt="eza --tree --icons"

# --- bat (modern cat) ---
alias cat="bat --paging=never"

# --- zsh-autosuggestions ---
source /opt/homebrew/share/zsh-autosuggestions/zsh-autosuggestions.zsh

# --- zsh-syntax-highlighting (must be sourced last) ---
source /opt/homebrew/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh
```

I verified it loaded cleanly with `script -q /dev/null zsh -i -c 'echo OK'` — running `zsh -i -c` directly (no pty) throws a harmless `can't change option: zle` from the plugins trying to bind keys with no terminal attached; under a real pty it's silent.

## Fixing mojibake icons

First load with `eza --icons` produced garbled glyphs in front of every filename — Japanese filenames themselves were fine, it was specifically the icon characters. `eza`'s icons come from the Nerd Font glyph set, and Terminal.app's default font (`SFMono-Regular`) doesn't include them.

Fix: install a Nerd Font and point Terminal.app's profile at it.

```sh
brew install --cask font-hack-nerd-font
```

Then set the font on the active Terminal.app profile via AppleScript (found the current default profile with `defaults read com.apple.Terminal "Default Window Settings"`, which returned `Basic`):

```sh
osascript \
  -e 'tell application "Terminal" to set font name of settings set "Basic" to "Hack Nerd Font Mono"' \
  -e 'tell application "Terminal" to set font name of (default settings) to "Hack Nerd Font Mono"'
```

New tabs picked up the font immediately and `ll` rendered correctly — per-extension icons (`.json`, `.srt`, etc.) and distinct folder icons, with the Japanese filenames intact.

## Result

```
❯ ll
.rw-r--r--@ 345k t29mato 15 Apr 19:43  260614_カウンセリング.json
.rw-r--r--@  57k t29mato 15 Apr 19:43 󰨖 260614_カウンセリング.srt
drwxr-xr-x@    - t29mato 31 Jul 04:27  Applications
drwx------@    - t29mato 22 Apr 21:13  Desktop
...
```

Total time from empty `.zshrc` to a working Starship + fzf + Nerd Font setup: one `brew install`, one rewritten `.zshrc`, and one `osascript` call. The old dotfiles are still sitting in `~/.dotfiles_backup` if I ever want to diff against them.

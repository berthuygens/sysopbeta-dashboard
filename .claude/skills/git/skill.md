---
name: git
description: Automatically commit, push, and create a PR. Use /git to create PR only, use /git -a to also auto-merge with admin rights.
user_invocable: true
---

# Git Auto-Push & PR Skill

This skill automates the entire git workflow: commit, push, create PR, and optionally merge.

## Usage

- `/git` - Commit all changes, push, and create a PR (no merge)
- `/git -a` - Commit all changes, push, create PR, AND auto-merge with admin rights

## Workflow

Execute these steps automatically WITHOUT asking for user confirmation:

### Step 1: Check for changes
```bash
git status
git diff --stat
```

If no changes exist, inform the user and stop.

### Step 2: Analyze changes and create commit message
- Look at all changed files
- Create a concise, descriptive commit message based on the actual changes
- Use conventional commit style (feat:, fix:, refactor:, style:, docs:, etc.)

### Step 3: Create a feature branch
```bash
git checkout -b auto/<timestamp>-<short-description>
```
Use format: `auto/YYYYMMDD-HHMMSS-short-description`

### Step 4: Stage and commit all changes
```bash
git add -A
git commit -m "<commit message>"
```

### Step 5: Push to remote
```bash
git push -u origin <branch-name>
```

### Step 6: Create Pull Request
```bash
gh pr create --title "<PR title>" --body "<PR body>"
```

Generate a logical PR title based on the changes. The body should include:
- Summary of changes (bullet points)
- Auto-generated note

### Step 7: Handle -a flag (auto-merge)
If the `-a` flag was provided:
```bash
gh pr merge --admin --squash
```

Then checkout main and pull:
```bash
git checkout main
git pull
```

## Important Rules

1. **NO USER INTERACTION** - Execute all steps automatically
2. **NO CONFIRMATIONS** - Do not ask "should I proceed?"
3. **LOGICAL NAMING** - Generate meaningful branch/PR names from the actual changes
4. **ALWAYS SQUASH** - When merging with -a, always use --squash
5. **USE --admin** - When merging, always use --admin to bypass branch protection
6. **CLEAN UP** - After merge, return to main branch

## Example Output

```
> Analyzing changes...
> Creating branch: auto/20240107-143022-terminal-style-updates
> Committing: style: update dashboard to terminal aesthetic
> Pushing to origin...
> Creating PR: "Terminal style updates for dashboard"
> PR created: https://github.com/user/repo/pull/42
[If -a flag]: > Merging PR with admin rights...
[If -a flag]: > Merged successfully, back on main
```

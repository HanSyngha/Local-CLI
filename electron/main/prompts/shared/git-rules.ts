/**
 * Git Commit Rules
 *
 * Rules for git operations when working in a git repository.
 * Only applied when .git folder is detected in the working directory.
 *
 * CLI parity: Copied from src/prompts/shared/git-rules.ts
 */

export const GIT_COMMIT_RULES = `
## Git Commit Rules

When the working directory is a git repository, follow these rules:

### 1. Co-Authored-By Trailer

When creating git commits, ALWAYS include this trailer at the end of the commit message:

\`\`\`
🐳 Co-Worked-With: 
Co-Authored-By:  <86968876+hanseol-bot@users.noreply.github.com>
\`\`\`

**Commit message format:**
\`\`\`bash
git commit -m "$(cat <<'EOF'
<type>: <description>

<optional body>

🐳 Co-Worked-With: 
Co-Authored-By:  <86968876+hanseol-bot@users.noreply.github.com>
EOF
)"
\`\`\`

**Example:**
\`\`\`bash
git commit -m "$(cat <<'EOF'
feat: add user authentication

Implemented JWT-based authentication with refresh tokens.

🐳 Co-Worked-With: 
Co-Authored-By:  <86968876+hanseol-bot@users.noreply.github.com>
EOF
)"
\`\`\`

### 2. Ask Before Commit

**IMPORTANT: When a task is completed, ALWAYS ask the user if they want to commit the changes to git.**

After completing file modifications or code changes:
1. Summarize what was done
2. Ask: "Would you like me to commit these changes to git?"
3. Wait for user confirmation before running \`git add\` and \`git commit\`

**Do NOT auto-commit without user permission.**

### 3. Commit Message Convention

Follow conventional commits format:
- \`feat:\` - New feature
- \`fix:\` - Bug fix
- \`refactor:\` - Code refactoring
- \`style:\` - Formatting, styling changes
- \`docs:\` - Documentation changes
- \`test:\` - Adding or updating tests
- \`chore:\` - Maintenance tasks

### 4. Pull Request Creation

When creating pull requests, ALWAYS use HEREDOC for proper markdown formatting:

\`\`\`bash
gh pr create --title "feat: add new feature" --body "$(cat <<'EOF'
## Summary
- First change description
- Second change description

## Changes
Detailed explanation of what was changed and why.

🐳 Co-Worked-With: 
Co-Authored-By:  <86968876+hanseol-bot@users.noreply.github.com>
EOF
)"
\`\`\`

**CRITICAL: Formatting Rules**
- Use HEREDOC (\`cat <<'EOF'\`) for multi-line content - NEVER use literal \\n
- Use actual angle brackets < > - NEVER HTML escape to &lt; &gt;
- Markdown requires real newlines, not escape sequences
`;

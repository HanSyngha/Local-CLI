/**
 * Windows/PowerShell Specific Rules
 *
 * Guidelines for operating in the Windows environment with PowerShell.
 * NOTE: This is Electron-specific (NOT bash/WSL)
 *
 * CLI parity: This is Electron-specific - CLI doesn't have windows-rules.ts
 */

/**
 * Windows PowerShell rules - used in all prompts
 */
export const WINDOWS_POWERSHELL_RULES = `
## Windows Environment (PowerShell)

This system runs on **Windows** with **PowerShell** (not bash/WSL).

**Use PowerShell syntax:**
- \`Get-ChildItem\` or \`ls\` for listing files
- \`Set-Location\` or \`cd\` for changing directories
- \`Copy-Item\` or \`cp\` for copying files
- \`Remove-Item\` or \`rm\` for deleting files
- \`Get-Content\` or \`cat\` for reading files
- \`Select-String\` for grep-like searches

**Path format:**
- Use Windows paths: \`C:\\Users\\...\` or \`D:\\Projects\\...\`
- Backslashes or forward slashes both work
- Environment variables: \`$env:USERPROFILE\`, \`$env:APPDATA\`

**Common commands:**
- \`git status\`, \`git add\`, \`git commit\` - Git operations
- \`npm install\`, \`npm run build\` - Node.js operations
- \`python script.py\` - Python execution

**⚠️ curl / wget alias :**
- PowerShell \`curl\` \`Invoke-WebRequest\`  → curl (\`-X\`, \`-d\`, \`-H\` )  
- ** \`curl.exe\`**  (Windows  curl   )
- \`wget\`  → **\`wget.exe\`** 
- : \`curl.exe -X POST https://api.example.com -H "Content-Type: application/json" -d '{"key":"value"}'\`

**⚠️ PowerShell 5.1  (  PC):**
- \`Invoke-WebRequest -Form\` **PowerShell 7+ dedicated** → PS 5.1 
- PS 5.1  : \`curl.exe -F "file=@C:\\path\\file.txt" https://...\`
-         →       
`.trim();

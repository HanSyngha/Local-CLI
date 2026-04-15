/**
 * Slash Command Processor
 *
 * Utilities for detecting slash command triggers and processing command selections
 */

export interface SlashCommandInfo {
  detected: boolean;
  position: number;
  partialCommand: string;
  fullCommand: string | null;
  args: string;
}

export interface CommandMetadata {
  name: string;
  description: string;
  argsHint?: string;
  aliases?: string[];
  handler?: (args: string) => void | Promise<void>;
}

/**
 * Available slash commands with descriptions
 */
export const SLASH_COMMANDS: CommandMetadata[] = [
  {
    name: '/exit',
    description: 'Exit the application',
    aliases: ['/quit'],
  },
  {
    name: '/clear',
    description: 'Clear conversation and TODOs',
  },
  {
    name: '/compact',
    description: 'Compact conversation to free up context',
  },
  {
    name: '/settings',
    description: 'Open settings menu',
  },
  {
    name: '/model',
    description: 'Switch between LLM models',
  },
  {
    name: '/load',
    description: 'Load a saved session',
  },
  {
    name: '/tool',
    description: 'Enable/disable optional tools (Browser, Background)',
    aliases: ['/tools'],
  },
  {
    name: '/usage',
    description: 'Show token usage statistics',
  },
  {
    name: '/context',
    description: 'Show loaded context.md contents and path',
  },
  {
    name: '/help',
    description: 'Show help message',
  },
];

/**
 * Detect slash command trigger in input string
 * Returns position, partial command, and full command if complete
 */
export function detectSlashTrigger(input: string): SlashCommandInfo {
  // Only match a single '/' at the start of input (no spaces before)
  // Explicitly reject '//' or multiple slashes
  if (input.startsWith('//')) {
    return {
      detected: false,
      position: -1,
      partialCommand: '',
      fullCommand: null,
      args: '',
    };
  }

  const slashMatch = input.match(/^\/([^\s]*)([\s](.*))?$/);

  if (!slashMatch) {
    return {
      detected: false,
      position: -1,
      partialCommand: '',
      fullCommand: null,
      args: '',
    };
  }

  const partialCommand = slashMatch[1] || '';
  const args = slashMatch[3] || '';
  const fullInput = `/${partialCommand}`;

  // Check if this is a complete command (including aliases)
  const matchedCommand = SLASH_COMMANDS.find(
    (cmd) => cmd.name === fullInput || cmd.aliases?.includes(fullInput)
  );

  return {
    detected: true,
    position: 0,
    partialCommand,
    fullCommand: matchedCommand ? matchedCommand.name : null,
    args,
  };
}

/**
 * Filter commands based on partial input
 * Returns up to maxResults commands that match the partial command
 * Includes both primary commands and aliases
 */
export function filterCommands(
  partialCommand: string,
  maxResults: number = 10
): CommandMetadata[] {
  if (!partialCommand) {
    return SLASH_COMMANDS.slice(0, maxResults);
  }

  const filtered = SLASH_COMMANDS.filter((cmd) => {
    const searchTerm = `/${partialCommand.toLowerCase()}`;
    // Match primary command or any alias
    return (
      cmd.name.toLowerCase().startsWith(searchTerm) ||
      cmd.aliases?.some((alias) => alias.toLowerCase().startsWith(searchTerm))
    );
  });

  return filtered.slice(0, maxResults);
}

/**
 * Check if a command is valid and complete
 * Validates both primary commands and aliases
 */
export function isValidCommand(input: string): boolean {
  const trimmed = input.trim();
  return SLASH_COMMANDS.some(
    (cmd) =>
      trimmed.startsWith(cmd.name) ||
      cmd.aliases?.some((alias) => trimmed.startsWith(alias))
  );
}

/**
 * Get argument hint for a specific command
 */
export function getCommandArgsHint(commandName: string): string | undefined {
  const command = SLASH_COMMANDS.find((cmd) => cmd.name === commandName);
  return command?.argsHint;
}

/**
 * Insert selected command into input
 * Replaces the partial command with the full command
 */
export function insertSlashCommand(
  _input: string,
  selectedCommand: string
): string {
  // Replace everything with the selected command and add a space
  return `${selectedCommand} `;
}

---
name: find-skills
description: Discover and list available Claude Code skills, slash commands, and capabilities
user_invocable: true
---

# Find Skills

When invoked, search for and list all available skills the user can use.

## Steps

1. Run `claude --help` to check available CLI commands
2. List built-in slash commands by checking the help output
3. Check for project-level skills in `.claude/skills/` directories (current project and parent directories)
4. Check for user-level skills in `~/.claude/skills/`
5. Check for MCP servers configured in `.claude/settings.json` or `~/.claude/settings.json`

## Output Format

Present the results organized by category:

### Project Skills (`.claude/skills/`)
List each `.md` file found with its name and description from frontmatter.

### Built-in Slash Commands
List the common slash commands: `/help`, `/clear`, `/config`, `/model`, `/memory`, `/review`, `/init`, etc.

### MCP Servers
List any configured MCP servers and their available tools.

### Tips
- Skills are `.md` files in `.claude/skills/` with frontmatter (name, description, user_invocable)
- User-invocable skills can be called with `/skill-name`
- Project skills apply to the current workspace
- User skills in `~/.claude/skills/` apply globally

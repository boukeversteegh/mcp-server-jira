# JIRA MCP Server

This is a Model Context Protocol (MCP) server that provides tools for interacting with JIRA. It allows you to fetch tickets from active sprints and get detailed ticket information through the MCP interface.

## Features

The server provides the following tools:

1. `list-sprint-tickets`: Gets all tickets in the active sprint for a given project
   - Required parameter: `projectKey` (string)

2. `get-ticket-details`: Gets detailed information about a specific ticket
   - Required parameter: `issueKey` (string)

3. `add-comment`: Adds a comment to a specific ticket
   - Required parameter: `issueKey` (string)
   - Either `comment` (string) or `filePath` (string) — see [Editing content from a file](#editing-content-from-a-file)
   - Optional parameter: `commentFormat` — `plain` (default), `wiki`, `markdown` or `adf`

4. `link-tickets`: Links two tickets with a 'relates to' relationship
   - Required parameter: `sourceIssueKey` (string)
   - Required parameter: `targetIssueKey` (string)

5. `update-description`: Updates the description of a specific ticket
   - Required parameter: `issueKey` (string)
   - Either `description` (string) or `filePath` (string) — see [Editing content from a file](#editing-content-from-a-file)
   - Optional parameter: `descriptionFormat` — `plain` (default), `wiki`, `markdown` or `adf`

6. `list-child-issues`: Gets all child issues of a parent ticket
   - Required parameter: `parentKey` (string)

7. `create-sub-ticket`: Creates a sub-ticket (child issue) for a parent ticket
   - Required parameter: `parentKey` (string)
   - Required parameter: `summary` (string)
   - Optional parameter: `description` (string)
   - Optional parameter: `issueType` (string) - The name of the sub-task issue type (e.g., 'Sub-task')

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Build the TypeScript code:

This step is only needed for Cline on Windows, which currently has an issue executing npx

   ```bash
   npm run build
   ```

3. Configure the MCP settings in your Claude app settings file (usually located at `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS or `%APPDATA%/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` on Windows):

Settings for Claude:

```json
{
  "mcpServers": {
    "jira": {
      "command": "npx",
      "args": ["path/to/this/repo/jira.ts"],
      "env": {
        "JIRA_HOST": "https://your-domain.atlassian.net",
        "JIRA_EMAIL": "your-email@example.com",
        "JIRA_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

Settings for Cline:

```json
{
  "mcpServers": {
    "jira": {
      "command": "node",
      "args": ["path/to/this/repo/dist/jira.js"],
      "env": {
        "JIRA_HOST": "https://your-domain.atlassian.net",
        "JIRA_EMAIL": "your-email@example.com",
        "JIRA_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

## Configuration

You'll need to set up the following environment variables in your MCP settings:

1. `JIRA_HOST`: Your Atlassian domain URL (e.g., `https://your-company.atlassian.net`)
2. `JIRA_EMAIL`: Your JIRA account email
3. `JIRA_API_TOKEN`: Your JIRA API token
   - You can generate an API token from your [Atlassian Account Settings](https://id.atlassian.com/manage-profile/security/api-tokens)

## Usage

Once configured, you can use the tools through the MCP interface in Claude:

### List Sprint Tickets

To get all tickets in the active sprint for a project:

```typescript
<use_mcp_tool>
<server_name>jira</server_name>
<tool_name>list-sprint-tickets</tool_name>
<arguments>
{
  "projectKey": "YOUR_PROJECT_KEY"
}
</arguments>
</use_mcp_tool>
```

### Get Ticket Details

To get detailed information about a specific ticket:

```typescript
<use_mcp_tool>
<server_name>jira</server_name>
<tool_name>get-ticket-details</tool_name>
<arguments>
{
  "issueKey": "PROJECT-123"
}
</arguments>
</use_mcp_tool>
```

### Editing content from a file

`update-description`, `update-comment` and `add-comment` accept `filePath` instead of inline
text. This is meant for long content: keep the source in a file, edit that file, and re-send —
no need to repost the whole body through the tool call each time.

The format is inferred from the extension, so `descriptionFormat` / `commentFormat` can be
omitted:

| Extension            | Format     | Content                                  |
| -------------------- | ---------- | ---------------------------------------- |
| `.md`, `.markdown`   | `markdown` | Markdown (`## headings`, `**bold**`)     |
| `.wiki`, `.jira`     | `wiki`     | Jira wiki markup (`h2.`, `{code}`)       |
| `.json`, `.adf`      | `adf`      | Raw Atlassian Document Format JSON       |
| `.txt`, `.text`      | `plain`    | Plain text, wrapped in a paragraph       |

Passing the format explicitly overrides the extension, which is also how to use a file with any
other extension. Paths are absolute or relative to the server's working directory.

```json
{
  "issueKey": "PROJECT-123",
  "filePath": "/abs/path/to/description.md"
}
```

An empty file is rejected rather than wiping the existing description or comment, and passing
both the inline text and `filePath` is an error.

## Development

The server is written in TypeScript and uses:

- `@modelcontextprotocol/sdk` for MCP server implementation
- `jira.js` for JIRA API integration

Recommended scripts:

- Build once: `npm run build`
- Build and watch: `npm run build:watch`
- Type-check only: `npm run typecheck`
- Dev run with watch: `npm run start:dev`
- Run compiled server: `npm start`
- Format check: `npm run fmt:check`
- Format write: `npm run fmt`

Typical workflow:

1. Make changes to [`jira.ts`](jira.ts)
2. Run `npm run start:dev` during development, or `npm run build` then `npm start` for compiled run
3. Restart your MCP client if needed to pick up changes

## Error Handling

The server includes error handling for:

- Invalid JIRA credentials
- Missing active sprints
- Invalid project keys or issue keys
- Network errors

Error messages will be returned in the tool response.

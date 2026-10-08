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
   - Optional parameter: `description` (string) or `filePath` (string) — see [Editing content from a file](#editing-content-from-a-file)
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

Optional:

- `JIRA_SMARTLINK_PROJECTS`: comma-separated project keys (e.g. `ABC,XYZ`) whose bare issue keys
  in markdown and in `add-smartlinks` become smart-link cards — see [Smart-links](#smart-links).
  Without it, bare keys stay text; links are converted either way.

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

`update-description`, `update-comment`, `add-comment`, `create-ticket` and `create-sub-ticket`
accept `filePath` instead of inline text. This is meant for long content: keep the source in a
file, edit that file, and re-send — no need to repost the whole body through the tool call each
time. On the two create tools the description stays optional, so omitting both is still fine.

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

Markdown constructs that end up empty — a table cell (header or body), a list item, a
blockquote, a fenced code block — are repaired into valid ADF before sending. Jira's validator
refuses an empty `tableHeader` / `tableCell` / `listItem` / `blockquote` with a bare
`400 INVALID_INPUT` that names the *field* (`errors.comment`) and not the offending node, so
without this repair the whole comment looks rejected while a single empty cell is at fault.

### Smart-links

Jira shows an issue or Confluence page as a card — key, summary and a live status chip — only
when the document holds an `inlineCard` node for it. A markdown or wiki link to the same URL is an
ordinary link, however it is written. The card holds nothing but the URL (Jira looks up the rest
when it renders), so converting is a pure transformation and needs no extra API calls.

**New markdown** — in `add-comment`, `update-comment`, `update-description`, `create-ticket` and
`create-sub-ticket`, a link to an issue (`/browse/ABC-123`) or a Confluence page (`/wiki/spaces/…`,
`/wiki/pages/…`) on the site in `JIRA_HOST` is written as a card. Its link text is dropped, since
the card shows the summary itself. Links elsewhere stay links.

```markdown
Caused by [ABC-123: Export misses cancelled rows](https://your-company.atlassian.net/browse/ABC-123).
```

With `JIRA_SMARTLINK_PROJECTS` set, a bare key of one of those projects (`ABC-123`) becomes a card
too. Raw ADF, wiki and plain text are uploaded as given.

**Content that is already in Jira** — `add-smartlinks` patches a description or a comment in
place: links and bare URLs to issues and pages on this site, and bare keys of the configured
projects, become cards; other bare URLs become links. Everything else round-trips untouched, so it
is the way to fix someone else's text without rewriting it. It reads, patches and writes with the
[version check](#content-versions-optimistic-concurrency) in between, and reports every change:

```json
{ "issueKey": "PROJECT-123", "commentId": "54660", "dryRun": true }
```

| Parameter   | Effect                                                                           |
| ----------- | -------------------------------------------------------------------------------- |
| `commentId` | Patch that comment instead of the description                                    |
| `dryRun`    | Report what would change, write nothing                                          |
| `projects`  | Project keys for bare-key conversion; replaces `JIRA_SMARTLINK_PROJECTS`         |
| `prRepo`    | `owner/repo`: a bare `#1234` becomes a link to that repository's pull request    |

Both paths leave inline code, code blocks and a key inside a URL alone, and turn a link split over
several text nodes (bold inside its text, say) into one card. A key glued to a word —
`ABC-123-class`, `hotfix-ABC-123` — is reported instead of converted, because a card in the middle
of a word reads badly: rephrase the sentence and run it again.

### Patching existing content

To change part of a description or comment that already exists, export it first with
`export-content`, edit the file, and re-upload it — no need to rewrite the whole thing:

```json
{ "issueKey": "PROJECT-123", "commentId": "54660", "filePath": "/tmp/pir-timeline.md" }
```

The export reports whether that content is safe to re-upload as markdown. Jira stores content
as ADF, and constructs such as panels, mentions, status lozenges, media, tables, task lists and
expands have no markdown equivalent — re-uploading markdown would silently drop them. When any
are present the tool warns and lists them; export with `"format": "adf"` instead and patch the
JSON, which always round-trips exactly (`.json` files are recognised as ADF on upload).

Omit `filePath` to get the content back inline instead of writing a file. Comment IDs are shown
by `get-ticket-details`.

### Content versions (optimistic concurrency)

`update-description` and `update-comment` require `expectedVersion` whenever the content being
replaced is not empty: the version the edit was based on. If the content changed in Jira since,
the update is refused instead of silently discarding that change — the same lock Confluence gets
from its page version numbers.

Jira has no version number of its own, and an issue's `updated` timestamp is not a substitute:
it moves for any change to the issue, so transitions, labels and new comments would all reject
description patches that never conflicted. The version is therefore a hash of the content
itself (`v1-…`), so it changes exactly when the thing being patched changes.

Versions come from `export-content` and from `get-ticket-details`, which reports
`Description version:` and a `version:` for every comment — so a small inline edit needs no
export round-trip.

**Writing a description for the first time needs no version.** Omitting `expectedVersion` is
itself the assertion "there is nothing here yet", which the server checks: the write goes through
when the description is still empty, and is refused — naming the version now in Jira — when
someone wrote one meanwhile. So the lock covers the first write as well, without the caller
having to fetch the version of empty content.

Pass `"force": true` to skip the check and overwrite regardless.

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

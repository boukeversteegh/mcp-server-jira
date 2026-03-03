import { respond, fail, withJiraError, validateString } from "../utils.js";
import * as fs from "fs";
import * as path from "path";
export const getAttachmentDefinition = {
    name: "get-attachment",
    description: "List and download attachments from a Jira issue. Without attachmentId, lists all attachments. With attachmentId, downloads the attachment — text-based files (markdown, txt, json, etc.) are returned directly, binary files are saved to the specified directory.",
    inputSchema: {
        type: "object",
        properties: {
            issueKey: {
                type: "string",
                description: "The issue key (e.g., PROJ-123)",
            },
            attachmentId: {
                type: "string",
                description: "The attachment ID to download. If omitted, lists all attachments on the issue.",
            },
            saveTo: {
                type: "string",
                description: "Directory path to save the file to. Required for binary files. For text files, if omitted the content is returned directly.",
            },
        },
        required: ["issueKey"],
    },
};
export async function getAttachmentHandler(jira, args) {
    const { issueKey, attachmentId, saveTo } = args;
    const err = validateString("issueKey", issueKey);
    if (err)
        return fail(err);
    return withJiraError(async () => {
        if (!attachmentId) {
            return await listAttachments(jira, issueKey);
        }
        return await downloadAttachment(jira, attachmentId, saveTo);
    }, `Error handling attachment for ${issueKey}`);
}
async function listAttachments(jira, issueKey) {
    const issue = await jira.issues.getIssue({
        issueIdOrKey: issueKey,
        fields: ["attachment"],
    });
    const attachments = issue.fields?.attachment || [];
    if (attachments.length === 0) {
        return respond(`No attachments found on ${issueKey}`);
    }
    const lines = attachments.map((a) => {
        const size = a.size != null ? formatFileSize(a.size) : "unknown size";
        const created = a.created
            ? new Date(a.created).toLocaleString()
            : "unknown date";
        const author = a.author?.displayName || "unknown";
        return `ID: ${a.id} | ${a.filename} (${a.mimeType}, ${size}) | by ${author} on ${created}`;
    });
    return respond(`Attachments on ${issueKey}:\n\n${lines.join("\n")}`);
}
async function downloadAttachment(jira, attachmentId, saveTo) {
    const meta = await jira.issueAttachments.getAttachment({
        id: attachmentId,
    });
    const filename = meta.filename || `attachment-${attachmentId}`;
    const mimeType = meta.mimeType || "application/octet-stream";
    const contentUrl = meta.content;
    if (!contentUrl) {
        return fail(`No content URL found for attachment ${attachmentId}`);
    }
    const response = await fetch(contentUrl, {
        headers: {
            Authorization: `Basic ${Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString("base64")}`,
            Accept: "*/*",
        },
    });
    if (!response.ok) {
        return fail(`Failed to download attachment: ${response.status} ${response.statusText}`);
    }
    const isText = isTextMimeType(mimeType) || isTextFilename(filename);
    if (saveTo) {
        if (!fs.existsSync(saveTo)) {
            fs.mkdirSync(saveTo, { recursive: true });
        }
        const filePath = path.join(saveTo, filename);
        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(filePath, buffer);
        if (isText) {
            const content = buffer.toString("utf-8");
            return respond(`Saved to: ${filePath}\n\nContent:\n\n${content}`);
        }
        return respond(`Saved to: ${filePath} (${formatFileSize(buffer.length)})`);
    }
    if (isText) {
        const content = await response.text();
        return respond(`**${filename}** (${mimeType}):\n\n${content}`);
    }
    return respond(`Attachment "${filename}" is a binary file (${mimeType}, ${formatFileSize(meta.size || 0)}). Use the saveTo parameter to specify a directory to save it to.`);
}
function isTextMimeType(mimeType) {
    return (mimeType.startsWith("text/") ||
        mimeType === "application/json" ||
        mimeType === "application/xml" ||
        mimeType === "application/javascript" ||
        mimeType === "application/typescript" ||
        mimeType === "application/x-yaml" ||
        mimeType === "application/yaml" ||
        mimeType.includes("+xml") ||
        mimeType.includes("+json"));
}
function isTextFilename(filename) {
    const textExtensions = [
        ".md",
        ".txt",
        ".csv",
        ".json",
        ".xml",
        ".yaml",
        ".yml",
        ".html",
        ".htm",
        ".css",
        ".js",
        ".ts",
        ".jsx",
        ".tsx",
        ".py",
        ".java",
        ".c",
        ".h",
        ".cpp",
        ".cs",
        ".rb",
        ".sh",
        ".bat",
        ".ps1",
        ".sql",
        ".log",
        ".cfg",
        ".ini",
        ".toml",
        ".env",
        ".gitignore",
        ".svg",
    ];
    const ext = path.extname(filename).toLowerCase();
    return textExtensions.includes(ext);
}
function formatFileSize(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

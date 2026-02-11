export function extractTextFromADF(node, depth = 0) {
    if (!node)
        return "No description";
    const indent = "  ".repeat(depth);
    let result = "";
    if (typeof node === "string") {
        return indent + node;
    }
    switch (node.type) {
        case "heading":
            result += `${indent}${node.content?.[0]?.text || ""}\n`;
            break;
        case "paragraph":
            if (node.content) {
                const paragraphText = node.content.map((c) => c.text || "").join("").trim();
                if (paragraphText)
                    result += `${indent}${paragraphText}\n`;
            }
            break;
        case "bulletList":
        case "orderedList":
            if (node.content) {
                result += node.content.map((item) => extractTextFromADF(item, depth)).join("");
            }
            break;
        case "listItem":
            if (node.content) {
                const itemContent = node.content.map((c) => extractTextFromADF(c, depth + 1)).join("").trim();
                result += `${indent}• ${itemContent}\n`;
            }
            break;
        default:
            if (Array.isArray(node.content)) {
                result += node.content.map((c) => extractTextFromADF(c, depth)).join("");
            }
            else if (node.text) {
                result += indent + node.text;
            }
    }
    return result;
}
export function formatFieldValue(value) {
    if (value === null || value === undefined)
        return "Not set";
    if (typeof value === "object") {
        if (value.type === "doc")
            return extractTextFromADF(value);
        if (value.displayName)
            return value.displayName;
        if (Array.isArray(value))
            return value.map((item) => formatFieldValue(item)).join(", ");
        return JSON.stringify(value);
    }
    return String(value);
}
export function hasMeaningfulValue(value) {
    if (value === null || value === undefined)
        return false;
    const t = typeof value;
    if (t === "string")
        return value.trim().length > 0;
    if (t === "number" || t === "boolean")
        return true;
    if (Array.isArray(value))
        return value.some((item) => hasMeaningfulValue(item));
    if (t === "object") {
        if (value.type === "doc") {
            const text = extractTextFromADF(value).trim();
            return text.length > 0;
        }
        const candidateKeys = ["value", "displayName", "name", "id", "text"];
        for (const key of candidateKeys) {
            if (hasMeaningfulValue(value[key]))
                return true;
        }
        for (const key in value) {
            if (Object.prototype.hasOwnProperty.call(value, key) && hasMeaningfulValue(value[key])) {
                return true;
            }
        }
        return false;
    }
    return false;
}

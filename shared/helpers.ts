function extractInlineNodeText(node: any): string {
  if (!node) return "";

  switch (node.type) {
    case "text": {
      let text = node.text || "";
      if (node.marks) {
        for (const mark of node.marks) {
          if (mark.type === "strike") text = `~~${text}~~`;
        }
      }
      return text;
    }
    case "mention":
      return node.attrs?.text || "@unknown";
    case "emoji":
      return node.attrs?.shortName || "";
    case "hardBreak":
      return "\n";
    case "inlineCard":
      return node.attrs?.url || "";
    default:
      return node.text || "";
  }
}

export function extractTextFromADF(node: any, depth: number = 0): string {
  if (!node) return "No description";

  const indent = "  ".repeat(depth);
  let result = "";

  if (typeof node === "string") {
    return indent + node;
  }

  switch (node.type) {
    case "heading":
      result += `${indent}${node.content?.map((c: any) => extractInlineNodeText(c)).join("") || ""}\n`;
      break;
    case "paragraph":
      if (node.content) {
        const paragraphText = node.content.map((c: any) => extractInlineNodeText(c)).join("").trim();
        if (paragraphText) result += `${indent}${paragraphText}\n`;
      }
      break;
    case "bulletList":
    case "orderedList":
      if (node.content) {
        result += node.content.map((item: any) => extractTextFromADF(item, depth)).join("");
      }
      break;
    case "listItem":
      if (node.content) {
        const itemContent = node.content.map((c: any) => extractTextFromADF(c, depth + 1)).join("").trim();
        result += `${indent}• ${itemContent}\n`;
      }
      break;
    default:
      if (Array.isArray(node.content)) {
        result += node.content.map((c: any) => extractTextFromADF(c, depth)).join("");
      } else if (node.text) {
        result += indent + node.text;
      }
  }
  return result;
}

export function formatFieldValue(value: any): string {
  if (value === null || value === undefined) return "Not set";
  if (typeof value === "object") {
    if ((value as any).type === "doc") return extractTextFromADF(value);
    if ((value as any).displayName) return (value as any).displayName;
    if (Array.isArray(value)) return value.map((item) => formatFieldValue(item)).join(", ");
    return JSON.stringify(value);
  }
  return String(value);
}

export function hasMeaningfulValue(value: any): boolean {
  if (value === null || value === undefined) return false;

  const t = typeof value;
  if (t === "string") return value.trim().length > 0;
  if (t === "number" || t === "boolean") return true;

  if (Array.isArray(value)) return value.some((item) => hasMeaningfulValue(item));

  if (t === "object") {
    if ((value as any).type === "doc") {
      const text = extractTextFromADF(value).trim();
      return text.length > 0;
    }
    const candidateKeys = ["value", "displayName", "name", "id", "text"];
    for (const key of candidateKeys) {
      if (hasMeaningfulValue((value as any)[key])) return true;
    }
    for (const key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key) && hasMeaningfulValue((value as any)[key])) {
        return true;
      }
    }
    return false;
  }

  return false;
}
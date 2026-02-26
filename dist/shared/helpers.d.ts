/**
 * Format a labeled section.
 * - Single-line value → "Label: value"
 * - Multi-line value  → "Label:\n  line1\n  line2"
 */
export declare function formatSection(label: string, value: string): string;
export declare function convertADFToMarkdown(node: any): string;
export declare function formatFieldValue(value: any): string;
export declare function hasMeaningfulValue(value: any): boolean;

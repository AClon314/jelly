/**
 * Support for Svelte single-file components.
 *
 * Jelly's pipeline analyses JavaScript/TypeScript modules, whereas a `.svelte`
 * file interleaves markup, styles and one or two `<script>` blocks. To reuse the
 * existing parser and the source-location machinery unchanged, a component is
 * *masked*: every character outside a `<script>` block is replaced by a space
 * (line breaks are preserved), so the masked source has exactly the same
 * line/column layout as the original file. Parsing the mask therefore yields
 * AST locations that point into the real `.svelte` file, which keeps
 * diagnostics, `codeFromLocation` and source maps working.
 *
 * Limitation: a `<script context="module">` block and the instance `<script>`
 * block are merged into one module, because the analysis operates on one AST
 * per file. Duplicate top-level declarations across the two blocks are the only
 * case where this changes parsing (they are legal in Svelte since the blocks
 * live in different scopes).
 */

/** File extension treated as a Svelte component. */
export const SVELTE_EXTENSION = ".svelte";

/** Checks whether a file path (or module specifier) denotes a Svelte component. */
export function isSvelteFile(file: string): boolean {
    return file.endsWith(SVELTE_EXTENSION);
}

interface Span {
    /** Index of the `<` of the opening tag. */
    start: number;
    /** Index just after the `>` of the closing `</script>` tag. */
    end: number;
}

/** Matches the start of an opening `<script ...>` tag. */
const openTagRegex = /<script(?=[\s/>])/gi;
/** Matches the start of a closing `</script>` tag. */
const closeTagRegex = /<\/script(?=[\s>])/gi;

/**
 * Finds the first opening `<script ...>` tag at or after `from`.
 * The scan of the attributes respects quoted strings so that `>` inside a
 * (e.g. `generics`) attribute does not terminate the tag prematurely.
 */
function findOpenTag(source: string, from: number): Span | null {
    openTagRegex.lastIndex = from;
    const match = openTagRegex.exec(source);
    if (!match)
        return null;
    let i = match.index + match[0].length;
    let quote: string | null = null;
    for (; i < source.length; i++) {
        const c = source[i];
        if (quote) {
            if (c === quote)
                quote = null;
        } else if (c === '"' || c === "'")
            quote = c;
        else if (c === ">")
            return {start: match.index, end: i + 1};
    }
    return null; // unterminated tag
}

/** Finds the first closing `</script>` tag at or after `from`. */
function findCloseTag(source: string, from: number): Span | null {
    closeTagRegex.lastIndex = from;
    const match = closeTagRegex.exec(source);
    if (!match)
        return null;
    const gt = source.indexOf(">", match.index + match[0].length);
    if (gt === -1)
        return null;
    return {start: match.index, end: gt + 1};
}

/**
 * Returns a copy of `source` in which everything except the contents of the
 * `<script>` blocks is blanked out. Line breaks are preserved and the result
 * has the same length as the input, so every character keeps its original
 * line/column position.
 *
 * Unterminated tags are ignored (the remainder is left blanked out); the actual
 * parse error, if any, is reported by the caller's parser.
 */
export function maskSvelte(source: string): string {
    let masked = source.replace(/[^\n\r]/g, " ");
    let index = 0;
    for (;;) {
        const open = findOpenTag(source, index);
        if (!open)
            return masked;
        const close = findCloseTag(source, open.end);
        if (!close)
            return masked; // unterminated <script>, leave the rest blanked out
        masked = masked.slice(0, open.end) + source.slice(open.end, close.start) + masked.slice(close.start);
        index = close.end;
    }
}

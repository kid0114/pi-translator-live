import { fromMarkdown, type Extension } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { mathFromMarkdown } from "mdast-util-math";
import { math } from "micromark-extension-math";
import type { Nodes } from "mdast";

// Commands (including skills), execution prefixes, yield queues, and continuation shortcuts.
export function isControlInput(text: string): boolean {
	return /^(?:[/!$]|->|=>)/.test(text.trimStart()) || /^(?:\.|c)$/.test(text.trim());
}

const DIRECTORY_HEADS: Record<string, true> = {
	applications: true, assets: true, bin: true, build: true, dist: true, docs: true,
	etc: true, extensions: true, home: true, include: true, lib: true, library: true,
	node_modules: true, opt: true, packages: true, public: true, sbin: true,
	scripts: true, src: true, static: true, system: true, target: true, tests: true,
	tmp: true, users: true, usr: true, var: true, vendor: true, volumes: true,
};

function isLikelyPath(value: string): boolean {
	if (/^(?:[~.]?\/|\.\.\/|[A-Za-z]:\\)/.test(value)) return true;
	// Rooted paths and extensions are unambiguous. Everything else needs positive path evidence;
	// script does not matter (Han, Arabic, Latin prose all use slashes as punctuation).
	const trimmed = value.replace(/[.,;:!?"'”’)\]}،؛、…]+$/u, "");
	if (/\.\w{1,10}$/.test(trimmed)) return true;
	const words = /^([\p{L}\p{N}]+)\/([\p{L}\p{N}]+)$/u.exec(trimmed);
	// word/word: path only with a known directory head, or digit-style evidence when no Han prose is present.
	if (words) {
		if (DIRECTORY_HEADS[words[1].toLowerCase()] === true) return true;
		return /\p{N}/u.test(value) && !/\p{Script=Han}/u.test(value);
	}
	// Multi-slash chains are paths in any script; a lone slash without evidence is prose.
	return (value.match(/[\\/]/g)?.length ?? 0) >= 2;
}

interface Span {
	start: number;
	end: number;
}

export interface TranslationUnit {
	readonly text: string;
}

export interface PreparedTranslation {
	readonly units: readonly TranslationUnit[];
	restore(translations: readonly string[]): string;
}

export class TranslationProtectionError extends Error {
	readonly code: "layout" | "prose";

	constructor(code: "layout" | "prose", message: string) {
		super(message);
		this.code = code;
		this.name = "TranslationProtectionError";
	}
}

const PARSER_EXTENSIONS = [gfm(), math()];
const MDAST_EXTENSIONS = [gfmFromMarkdown(), mathFromMarkdown()];
const MAX_UNIT_CHARS = 1600;
const SENTENCES = new Intl.Segmenter(undefined, { granularity: "sentence" });
const COMMAND = /^(?:[$!][ \t]+|(?:sudo|env|git|npm|npx|pnpm|yarn|bun|node|python\d*|pip\d*|cargo|rustc|go|make|cmake|docker|kubectl|ssh|scp|rsync|curl|wget|printf|echo|cd|ls|cat|chmod|chown|rm|mv|cp|mkdir|export)[ \t]+\S)/;

/** Only application-specific literals are detected here; Markdown belongs to mdast. */
function prosePieces(source: string, start: number, end: number, emit: (span: Span) => void): void {
	const text = source.slice(start, end);
	if (COMMAND.test(text.trimStart())) return;
	const literal = /(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/|mailto:|www\.)[^\s<>"']+|(?<![\p{L}\p{N}])(?:"[^"\r\n]+"|'[^'\r\n]+')|(?<![\p{L}\p{N}])(?:(?:[~.]?\/|\.\.\/|[A-Za-z]:\\|[\p{L}\p{N}_@.-]+[\\/])[^\s`<>"'()[\]{}\p{Ps}\p{Pe}\p{Pi}\p{Pf}、，。；：！？]+|[\p{L}\p{N}_@-][\p{L}\p{N}_@.-]*\.[\p{L}][\p{L}\p{N}]*)|(?<![\p{L}\p{N}])(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?|--[A-Za-z][\w-]*(?:=[^\s]+)?|\b(?:[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|[\da-fA-F]{8}-[\da-fA-F]{4}-[\da-fA-F]{4}-[\da-fA-F]{4}-[\da-fA-F]{12}|[\da-fA-F]{16,})\b|#\d+\b/gu;
	let cursor = 0;
	for (const match of text.matchAll(literal)) {
		const value = match[0];
		if (/^["']/.test(value)) {
			const body = value.slice(1, -1);
			if (!/(?:[\\/]|\.[\p{L}\p{N}]+$)/u.test(body) || !isLikelyPath(body)) continue;
		} else if (/[\\/]/.test(value) && !isLikelyPath(value)) continue;
		emit({ start: start + cursor, end: start + match.index });
		cursor = match.index + value.length;
	}
	emit({ start: start + cursor, end });
}

/** Escape generated punctuation as text, never let the model create Markdown syntax. */
function escapeProse(value: string): string {
	return value.replace(/[\\`*_{}[\]<>()#!|~&+\-=.:$]/g, "\\$&");
}

function structure(node: Nodes): unknown {
	if (node.type === "text") return { type: "text" };
	const { position: _position, ...fields } = node;
	return "children" in node ? { ...fields, children: node.children.map(structure) } : fields;
}

/** Character references change delimiter flanking without changing visible prose. */
function escapeBoundaryProse(value: string, before: boolean, after: boolean): string {
	const first = before ? value.match(/^./us)?.[0] ?? "" : "";
	const last = after ? value.match(/.$/us)?.[0] ?? "" : "";
	if (first.length === value.length) return `&#${first.codePointAt(0)};`;
	return (first ? `&#${first.codePointAt(0)};` : "")
		+ escapeProse(value.slice(first.length, last ? -last.length : undefined))
		+ (last ? `&#${last.codePointAt(0)};` : "");
}

/**
 * Parse CommonMark + GFM + math, select text leaves, and splice translated prose at
 * original UTF-16 offsets. Syntax, math and technical literals never visit the model.
 * Character references in ordinary prose retain emphasis flanking without adding
 * visible whitespace. The compiler observer excludes prefixes and source escapes.
 */
export function prepareTranslation(source: string): PreparedTranslation {
	const data: Span[] = [];
	const observer: Extension = {
		beforeEnter(token) {
			if (token.type === "data") data.push({ start: token.start.offset, end: token.end.offset });
		},
	};
	const tree = fromMarkdown(source, {
		extensions: PARSER_EXTENSIONS,
		mdastExtensions: [...MDAST_EXTENSIONS, observer],
	});
	const textLeaves: Span[] = [];
	const boundaryStarts = new Set<number>();
	const boundaryEnds = new Set<number>();
	const visit = (node: Nodes): void => {
		const start = node.position?.start.offset;
		const end = node.position?.end.offset;
		if (start === undefined || end === undefined) return;
		if (node.type === "emphasis" || node.type === "strong" || node.type === "delete") {
			boundaryStarts.add(end);
			boundaryEnds.add(start);
		}
		if (node.type === "text") {
			textLeaves.push({ start, end });
			return;
		}
		// Autolink text and shortcut/collapsed labels are also destinations/IDs.
		if (node.type === "link" && source[start] !== "[") return;
		if (node.type === "linkReference" && node.referenceType !== "full") return;
		if ("children" in node) for (const child of node.children) visit(child);
	};
	visit(tree);
	data.sort((a, b) => a.start - b.start);
	textLeaves.sort((a, b) => a.start - b.start);

	const spans: Span[] = [];
	const units: TranslationUnit[] = [];
	const fixedBoundaries: (Span & { value: string })[] = [];
	const append = ({ start, end }: Span): void => {
		const raw = source.slice(start, end);
		const text = raw.trim();
		if (!/\p{L}/u.test(text)) {
			// Untranslated numbers beside delimiters are still ordinary prose.
			// Do not alter whitespace, source escapes, entities or technical literals.
			if (boundaryStarts.has(start) && /^\p{N}/u.test(raw)) {
				const first = raw.match(/^./us)?.[0] ?? "";
				fixedBoundaries.push({ start, end: start + first.length, value: `&#${first.codePointAt(0)};` });
			}
			if (boundaryEnds.has(end) && /\p{N}$/u.test(raw) && (!/^\p{N}$/u.test(raw) || !boundaryStarts.has(start))) {
				const last = raw.match(/.$/us)?.[0] ?? "";
				fixedBoundaries.push({ start: end - last.length, end, value: `&#${last.codePointAt(0)};` });
			}
			return;
		}
		start += raw.indexOf(text);
		end = start + text.length;
		// Bound long prose on linguistic boundaries; never split Markdown to do it.
		if (text.length > MAX_UNIT_CHARS) {
			let runStart = start;
			let runEnd = start;
			for (const sentence of SENTENCES.segment(text)) {
				const sentenceStart = start + sentence.index;
				const sentenceEnd = sentenceStart + sentence.segment.length;
				if (runEnd > runStart && sentenceEnd - runStart > MAX_UNIT_CHARS) {
					const chunk = source.slice(runStart, runEnd).trimEnd();
					spans.push({ start: runStart, end: runStart + chunk.length });
					units.push({ text: chunk });
					runStart = sentenceStart;
				}
				runEnd = sentenceEnd;
			}
			const chunk = source.slice(runStart, runEnd).trimEnd();
			if (chunk) {
				spans.push({ start: runStart, end: runStart + chunk.length });
				units.push({ text: chunk });
			}
			return;
		}
		spans.push({ start, end });
		units.push({ text });
	};
	let dataIndex = 0;
	for (const leaf of textLeaves) {
		while (dataIndex < data.length && data[dataIndex].end <= leaf.start) dataIndex++;
		let index = dataIndex;
		while (index < data.length && data[index].start < leaf.end) {
			const start = Math.max(leaf.start, data[index].start);
			const end = Math.min(leaf.end, data[index].end);
			prosePieces(source, start, end, append);
			index++;
		}
	}

	return {
		units,
		restore(translations) {
			if (translations.length !== spans.length) {
				throw new TranslationProtectionError("layout", "Translation count does not match prose spans");
			}
			const replacements = [...fixedBoundaries];
			for (let index = 0; index < spans.length; index++) {
				const span = spans[index];
				const value = translations[index];
				if (typeof value !== "string" || !/\p{L}/u.test(value) || /[\p{Cc}\p{Cf}\u2028\u2029]/u.test(value.replace(/[\r\n\t]/g, ""))) {
					throw new TranslationProtectionError("prose", "Translation omitted prose or introduced control characters");
				}
				const text = value.trim().replace(/[\r\n\t]+/g, " ");
				let proseChars = 0;
				prosePieces(text, 0, text.length, piece => { proseChars += piece.end - piece.start; });
				if (proseChars !== text.length) {
					throw new TranslationProtectionError(
						"prose",
						`Translation introduced a technical literal at span ${index}: ${JSON.stringify(text.slice(0, 80))}`,
					);
				}
				replacements.push({
					...span,
					value: text === units[index].text && !boundaryStarts.has(span.start) && !boundaryEnds.has(span.end)
						? source.slice(span.start, span.end)
						: escapeBoundaryProse(text, boundaryStarts.has(span.start), boundaryEnds.has(span.end)),
				});
			}
			if (translations.every((value, index) => value === units[index].text)) return source;
			replacements.sort((a, b) => a.start - b.start);
			const parts: string[] = [];
			let cursor = 0;
			for (const replacement of replacements) {
				parts.push(source.slice(cursor, replacement.start), replacement.value);
				cursor = replacement.end;
			}
			parts.push(source.slice(cursor));
			const result = parts.join("");
			const restoredTree = fromMarkdown(result, { extensions: PARSER_EXTENSIONS, mdastExtensions: MDAST_EXTENSIONS });
			if (JSON.stringify(structure(tree)) !== JSON.stringify(structure(restoredTree))) {
				throw new TranslationProtectionError("layout", "Translation changed Markdown structure or protected literals");
			}
			return result;
		},
	};
}

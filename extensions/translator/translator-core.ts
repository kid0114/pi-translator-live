// Commands (including skills), execution prefixes, yield queues, and continuation shortcuts.
export function isControlInput(text: string): boolean {
	return /^(?:[/!$]|->|=>)/.test(text.trimStart()) || /^(?:\.|c)$/.test(text.trim());
}

// Conventional directory heads keep two-segment paths (src/utils) protected even
// without a file extension; other slash-joined words are ordinary prose.
const DIRECTORY_HEADS: Record<string, true> = {
	applications: true, assets: true, bin: true, build: true, dist: true, docs: true,
	etc: true, extensions: true, home: true, include: true, lib: true, library: true,
	node_modules: true, opt: true, packages: true, public: true, sbin: true,
	scripts: true, src: true, static: true, system: true, target: true, tests: true,
	tmp: true, users: true, usr: true, var: true, vendor: true, volumes: true,
};

/** Reject CJK-slash-CJK as prose, not a filesystem path. */
function isLikelyPath(match: string): boolean {
	if (/^(?:[~.]\/|\.\.\/|[A-Za-z]:\\)/.test(match)) return true;
	if (/\.\w{1,10}$/.test(match)) return true;
	if (/\p{Script=Han}[^/\\]*[/\\][^/\\]*\p{Script=Han}/u.test(match) && !/[A-Za-z]{2,}/.test(match)) return false;
	// Slash-joined ordinary words (read/search, and/or, before/after) are prose, not a
	// path: one slash, letters only, and no conventional directory head.
	const words = /^([\p{L}]+)\/([\p{L}]+)$/u.exec(match.replace(/\.$/, ""));
	if (words && DIRECTORY_HEADS[words[1].toLowerCase()] !== true) return false;
	return true;
}

interface Span {
	start: number;
	end: number;
}

interface DocumentParts {
	prose: Span[];
	literals: Span[];
	structure: Span[];
}

/** Locate writable prose while retaining the exact Markdown skeleton and literal bytes. */
function inspectMarkdown(source: string): DocumentParts {
	const prose: Span[] = [];
	const literals: Span[] = [];
	const structure: Span[] = [];
	let proseStart = 0;
	const keep = (start: number, end: number, literal = false) => {
		const raw = source.slice(proseStart, start);
		const text = raw.trim();
		if (/\p{L}/u.test(text) || (text && /^[\p{P}\p{Z}]+$/u.test(text) && !/[/\\]/.test(text))) {
			const begin = proseStart + raw.indexOf(text);
			prose.push({ start: begin, end: begin + text.length });
		} else if (raw.trim()) {
			literals.push({ start: proseStart, end: start });
		}
		if (literal) literals.push({ start, end });
		else if (start !== end) structure.push({ start, end });
		proseStart = end;
	};
	const urlPattern = /(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/|mailto:|www\.)[^\s<>"']+/y;
	const pathPattern =
		/(?:(?:[~.]?\/|\.\.\/|[A-Za-z]:\\|[\p{L}\p{N}_@.-]+[\\/])[^\s`<>"'()[\]{}，。；：！？]+|[\p{L}\p{N}_@-][\p{L}\p{N}_@.-]*\.[\p{L}][\p{L}\p{N}]*)/uy;
	let offset = 0;
	while (offset < source.length) {
		const start = offset;
		let literal = false;
		const lineStart = offset === 0 || source[offset - 1] === "\n";
		if (lineStart) {
			const next = source.indexOf("\n", offset);
			const end = next === -1 ? source.length : next + 1;
			const line = source.slice(offset, end);
			const prefix = /^(?:[ \t]*>[ \t]*)*[ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+)?/.exec(line)![0];
			const body = line.slice(prefix.length);
			const fence = /^(`{3,}|~{3,})[^\r\n]*/.exec(body);
			const literalLine =
				/^(?: {4}|\t)/.test(line) ||
				/^\[[^\]\r\n]+\]:/.test(body) ||
				/^(?:[$!][ \t]+|(?:sudo|env|git|npm|npx|pnpm|yarn|bun|node|python\d*|pip\d*|cargo|rustc|go|make|cmake|docker|kubectl|ssh|scp|rsync|curl|wget|printf|echo|cd|ls|cat|chmod|chown|rm|mv|cp|mkdir|export)[ \t]+\S)/.test(
					body,
				);
			if (fence) {
				literal = true;
				let cursor = end;
				offset = source.length;
				while (cursor < source.length) {
					const nextLine = source.indexOf("\n", cursor);
					const nextEnd = nextLine === -1 ? source.length : nextLine + 1;
					const closing = /^(?:[ \t]*>[ \t]*)*[ \t]*(`{3,}|~{3,})[ \t]*\r?\n?$/.exec(
						source.slice(cursor, nextEnd),
					);
					if (closing && closing[1][0] === fence[1][0] && closing[1].length >= fence[1].length) {
						offset = nextEnd;
						break;
					}
					cursor = nextEnd;
				}
			} else if (
				literalLine ||
				/^(?:[-*_][ \t]*){3,}\r?\n?$/.test(body) ||
				/^[= -]+\r?\n?$/.test(body) ||
				/^[|:\- \t]+\r?\n?$/.test(body)
			) {
				literal = literalLine;
				offset = end;
				// Indented continuation lines include reference destinations and optional titles.
				if (/^\[[^\]\r\n]+\]:/.test(body)) {
					while (offset < source.length && /^[ \t]+\S/.test(source.slice(offset))) {
						const continuation = source.indexOf("\n", offset);
						offset = continuation === -1 ? source.length : continuation + 1;
					}
				}
			} else {
				offset += prefix.length;
				const heading = /^(?:#{1,6}[ \t]+|\[[ xX]\][ \t]+)/.exec(source.slice(offset));
				if (heading) offset += heading[0].length;
			}
			if (offset > start) {
				keep(start, offset, literal);
				continue;
			}
		}
		if (source[offset] === "`") {
			literal = true;
			let runEnd = offset + 1;
			while (source[runEnd] === "`") runEnd++;
			const delimiter = source.slice(offset, runEnd);
			let closing = source.indexOf(delimiter, runEnd);
			while (closing !== -1 && (source[closing - 1] === "`" || source[closing + delimiter.length] === "`")) {
				closing = source.indexOf(delimiter, closing + delimiter.length);
			}
			offset = closing === -1 ? runEnd : closing + delimiter.length;
		} else if (source[offset] === "(" && source[offset - 1] === "]") {
			literal = true;
			// Destinations may contain balanced/escaped parentheses and quoted titles.
			let depth = 1;
			let cursor = offset + 1;
			let quote: string | undefined;
			for (; cursor < source.length && depth > 0; cursor++) {
				const char = source[cursor];
				if (char === "\\") cursor++;
				else if (quote) {
					if (char === quote) quote = undefined;
				} else if ((char === '"' || char === "'") && /\s/.test(source[cursor - 1])) quote = char;
				else if (char === "(") depth++;
				else if (char === ")") depth--;
			}
			// An incomplete destination is also literal, never translator input.
			offset = depth === 0 ? cursor : source.length;
		} else if (source[offset] === "[") {
			let cursor = offset + 1;
			let depth = 1;
			for (; cursor < source.length && depth > 0; cursor++) {
				if (source[cursor] === "\\") cursor++;
				else if (source[cursor] === "[") depth++;
				else if (source[cursor] === "]") depth--;
			}
			const label = source.slice(offset, cursor);
			// Shortcut/collapsed reference labels are IDs too; changing them breaks resolution.
			literal =
				depth !== 0 ||
				source[offset - 1] === "]" ||
				/^\[Image #\d+\]$/.test(label) ||
				source.startsWith("[]", cursor) ||
				(source[cursor] !== "(" && source[cursor] !== "[");
			offset = literal ? cursor : offset + 1;
		} else if (source[offset] === "\\") {
			literal = true;
			offset = Math.min(source.length, offset + 2);
		} else {
			urlPattern.lastIndex = offset;
			const url = urlPattern.exec(source);
			const quoted = /^(?:"[^"\r\n]+"|'[^'\r\n]+')/.exec(source.slice(offset));
			const quotedPath =
				quoted && /(?:[\\/]|[\p{L}\p{N}]\.[\p{L}\p{N}]+$)/u.test(quoted[0].slice(1, -1)) ? quoted : null;
			pathPattern.lastIndex = offset;
			const pathMatch = offset === 0 || /[\s([{"'*_~:：]/.test(source[offset - 1]) ? pathPattern.exec(source) : null;
			const path = pathMatch && isLikelyPath(pathMatch[0]) ? pathMatch : null;
			const markup = /^(?:<[^>]*>|&(?:#\d+|#x[\da-fA-F]+|[A-Za-z][A-Za-z0-9]+);|⟦[^⟧]*(?:⟧|$)|⟧)/.exec(
				source.slice(offset),
			);
			const identifier =
				/^(?:--[A-Za-z][\w-]*(?:=[^\s]+)?|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-fA-F]{16,})(?![\p{L}\p{N}_-])/u.exec(
					source.slice(offset),
				);
			const reference = /^#\d+\b/.exec(source.slice(offset));
			const matched = url ?? quotedPath ?? path ?? markup ?? identifier ?? reference;
			if (matched) {
				offset += matched[0].length;
				literal = true;
			} else if (
				/[\r\n\t`*_~#|[\]<>]/.test(source[offset]) ||
				(source[offset] === "!" && source[offset + 1] === "[")
			)
				offset++;
			else if (source[offset] === " " && source[offset + 1] === " ") {
				while (source[offset] === " ") offset++;
			}
		}
		if (offset > start) keep(start, offset, literal);
		else offset++;
	}
	keep(source.length, source.length);
	return { prose, literals, structure };
}

export interface PreparedTranslation {
	text: string;
	needsTranslation: boolean;
	restore(translated: string): string;
}

export class TranslationProtectionError extends Error {
	readonly code: "layout" | "literal" | "prose" | "line" | "marker" | "emphasis" | "link" | "image";

	constructor(code: TranslationProtectionError["code"], message: string) {
		super(message);
		this.code = code;
		this.name = "TranslationProtectionError";
	}
}

function restoreProseGap(original: string, translated: string, previousValue: string, nextValue: string): string {
	const text = translated.trim();
	let restored: string;
	if (original.trim()) {
		restored = text
			? `${/^\s*/.exec(original)![0]}${text}${/\s*$/.exec(original)![0]}`
			: (original.match(/\r\n|\r|\n/g)?.join("") ?? "");
	} else if (text) {
		const lineBreaks = original.match(/\r\n|\r|\n/g) ?? [];
		let lineIndex = 0;
		restored = translated.replace(/\r\n|\r|\n/g, () => lineBreaks[lineIndex++] ?? "\n");
		if (!lineBreaks.length) restored = original + text + original;
	} else restored = original;
	if (previousValue.endsWith("]") && /^\s*\(/.test(restored) && !/^\s*\(/.test(original)) {
		throw new TranslationProtectionError("link", "Translation introduced link destination");
	}
	if (nextValue.startsWith("[") && /!\s*$/.test(restored) && !/!\s*$/.test(original)) {
		throw new TranslationProtectionError("image", "Translation introduced image syntax");
	}
	return restored;
}

/** Validate document layout, not the number of prose fragments beside literal tokens. */
function validateDocument(
	gaps: readonly string[],
	translatedGaps: readonly string[],
	projections: readonly string[],
): void {
	const sourceParts: string[] = [];
	const translatedParts: string[] = [];
	for (let index = 0; index < gaps.length; index++) {
		sourceParts.push(gaps[index]);
		translatedParts.push(translatedGaps[index]);
		if (index < gaps.length - 1) {
			// Retain line context without exposing literal bytes or joining words across a token.
			const separator = projections[index];
			sourceParts.push(separator);
			translatedParts.push(separator);
		}
	}
	const source = sourceParts.join("");
	const translated = translatedParts.join("");
	const original = inspectMarkdown(source);
	const result = inspectMarkdown(translated);
	const expectedLayout = original.structure.map(span => source.slice(span.start, span.end)).join("");
	const actualLayout = result.structure.map(span => translated.slice(span.start, span.end)).join("");
	if (expectedLayout !== actualLayout) {
		throw new TranslationProtectionError("layout", "Translation changed protected Markdown structure");
	}
	const projectionLiterals = new Set(projections.map(separator => separator.trimEnd()));
	for (const span of result.literals) {
		const literal = translated.slice(span.start, span.end);
		if (!projectionLiterals.has(literal) && /[\p{L}\p{N}\p{Cc}\p{Cf}\u2028\u2029\\`*_~#|[\]<>!&]/u.test(literal)) {
			throw new TranslationProtectionError("literal", "Translation introduced protected literal content");
		}
	}
	for (const span of result.prose) {
		if (/[\p{Cc}\p{Cf}\u2028\u2029`*_~#|[\]<>\\]/u.test(translated.slice(span.start, span.end))) {
			throw new TranslationProtectionError("prose", "Translation introduced unsafe prose");
		}
	}
	const expectedLines = source.replace(/<ph\b[^>]*>(?:[^<]*<\/ph>)?/g, "").split(/\r\n|\r|\n/);
	const actualLines = translated.replace(/<ph\b[^>]*>(?:[^<]*<\/ph>)?/g, "").split(/\r\n|\r|\n/);
	if (
		expectedLines.length !== actualLines.length ||
		expectedLines.some((line, index) => /\p{L}/u.test(line) !== /\p{L}/u.test(actualLines[index]))
	) {
		throw new TranslationProtectionError("line", "Translation omitted a prose line");
	}
}

/**
 * One context-preserving document, never a batch of independent translation requests.
 * Every token must occur exactly once. Inline literals may reorder within one prose
 * region; layout boundaries stay fixed. Restore Markdown and literal bytes after validation.
 */
export function prepareTranslation(source: string): PreparedTranslation {
	const original = inspectMarkdown(source);
	if (!original.prose.some(span => /\p{L}/u.test(source.slice(span.start, span.end)))) {
		return {
			text: source,
			needsTranslation: false,
			restore(translated) {
				if (translated !== source) {
					throw new TranslationProtectionError("literal", "Translation changed a literal-only document");
				}
				return source;
			},
		};
	}
	// Keep simple emphasis as a translatable semantic unit, not two unrelated markers.
	const grouped: (Span & { tag: string; delimiter: string; body: string })[] = [];
	const structureStarts = new Set(original.structure.map(span => span.start));
	let literalIndex = 0;
	for (const match of source.matchAll(/(\*\*|__|~~|\*|_)([^\r\n]+?)\1/g)) {
		const start = match.index;
		const end = start + match[0].length;
		while (original.literals[literalIndex]?.end <= start) literalIndex++;
		const body = match[2];
		if (
			!structureStarts.has(start) ||
			(original.literals[literalIndex]?.start ?? source.length) < end ||
			body !== body.trim() ||
			!/\p{L}/u.test(body) ||
			/[\p{Cc}\p{Cf}\u2028\u2029\\`*_~#|[\]<>]/u.test(body) ||
			/&(?:#\d+|#x[\da-fA-F]+|[A-Za-z][A-Za-z0-9]+);/.test(body) ||
			(match[1].startsWith("_") && /[\p{L}\p{N}]/u.test((source[start - 1] ?? "") + (source[end] ?? "")))
		)
			continue;
		grouped.push({
			start,
			end,
			tag: match[1] === "~~" ? "s" : match[1].length === 2 ? "b" : "i",
			delimiter: match[1],
			body,
		});
	}
	const withoutGroups = (spans: Span[]) => {
		let index = 0;
		return spans.filter(span => {
			while (grouped[index]?.end <= span.start) index++;
			return (grouped[index]?.start ?? source.length) >= span.end;
		});
	};
	const groupByStart = new Map(grouped.map(group => [group.start, group]));
	const groupByToken = new Map<number, (typeof grouped)[number]>();
	let namespace = 0;
	while (source.includes(`<ph id="omp${namespace}-`)) namespace++;
	const marker = (index: number) => `<ph id="omp${namespace}-${index}">[${index}]</ph>`;
	const values: string[] = [];
	const gaps: string[] = [];
	const projections: string[] = [];
	const movable: boolean[] = [];
	const regions: number[] = [];
	let region = 0;
	const parts: string[] = [];
	// Protect formatting as well as literal data: translation must not realign a table or drop emphasis.
	const literalSpans = new Set(original.literals);
	const protectedSpans = withoutGroups(original.literals)
		.concat(withoutGroups(original.structure), grouped)
		.sort((left, right) => left.start - right.start || left.end - right.end);
	const spans: (Span & { literal: boolean })[] = [];
	for (const span of protectedSpans) {
		const previous = spans.at(-1);
		const literal = literalSpans.has(span);
		if (
			previous &&
			!groupByStart.has(previous.start) &&
			!groupByStart.has(span.start) &&
			(span.start < previous.end ||
				(span.start === previous.end && previous.literal === literal) ||
				(!previous.literal && !literal && /^\s+$/.test(source.slice(previous.end, span.start))))
		) {
			previous.end = Math.max(previous.end, span.end);
			previous.literal ||= literal;
		} else spans.push({ ...span, literal });
	}
	let cursor = 0;
	for (const span of spans) {
		const gap = source.slice(cursor, span.start);
		gaps.push(gap);
		const value = source.slice(span.start, span.end);
		// Keep short literals readable for sentence context; hide multiline code and large data.
		const breaks = value.match(/\r\n|\r|\n/g)?.join("") ?? "";
		const canMove = span.literal && !breaks && !/^[[(<&\\]/.test(value.trimStart());
		if (!canMove || /[\r\n]/.test(gap)) region++;
		movable.push(canMove);
		regions.push(region);
		if (!canMove) region++;
		const group = groupByStart.get(span.start);
		if (group) {
			groupByToken.set(values.length, group);
			parts.push(gap, `<${group.tag} id="omp${namespace}-${values.length}">${group.body}</${group.tag}>`);
		} else if (span.literal && (breaks || value.length > 512)) {
			parts.push(gap, marker(values.length), breaks);
		} else {
			const formatting = value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
			parts.push(gap, `<ph id="omp${namespace}-${values.length}">${formatting}</ph>`);
		}
		values.push(value);
		projections.push(`<ph id="omp${namespace}-${values.length - 1}"/>` + breaks);
		cursor = span.end;
	}
	const tail = source.slice(cursor);
	parts.push(tail);
	gaps.push(tail);
	const text = `<doc id="omp${namespace}">${parts.join("")}</doc>`;
	return {
		text,
		needsTranslation: true,
		restore(translated) {
			// The paired container binds all prose without movable empty inline sentinels.
			const document = /^<doc\s+id=(["'])omp(\d+)\1\s*>([\s\S]*)<\/doc>$/.exec(translated.trim());
			if (!document || document[2] !== String(namespace) || /<\/?doc\b/.test(document[3])) {
				throw new TranslationProtectionError("marker", "Missing, malformed or duplicated translation document boundary");
			}
			translated = document[3];
			const restored: string[] = [];
			const translatedGaps: string[] = [];
			const seen = new Set<number>();
			let previousValue = "";
			let offset = 0;
			let index = 0;
			for (const match of translated.matchAll(/<(ph|b|i|s)\b[^>]*>[^<]*<\/\1>/g)) {
				const gap = translated.slice(offset, match.index);
				const opening = match[0].slice(0, match[0].indexOf(">") + 1);
				const identity = /^<(ph|b|i|s)\s+id=(["'])omp(\d+)-(\d+)\2\s*\/?>$/.exec(opening);
				const id = identity ? Number(identity[4]) : -1;
				const group = groupByToken.get(id);
				if (!identity || identity[4] !== String(id)) {
					throw new TranslationProtectionError("marker", `Malformed translation marker at position ${index}`);
				}
				if (id >= values.length || identity[1] !== (group?.tag ?? "ph") || identity[3] !== String(namespace)) {
					throw new TranslationProtectionError("marker", `Unknown translation marker ${identity[3]}-${identity[4]}`);
				}
				if (seen.has(id)) {
					throw new TranslationProtectionError("marker", `Duplicated translation marker ${id}`);
				}
				if (/<\/?(?:ph|b|i|s)\b/.test(gap)) {
					throw new TranslationProtectionError("marker", `Malformed or unclosed translation marker before ${id}`);
				}
				if (id !== index && (!movable[index] || !movable[id] || regions[id] !== regions[index])) {
					throw new TranslationProtectionError(
						"marker",
						id > index
							? `Missing translation marker ${index}; received ${id}`
							: `Translation marker ${id} crossed a protected boundary; expected ${index}`,
					);
				}
				seen.add(id);
				const restoredGap = restoreProseGap(gaps[index], gap, previousValue, values[id]);
				translatedGaps.push(restoredGap);
				let value = values[id];
				if (group) {
					const closing = `</${group.tag}>`;
					const body = match[0].slice(opening.length, -closing.length).trim();
					if (
						!match[0].endsWith(closing) ||
						!/\p{L}/u.test(body) ||
						/[\p{Cc}\p{Cf}\u2028\u2029\\`*_~#|[\]<>]/u.test(body) ||
						/&(?:#\d+|#x[\da-fA-F]+|[A-Za-z][A-Za-z0-9]+);/.test(body)
					) {
						throw new TranslationProtectionError("emphasis", "Translation omitted or changed emphasized prose");
					}
					value = group.delimiter + body + group.delimiter;
				}
				restored.push(restoredGap, value);
				previousValue = value;
				offset = match.index + match[0].length;
				index++;
			}
			const trailing = translated.slice(offset);
			if (/<\/?(?:ph|b|i|s)\b/.test(trailing)) {
				throw new TranslationProtectionError("marker", "Malformed or unclosed trailing translation marker");
			}
			// Providers may omit whitespace-only markers after the final prose; their
			// bytes are rebuilt from the source and cannot move prose across a boundary.
			let tail = trailing;
			while (index < values.length && /^\s*$/.test(values[index])) {
				seen.add(index);
				const skippedGap = restoreProseGap(gaps[index], tail, previousValue, values[index]);
				tail = "";
				translatedGaps.push(skippedGap);
				restored.push(skippedGap, values[index]);
				previousValue = values[index];
				index++;
			}
			if (index !== values.length) {
				throw new TranslationProtectionError("marker", `Incomplete translation: received ${index} of ${values.length} markers`);
			}
			const restoredTail = restoreProseGap(gaps[index], tail, previousValue, "");
			translatedGaps.push(restoredTail);
			restored.push(restoredTail);
			const result = restored.join("");
			validateDocument(gaps, translatedGaps, projections);
			return result;
		},
	};
}

// Commands (including skills), execution prefixes, yield queues, and continuation shortcuts.
export function isControlInput(text: string): boolean {
	return /^(?:[/!$]|->|=>)/.test(text.trimStart()) || /^(?:\.|c)$/.test(text.trim());
}

/** Reject CJK-slash-CJK as prose, not a filesystem path. */
function isLikelyPath(match: string): boolean {
	if (/^(?:[~.]\/|\.\.\/|[A-Za-z]:\\)/.test(match)) return true;
	if (/\.\w{1,10}$/.test(match)) return true;
	if (/\p{Script=Han}[^/\\]*[/\\][^/\\]*\p{Script=Han}/u.test(match) && !/[A-Za-z]{2,}/.test(match)) return false;
	return true;
}

interface ProseSlot {
	start: number;
	end: number;
}

export interface TranslationSource {
	source: string;
	slots: ProseSlot[];
}

/** Keep source offsets: only prose gaps are writable; all other bytes come from the original. */
export function partitionMarkdown(source: string): TranslationSource {
	const slots: ProseSlot[] = [];
	let proseStart = 0;
	const keep = (start: number, end: number) => {
		const raw = source.slice(proseStart, start);
		const text = raw.trim();
		if (/\p{L}/u.test(text)) {
			const begin = proseStart + raw.indexOf(text);
			slots.push({ start: begin, end: begin + text.length });
		}
		proseStart = end;
	};
	const urlPattern = /(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/|mailto:|www\.)[^\s<>"']+/y;
	const pathPattern =
		/(?:(?:[~.]?\/|\.\.\/|[A-Za-z]:\\|[\p{L}\p{N}_@.-]+[\\/])[^\s`<>"'()[\]{}，。；：！？]+|[\p{L}\p{N}_@-][\p{L}\p{N}_@.-]*\.[\p{L}][\p{L}\p{N}]*)/uy;
	let offset = 0;
	while (offset < source.length) {
		const start = offset;
		const lineStart = offset === 0 || source[offset - 1] === "\n";
		if (lineStart) {
			const next = source.indexOf("\n", offset);
			const end = next === -1 ? source.length : next + 1;
			const line = source.slice(offset, end);
			const prefix = /^(?:[ \t]*>[ \t]*)*[ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+)?/.exec(line)![0];
			const body = line.slice(prefix.length);
			const fence = /^(`{3,}|~{3,})[^\r\n]*/.exec(body);
			if (fence) {
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
				/^(?: {4}|\t)/.test(line) ||
				/^\[[^\]\r\n]+\]:/.test(body) ||
				/^(?:[-*_][ \t]*){3,}\r?\n?$/.test(body) ||
				/^[= -]+\r?\n?$/.test(body) ||
				/^[|:\- \t]+\r?\n?$/.test(body)
			) {
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
				keep(start, offset);
				continue;
			}
		}
		if (source[offset] === "`") {
			let runEnd = offset + 1;
			while (source[runEnd] === "`") runEnd++;
			const delimiter = source.slice(offset, runEnd);
			let closing = source.indexOf(delimiter, runEnd);
			while (closing !== -1 && (source[closing - 1] === "`" || source[closing + delimiter.length] === "`")) {
				closing = source.indexOf(delimiter, closing + delimiter.length);
			}
			offset = closing === -1 ? runEnd : closing + delimiter.length;
		} else if (source[offset] === "(" && source[offset - 1] === "]") {
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
			const literal =
				depth !== 0 ||
				source[offset - 1] === "]" ||
				/^\[Image #\d+\]$/.test(label) ||
				source.startsWith("[]", cursor) ||
				(source[cursor] !== "(" && source[cursor] !== "[");
			offset = literal ? cursor : offset + 1;
		} else if (source[offset] === "\\") {
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
			const literal = /^(?:<[^>]*>|&(?:#\d+|#x[\da-fA-F]+|[A-Za-z][A-Za-z0-9]+);)/.exec(source.slice(offset));
			if (url || quotedPath || path || literal) offset += (url ?? quotedPath ?? path ?? literal)![0].length;
			else if (/[\r\n\t`*_~#|[\]<>!]/.test(source[offset])) offset++;
			else if (source[offset] === " " && source[offset + 1] === " ") {
				while (source[offset] === " ") offset++;
			}
		}
		if (offset > start) keep(start, offset);
		else offset++;
	}
	keep(source.length, source.length);
	return { source, slots };
}

export function joinTranslation(plan: TranslationSource, translations: string[]): string {
	const parts: string[] = [];
	let cursor = 0;
	for (let index = 0; index < plan.slots.length; index++) {
		const slot = plan.slots[index];
		parts.push(plan.source.slice(cursor, slot.start), translations[index]);
		cursor = slot.end;
	}
	parts.push(plan.source.slice(cursor));
	return parts.join("");
}

/** Keep a source marker verbatim; changing a list number or delimiter is not translation. */
function leadingRun(text: string): string | null {
	const match = /^(?:[-+] |\d+[.)]\s|[=:]-*)/.exec(text.trimStart());
	return match ? match[0].trimEnd() : null;
}

function validateProse(translated: string, source: string): string {
	const text = translated.trim();
	if (
		!text ||
		/[\p{Cc}\p{Cf}\u2028\u2029`*_~#|[\]<>\\]/u.test(translated) ||
		/&(?:#\d+|#x[\da-fA-F]+|[A-Za-z][A-Za-z0-9]+);/.test(translated)
	) {
		throw new Error("Translation introduced Markdown structure or empty prose");
	}
	// A leading run is valid only if the original slot begins with the same marker.
	// The partitioner can leave "1.", ":", or "+ " in a prose slot.
	const replyRun = leadingRun(text);
	if (replyRun !== null && leadingRun(source) !== replyRun) {
		throw new Error("Translation introduced Markdown structure or empty prose");
	}
	return text;
}

// Conservative limits for marked requests on small translation models. The character bound
// includes markers and newlines. An indivisible oversized prose slot is requested alone.
export const MAX_BATCH_SLOTS = 8;
export const MAX_BATCH_CHARS = 1200;

export interface TranslationReply {
	text: string;
	complete: boolean;
}

export interface TranslationOptions {
	request: (text: string, marked: boolean) => Promise<TranslationReply>;
	checkCurrent: () => void;
	english: boolean;
	input: boolean;
	onInvalid?: (error: unknown, slot: number) => void;
}

/** Parse identity first, without assigning unmarked prose to its preceding marker. */
export function parseMarkedReply(text: string, count: number): Map<number, string> {
	const candidates = new Map<number, string>();
	const seen = new Set<number>();
	const unusable = new Set<number>();
	for (const line of text.split(/\r?\n/)) {
		if (!line.trim()) continue;
		const match = /^⟦(0|[1-9]\d*)⟧[ \t]*(.*)$/.exec(line);
		const id = match ? Number(match[1]) : NaN;
		if (!match || !Number.isSafeInteger(id) || id >= count || /[⟦⟧]/.test(match[2])) {
			// Never salvage prose from a malformed, noncanonical, out-of-range or
			// multi-marker line. Numeric hints only invalidate identities; they never
			// associate a translation. Unrelated canonical lines remain trustworthy.
			if (/[⟦⟧]/.test(line)) {
				for (const hint of line.matchAll(/(?:⟦[ \t]*|^[ \t]*)([+-]?\d+)/g)) {
					const suspect = Number(hint[1]);
					if (Number.isSafeInteger(suspect) && suspect >= 0 && suspect < count) unusable.add(suspect);
				}
			}
			continue;
		}
		if (seen.has(id)) unusable.add(id);
		seen.add(id);
		candidates.set(id, match[2]);
	}
	for (const id of unusable) candidates.delete(id);
	return candidates;
}

function checkSlot(plan: TranslationSource, index: number, translated: string, english: boolean): string {
	const slot = plan.slots[index];
	const checked = validateProse(translated, plan.source.slice(slot.start, slot.end));
	if (english && /\p{Script=Han}/u.test(checked)) throw new Error("Untranslated Chinese prose");
	if (plan.source[slot.start - 1] === "]" && checked.startsWith("(")) {
		throw new Error("Translation introduced link destination");
	}
	if (plan.source[slot.end] === "[" && checked.endsWith("!")) {
		throw new Error("Translation introduced image syntax");
	}
	return checked;
}

/** Results are committed slot-by-slot, so a later request failure cannot erase good work. */
export async function translatePlan(
	plan: TranslationSource,
	results: (string | undefined)[],
	options: TranslationOptions,
): Promise<void> {
	const store = (index: number, text: string): boolean => {
		let checked: string;
		try {
			checked = checkSlot(plan, index, text, options.english);
		} catch (error) {
			options.onInvalid?.(error, index);
			return false;
		}
		options.checkCurrent();
		results[index] = checked;
		return true;
	};
	const single = async (index: number) => {
		options.checkCurrent();
		const slot = plan.slots[index];
		// Request failures and incomplete requests propagate; they are not validation retries.
		const reply = await options.request(plan.source.slice(slot.start, slot.end), false);
		options.checkCurrent();
		if (!reply.complete) throw new Error("Translation did not complete");
		if (!store(index, reply.text) && options.input) throw new Error("Invalid input translation");
	};
	let start = 0;
	while (start < plan.slots.length) {
		options.checkCurrent();
		const segments: string[] = [];
		let chars = 0;
		let end = start;
		while (end < plan.slots.length && segments.length < MAX_BATCH_SLOTS) {
			const slot = plan.slots[end];
			const segment = `⟦${segments.length}⟧ ${plan.source.slice(slot.start, slot.end)}`;
			const added = segment.length + (segments.length ? 1 : 0);
			if (segments.length && chars + added > MAX_BATCH_CHARS) break;
			segments.push(segment);
			chars += added;
			end++;
		}
		if (segments.length === 1) {
			await single(start);
		} else {
			const reply = await options.request(segments.join("\n"), true);
			options.checkCurrent();
			if (!reply.complete) throw new Error("Translation did not complete");
			const candidates = parseMarkedReply(reply.text, segments.length);
			for (const [local, text] of candidates) store(start + local, text);
			// Retry only unresolved identities or invalid prose; good slots are never resent.
			for (let index = start; index < end; index++) {
				if (results[index] === undefined) await single(index);
			}
		}
		start = end;
	}
}

/** Input never uses this fallback; display failures replace only unresolved prose gaps. */
export function renderResults(
	plan: TranslationSource,
	results: (string | undefined)[],
	failure: string,
	keepOriginal = false,
): string {
	return joinTranslation(
		plan,
		plan.slots.map((slot, index) => {
			const translated = results[index];
			if (translated !== undefined) return translated;
			const original = plan.source.slice(slot.start, slot.end);
			return keepOriginal ? `${failure} ${original}` : failure;
		}),
	);
}

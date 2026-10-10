import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { TranslationReply } from "./translator-core.ts";
import {
	MAX_BATCH_CHARS,
	MAX_BATCH_SLOTS,
	isControlInput,
	partitionMarkdown,
	renderResults,
	translatePlan,
} from "./translator-core.ts";

const source = "苹果\n香蕉\n樱桃";
const marked = "⟦0⟧ Apple\n⟦1⟧ Banana\n⟦2⟧ Cherry";
const reply = (text: string): TranslationReply => ({ text, complete: true });
type Step = TranslationReply | Error | (() => TranslationReply | Promise<TranslationReply>);

function fixture(text: string, steps: Step[], input = false, signal?: AbortSignal, current = () => true) {
	const plan = partitionMarkdown(text);
	const results = Array.from<string | undefined>({ length: plan.slots.length });
	const requests: { text: string; marked: boolean }[] = [];
	const run = () =>
		translatePlan(plan, results, {
			input,
			english: true,
			checkCurrent: () => {
				signal?.throwIfAborted();
				if (!current()) throw new Error("Stale translation");
			},
			request: async (text, marked) => {
				requests.push({ text, marked });
				const step = steps.shift();
				assert.notEqual(step, undefined, "unexpected extra request");
				if (step instanceof Error) throw step;
				return typeof step === "function" ? await step() : step!;
			},
		});
	return { plan, results, requests, run };
}

describe("bounded translator algorithm", () => {
	it("accepts reordered unique identities without retries", async () => {
		const f = fixture(source, [reply("⟦2⟧ Cherry\n⟦0⟧ Apple\n⟦1⟧ Banana")]);
		await f.run();
		assert.deepEqual(f.results, ["Apple", "Banana", "Cherry"]);
		assert.equal(f.requests.length, 1);
	});

	it("ignores markerless neighboring prose and retries only its missing slot", async () => {
		const f = fixture(source, [reply("⟦0⟧ Apple\nBanana without its marker\n⟦2⟧ Cherry"), reply("Banana")]);
		await f.run();
		assert.deepEqual(f.results, ["Apple", "Banana", "Cherry"]);
		assert.deepEqual(f.requests.slice(1), [{ text: "香蕉", marked: false }]);
	});

	it("invalidates duplicate identities without resending other good slots", async () => {
		const f = fixture(source, [reply(`${marked}\n⟦0⟧ Pear`), reply("Apple")]);
		await f.run();
		assert.deepEqual(f.results, ["Apple", "Banana", "Cherry"]);
		assert.deepEqual(f.requests.slice(1), [{ text: "苹果", marked: false }]);
	});

	for (const bad of [
		"⟦00⟧ Apple",
		"⟦-1⟧ Apple",
		"⟦x⟧ Apple",
		"⟦0 Apple",
		"0⟧ Apple",
		"⟦3⟧ Apple",
		"⟦9007199254740993⟧ Apple",
		"⟦0⟧ Apple ⟦1⟧ Banana",
	]) {
		it(`does not guess identity from malformed or out-of-range marker ${bad}`, async () => {
			const ambiguous = bad === "⟦0⟧ Apple ⟦1⟧ Banana";
			const f = fixture(source, [
				reply(`${bad}\n⟦1⟧ Banana\n⟦2⟧ Cherry`),
				reply("Apple"),
				...(ambiguous ? [reply("Banana")] : []),
			]);
			await f.run();
			assert.deepEqual(f.results, ["Apple", "Banana", "Cherry"]);
			assert.deepEqual(
				f.requests.slice(1).map(request => request.text),
				ambiguous ? ["苹果", "香蕉"] : ["苹果"],
			);
		});
	}

	it("invalidates a canonical identity also mentioned by a noncanonical duplicate", async () => {
		const f = fixture(source, [reply(`${marked}\n⟦01⟧ Pear`), reply("Banana")]);
		await f.run();
		assert.deepEqual(f.results, ["Apple", "Banana", "Cherry"]);
		assert.deepEqual(f.requests.slice(1), [{ text: "香蕉", marked: false }]);
	});

	it("retains canonical translations around unknown malformed commentary", async () => {
		const f = fixture(source, [reply(`⟦x⟧ Commentary\n${marked}`)]);
		await f.run();
		assert.deepEqual(f.results, ["Apple", "Banana", "Cherry"]);
		assert.equal(f.requests.length, 1);
	});

	it("validates prose independently of identity and retries only invalid Markdown", async () => {
		const f = fixture(source, [reply("⟦0⟧ Apple\n⟦1⟧ **Banana**\n⟦2⟧ Cherry"), reply("Banana")]);
		await f.run();
		assert.deepEqual(f.results, ["Apple", "Banana", "Cherry"]);
		assert.deepEqual(f.requests.slice(1), [{ text: "香蕉", marked: false }]);
	});

	it("leaves persistently invalid output explicit, with an optional original-preserving Pi display", async () => {
		const f = fixture(source, [reply("⟦0⟧ Apple\n⟦1⟧ # Banana\n⟦2⟧ Cherry"), reply("# Banana")]);
		await f.run();
		assert.equal(renderResults(f.plan, f.results, "Translation failed."), "Apple\nTranslation failed.\nCherry");
		assert.equal(
			renderResults(f.plan, f.results, "Translation failed.", true),
			"Apple\nTranslation failed. 香蕉\nCherry",
		);
	});

	it("rejects invalid model-bound input even after other slots succeeded", async () => {
		const f = fixture(source, [reply("⟦0⟧ Apple\n⟦1⟧ # Banana\n⟦2⟧ Cherry"), reply("# Banana")], true);
		await assert.rejects(f.run(), /Invalid input translation/);
		assert.equal(f.results[0], "Apple");
		assert.equal(f.results[1], undefined);
		assert.equal(f.results[2], "Cherry");
	});

	it("bounds marked batches by slot count", async () => {
		const text = Array.from({ length: MAX_BATCH_SLOTS * 2 + 1 }, (_, index) => `中文段落${index}`).join("\n");
		const eight = "⟦0⟧ One\n⟦1⟧ Two\n⟦2⟧ Three\n⟦3⟧ Four\n⟦4⟧ Five\n⟦5⟧ Six\n⟦6⟧ Seven\n⟦7⟧ Eight";
		const f = fixture(text, [reply(eight), reply(eight), reply("Last")]);
		await f.run();
		assert.deepEqual(
			f.requests.map(request => request.marked),
			[true, true, false],
		);
		assert.equal(f.results.length, 17);
		for (const request of f.requests.filter(request => request.marked)) {
			assert.ok(request.text.split("\n").length <= MAX_BATCH_SLOTS);
			assert.ok(request.text.length <= MAX_BATCH_CHARS);
		}
	});

	it("bounds marked batches by characters and isolates indivisible oversized prose", async () => {
		const segment = "中".repeat(500);
		const f = fixture([segment, segment, segment, "中".repeat(MAX_BATCH_CHARS + 1)].join("\n"), [
			reply("⟦0⟧ First\n⟦1⟧ Second"),
			reply("Third"),
			reply("Long"),
		]);
		await f.run();
		assert.deepEqual(
			f.requests.map(request => request.marked),
			[true, false, false],
		);
		assert.ok(f.requests[0].text.length <= MAX_BATCH_CHARS);
		assert.equal(f.requests[2].text.length, MAX_BATCH_CHARS + 1);
		assert.deepEqual(f.results, ["First", "Second", "Third", "Long"]);
	});

	it("retains earlier batches when a later request fails, without blind retries", async () => {
		const f = fixture(Array.from({ length: 10 }, (_, index) => `中文段落${index}`).join("\n"), [
			reply("⟦0⟧ One\n⟦1⟧ Two\n⟦2⟧ Three\n⟦3⟧ Four\n⟦4⟧ Five\n⟦5⟧ Six\n⟦6⟧ Seven\n⟦7⟧ Eight"),
			new Error("network failure"),
		]);
		await assert.rejects(f.run(), /network failure/);
		assert.equal(f.requests.length, 2);
		assert.equal(
			renderResults(f.plan, f.results, "Failed."),
			"One\nTwo\nThree\nFour\nFive\nSix\nSeven\nEight\nFailed.\nFailed.",
		);
	});

	it("preserves good marked slots when their unresolved retry fails", async () => {
		const f = fixture(source, [reply("⟦0⟧ Apple\n⟦2⟧ Cherry"), new Error("timeout")]);
		await assert.rejects(f.run(), /timeout/);
		assert.equal(f.requests.length, 2);
		assert.equal(renderResults(f.plan, f.results, "Failed."), "Apple\nFailed.\nCherry");
	});

	for (const input of [false, true]) {
		it(`retains validated work but rejects interrupted ${input ? "input" : "output"} work`, async () => {
			const controller = new AbortController();
			const f = fixture(
				source,
				[
					reply("⟦0⟧ Apple\n⟦2⟧ Cherry"),
					() => {
						controller.abort(new Error("deadline"));
						return reply("Banana");
					},
				],
				input,
				controller.signal,
			);
			await assert.rejects(f.run(), /deadline/);
			assert.equal(f.results[0], "Apple");
			assert.equal(f.results[1], undefined);
			assert.equal(f.results[2], "Cherry");
			assert.equal(renderResults(f.plan, f.results, "Failed."), "Apple\nFailed.\nCherry");
		});
	}

	it("checks the epoch before storing a returned batch", async () => {
		let current = true;
		const f = fixture(
			source,
			[
				() => {
					current = false;
					return reply(marked);
				},
			],
			false,
			undefined,
			() => current,
		);
		await assert.rejects(f.run(), /Stale translation/);
		assert.ok(f.results.every(value => value === undefined));
	});

	it("does not retry request errors or incomplete requests", async () => {
		for (const step of [new Error("authentication"), { text: marked, complete: false }]) {
			const f = fixture(source, [step]);
			await assert.rejects(f.run());
			assert.equal(f.requests.length, 1);
			assert.ok(f.results.every(value => value === undefined));
		}
	});

	it("reconstructs protected code, paths, URLs and Markdown from original bytes", async () => {
		const text =
			"# 苹果 `printf 'x'`\n- 香蕉 [樱桃](https://example.test/a_(b) \"title\")\n/Users/lny/file.ts\n```ts\nconst x = '原样';\n```";
		const f = fixture(text, [reply(marked)]);
		await f.run();
		assert.equal(
			renderResults(f.plan, f.results, "Failed."),
			"# Apple `printf 'x'`\n- Banana [Cherry](https://example.test/a_(b) \"title\")\n/Users/lny/file.ts\n```ts\nconst x = '原样';\n```",
		);
	});

	it("returns protected-only and empty plans without requesting translation", async () => {
		for (const text of ["", "```ts\nconst x = '中文';\n```\nhttps://example.test/a\n/Users/lny/file.ts"]) {
			const f = fixture(text, []);
			await f.run();
			assert.equal(f.requests.length, 0);
			assert.equal(renderResults(f.plan, f.results, "Failed."), text);
		}
	});

	it("keeps same-language no-op prose unchanged and recognizes command-shaped input", async () => {
		const f = fixture("Already English.", [reply("Already English.")], true);
		await f.run();
		assert.equal(renderResults(f.plan, f.results, "Failed."), "Already English.");
		assert.equal(isControlInput("/translator off"), true);
		assert.equal(isControlInput("Normal prose"), false);
	});
});

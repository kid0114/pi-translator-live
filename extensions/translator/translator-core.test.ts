import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isControlInput, prepareTranslation, TranslationProtectionError } from "./translator-core.ts";

describe("whole-document translation", () => {
	it("prepares one complete context-preserving document regardless of length", () => {
		const source = Array.from({ length: 200 }, (_, index) => `## 段落 ${index}\n\n${"中文".repeat(700)}`).join(
			"\n\n",
		);
		const prepared = prepareTranslation(source);
		assert.equal(prepared.needsTranslation, true);
		assert.equal(prepared.text.split("\n").length, source.split("\n").length);
		assert.equal(
			prepared.restore(prepared.text.replaceAll("段落", "Section").replaceAll("中文", "English")),
			source.replaceAll("段落", "Section").replaceAll("中文", "English"),
		);
	});

	it("restores paragraph, heading, list, emphasis and table formatting from original bytes", () => {
		const source = "# 苹果\n\n> - [x] **香蕉** 和 _樱桃_\n\n| 苹果 | 香蕉 |\n| --- | :---: |\n";
		const prepared = prepareTranslation(source);
		assert.equal(
			prepared.restore(
				prepared.text.replaceAll("苹果", "Apple").replaceAll("香蕉", "Banana").replaceAll("樱桃", "Cherry"),
			),
			source.replaceAll("苹果", "Apple").replaceAll("香蕉", "Banana").replaceAll("樱桃", "Cherry"),
		);
	});

	it("rejects omitted emphasis text, changed scope and injected markup atomically", () => {
		const prepared = prepareTranslation("Read **the guide** now.");
		const valid = prepared.text.replace("Read ", "參閱").replace("the guide", "指南").replace(" now.", "。");
		for (const broken of [
			valid.replace("指南", ""),
			valid.replace("<b ", "<i ").replace("</b>", "</i>"),
			valid.replace("指南", "<script>"),
			valid.replace("</b>", ""),
		]) {
			assert.throws(() => prepared.restore(broken));
			assert.equal(prepared.restore(valid), "參閱 **指南** 。");
		}
	});

	it("preserves literals and formatting despite harmless XML serialization changes", () => {
		const source = "- Read **the guide** at https://example.test/queue and #100.\n";
		const prepared = prepareTranslation(source);
		const translated = prepared.text
			.replace("Read ", "參閱")
			.replace("the guide", "指南")
			.replace(" at ", "：")
			.replace(" and ", "和")
			.replaceAll(/<(ph|b|i|s) id="([^"]+)">/g, "<$1 id='$2'>");
		assert.equal(prepared.restore(translated), "- 參閱 **指南** ： https://example.test/queue  和 #100.\n");
	});

	it("allows a translated verb to follow a sentence-ending literal without adding a paragraph", () => {
		const prepared = prepareTranslation("Read `guide`.\n\nNext paragraph.");
		const translated = prepared.text.replace("Read ", "").replace(".", "を読んでください。");
		assert.equal(prepared.restore(translated), "`guide`を読んでください。\n\nNext paragraph.");
	});

	it("rejects prose added to a protected-only line", () => {
		const prepared = prepareTranslation("Read this.\n`guide`\nNext paragraph.");
		assert.throws(() => prepared.restore(prepared.text.replace(/<ph\b[^>]*>`guide`<\/ph>/, "Injected$&")));
	});

	it("restores code, URLs, paths and link destinations from their exact original bytes", () => {
		const source =
			"# 苹果 `printf 'x'`\n- 香蕉 [樱桃](https://example.test/a_(b) \"title\")\n/Users/alice/file.ts\n```ts\nconst x = '原样';\n```";
		const prepared = prepareTranslation(source);
		assert.equal(
			prepared.restore(prepared.text.replace("苹果", "Apple").replace("香蕉", "Banana").replace("樱桃", "Cherry")),
			"# Apple `printf 'x'`\n- Banana [Cherry](https://example.test/a_(b) \"title\")\n/Users/alice/file.ts\n```ts\nconst x = '原样';\n```",
		);
	});

	it("restores literal bytes even when the provider edits their copy-only contents", () => {
		const source = "Run `/session lock` and keep /path/file.ts unchanged.";
		const prepared = prepareTranslation(source);
		const translated = prepared.text
			.replace("Run ", "執行")
			.replace(" and keep ", "並保留")
			.replace(" unchanged.", "。")
			.replace("/session lock", "/會話 鎖定")
			.replace("/path/file.ts", "/錯誤.ts");
		assert.equal(prepared.restore(translated), "執行 `/session lock` 並保留 /path/file.ts 。");
	});

	it("restores original spacing when Chinese prose touches protected tokens", () => {
		const prepared = prepareTranslation("Keep `retryMs` and /tmp/queue.ts unchanged.");
		const translated = prepared.text.replace("Keep ", "保留").replace(" and ", "和").replace(" unchanged.", "不變。");
		assert.equal(prepared.restore(translated), "保留 `retryMs` 和 /tmp/queue.ts 不變。");
	});

	it("allows sentence context to move around a protected URL without losing a paragraph", () => {
		const prepared = prepareTranslation("Read https://example.test/queue for details.");
		const translated = prepared.text.replace("Read ", "詳情請參閱").replace(" for details.", "。");
		assert.equal(prepared.restore(translated), "詳情請參閱 https://example.test/queue 。");
	});

	it("allows literal reordering inside one table cell without changing literal bytes", () => {
		const source = "| Fix |\n|---|\n| Close #100 with a pointer to #200. |\n";
		const prepared = prepareTranslation(source);
		const first = prepared.text.match(/<ph\b[^>]*>#100<\/ph>/)![0];
		const second = prepared.text.match(/<ph\b[^>]*>#200<\/ph>/)![0];
		const translated = prepared.text
			.replace("Fix", "修復")
			.replace("Close ", "以指向")
			.replace(" with a pointer to ", "的方式關閉")
			.replace(first, "<temporary>")
			.replace(second, first)
			.replace("<temporary>", second);
		assert.equal(prepared.restore(translated), "| 修復 |\n|---|\n| 以指向 #200 的方式關閉 #100. |\n");
	});

	it("rejects literal movement across table cells, lines, emphasis and link boundaries", () => {
		for (const source of [
			"| Keep `one` | Keep `two` |\n",
			"Use `one`.\nUse `two`.",
			"Use `one`.\n\nUse `two`.",
			"Use `one` **before** `two`.",
			"Use [`one`](destination) and `two`.",
			"Use `one`.\n<omp-translation-block-test>\nUse `two`.",
		]) {
			const prepared = prepareTranslation(source);
			const tokens = [...prepared.text.matchAll(/<ph\b[^>]*>[^<]*<\/ph>/g)]
				.filter(match => /`(?:one|two)`/.test(match[0]))
				.map(match => match[0]);
			const translated = prepared.text
				.replace(tokens[0], "<temporary>")
				.replace(tokens[1], tokens[0])
				.replace("<temporary>", tokens[1]);
			assert.throws(() => prepared.restore(translated), source);
		}
	});

	it("restores protected reply boundaries when surrounding whitespace is omitted", () => {
		const separator = "\n\n<omp-translation-block-example>\n\n";
		const prepared = prepareTranslation(`First${separator}Second`);
		const translated = prepared.text.replace("First", "第一").replace("Second", "第二").replace(/\n/g, "");
		assert.deepEqual(prepared.restore(translated).split(separator), ["第一", "第二"]);
	});

	for (const literal of [
		"```ts\nconst value = '中文';\n```\n",
		"~~~~sh\nprintf '中文'\n~~~\n~~~~\n",
		"> ```sh\n> echo '中文'\n> ```\n",
		"- ```sh\n  echo '中文'\n  ```\n",
		"    echo '中文'\n\tprintf '中文'\n",
		"`echo '中文'`",
		"``echo `中文` ``",
		"`first\nsecond`",
		"https://example.test/a_(b)?q=中文#section",
		"mailto:person@example.test",
		"www.example.test/中文",
		"/Users/alice/中文/file.ts",
		"./中文/file.ts",
		"../中文/file.ts",
		"~/中文/file.ts",
		"src/中文/file.ts",
		"C:\\Users\\中文\\file.ts",
		"translator-core.ts",
		'"/Users/中文/my file.ts"',
		"'C:\\Users\\中文\\my file.ts'",
		"[Image #12]",
		"[中文引用]",
		"[中文引用][]",
		'[中文引用]: https://example.test/中文\n  "中文 title"\n',
		'<span data-value="中文">',
		"&nbsp; &#123; &#x4e2d;",
		"\\*",
		"$ echo '中文'\n",
		"npm run build -- --label=中文\n",
		"git commit -m '中文'\n",
		"OMP_API_KEY",
		"--target=中文",
		"123e4567-e89b-12d3-a456-426614174000",
		"abcdef0123456789abcdef0123456789",
	]) {
		it(`preserves literal bytes: ${JSON.stringify(literal)}`, () => {
			const source = `说明\n${literal}\n结束`;
			const prepared = prepareTranslation(source);
			assert.equal(
				prepared.restore(prepared.text.replace("说明", "Description").replace("结束", "End")),
				`Description\n${literal}\nEnd`,
			);
		});
	}

	it("preserves balanced and escaped link destinations, quoted titles and reference IDs", () => {
		const source =
			"[苹果](a_(b\\)c) \"中文 title\") 和 [香蕉][中文引用]\n[中文引用]:\n  https://example.test/中文\n  'title'\n";
		const prepared = prepareTranslation(source);
		assert.equal(
			prepared.restore(prepared.text.replace("苹果", "Apple").replace("香蕉", "Banana").replace("和", "and")),
			source.replace("苹果", "Apple").replace("香蕉", "Banana").replace("和", "and"),
		);
	});

	it("keeps an unclosed fence literal through the end of the reply", () => {
		const source = "说明\n```sh\necho '未结束'\n这仍然是代码";
		const prepared = prepareTranslation(source);
		assert.equal(
			prepared.restore(prepared.text.replace("说明", "Description")),
			source.replace("说明", "Description"),
		);
	});

	it("preserves incomplete link destinations and reference IDs", () => {
		for (const source of ["[苹果](https://example.test/中文", "苹果 [未结束引用"]) {
			const prepared = prepareTranslation(source);
			assert.equal(prepared.restore(prepared.text.replace("苹果", "Apple")), source.replace("苹果", "Apple"));
		}
	});

	it("retains Chinese slash-separated prose rather than misclassifying it as a path", () => {
		const prepared = prepareTranslation("苹果/香蕉");
		assert.ok(prepared.text.includes("苹果/香蕉"));
		assert.equal(prepared.restore(prepared.text.replace("苹果/香蕉", "Apple or banana")), "Apple or banana");
	});

	it("preserves CRLF, tabs, blank lines, hard breaks and surrounding whitespace", () => {
		const source = " \r\n# 苹果  \r\n\r\n```sh\r\necho '中文'\r\n```\r\n\t中文\r\n香蕉 \r\n";
		const prepared = prepareTranslation(source);
		assert.equal(
			prepared.restore(prepared.text.replace("苹果", "Apple").replace("香蕉", "Banana")),
			source.replace("苹果", "Apple").replace("香蕉", "Banana"),
		);
	});

	it("chooses a noncolliding marker namespace and restores literal marker-looking values", () => {
		const source = '苹果 <ph id="omp0-0"/> <ph id="omp1-99"/> `⟦OMP2:0⟧`';
		const prepared = prepareTranslation(source);
		assert.equal(prepared.restore(prepared.text.replace("苹果", "Apple")), source.replace("苹果", "Apple"));
	});

	it("preserves the reply-block separator used to retain tool ordering", () => {
		const separator = "\n\n<omp-translation-block-123e4567-e89b-12d3-a456-426614174000>\n\n";
		const source = `苹果${separator}香蕉`;
		const prepared = prepareTranslation(source);
		const restored = prepared.restore(prepared.text.replace("苹果", "Apple").replace("香蕉", "Banana"));
		assert.deepEqual(restored.split(separator), ["Apple", "Banana"]);
	});

	it("protects unmatched marker delimiters already present in the original", () => {
		for (const source of ["苹果 ⟧", "苹果 ⟦unfinished"]) {
			const prepared = prepareTranslation(source);
			assert.equal(prepared.restore(prepared.text.replace("苹果", "Apple")), source.replace("苹果", "Apple"));
		}
	});

	it("keeps empty and protected-only documents out of translation", () => {
		for (const source of [
			"",
			" \n\t",
			"123",
			"---\n",
			"`中文`",
			"```ts\nconst x = '中文';\n```\nhttps://example.test/a\n/Users/alice/file.ts",
			"$ echo 中文\n",
		]) {
			const prepared = prepareTranslation(source);
			assert.equal(prepared.needsTranslation, false);
			assert.equal(prepared.text, source);
			assert.equal(prepared.restore(source), source);
			assert.throws(() => prepared.restore(`${source}changed`));
		}
	});

	it("allows same-language no-op prose and translation to either language", () => {
		for (const [source, translation] of [
			["Already English.", "Already English."],
			["苹果", "Apple"],
			["Apple", "苹果"],
		]) {
			const prepared = prepareTranslation(source);
			assert.equal(prepared.restore(prepared.text.replace(source, translation)), translation);
		}
	});

	it("ignores provider boundary padding without changing original document whitespace", () => {
		const source = " \r\n苹果 \r\n";
		const prepared = prepareTranslation(source);
		const valid = prepared.text.replace("苹果", "Apple");
		assert.equal(prepared.restore(`\n \t${valid}\r\n `), " \r\nApple \r\n");
		assert.throws(() => prepared.restore(`${valid}\nExplanation`));
		assert.throws(() => prepared.restore(`Explanation\n${valid}`));
		assert.throws(() => prepared.restore(valid.replace("</doc>", "")));
	});

	it("allows ordinary English exclamations in sentences, emphasis and table cells", () => {
		for (const source of ["太棒了！", "**太棒了！**", "| 太棒了！ |\n| --- |"]) {
			const prepared = prepareTranslation(source);
			assert.equal(prepared.restore(prepared.text.replace("太棒了！", "Great!")), source.replace("太棒了！", "Great!"));
		}
		const prepared = prepareTranslation("苹果");
		assert.throws(() => prepared.restore(prepared.text.replace("苹果", "![Apple](https://example.test)")));
	});

	it("distinguishes invalid markers from changed document layout for failure handling", () => {
		const prepared = prepareTranslation("Apple");
		assert.throws(
			() => prepared.restore(prepared.text.replace("</doc>", "")),
			error => error instanceof TranslationProtectionError && error.code === "marker",
		);
		assert.throws(
			() => prepared.restore(prepared.text.replace("Apple", "**Apple**")),
			error => error instanceof TranslationProtectionError && error.code === "layout",
		);
	});

	it("translates unspaced prose inside paired document boundaries without empty inline sentinels", () => {
		const prepared = prepareTranslation("沒有空格的");
		assert.equal(prepared.restore('<doc id="omp0">Spaceless</doc>'), "Spaceless");
		for (const invalid of [
			'<doc id="omp0"></doc> without spaces',
			'<doc id="omp0">Spaceless',
			'<doc id="omp1">Spaceless</doc>',
			'<doc id="omp0"><doc id="omp0">Spaceless</doc></doc>',
		]) {
			assert.throws(() => prepared.restore(invalid));
		}
	});

	it("restores source line breaks when the provider removes whitespace inside protected formatting", () => {
		for (const separator of ["\n", "\r\n", "\n\n", "  \n"]) {
			const source = `請直接翻譯這一行。${separator}第二行也要保留。`;
			const prepared = prepareTranslation(source);
			const translated = prepared.text
				.replace("請直接翻譯這一行。", "Please translate this line directly.")
				.replace("第二行也要保留。", "The second line should also be kept unchanged.")
				.replace(/\r\n|\r|\n/g, "");
			assert.equal(
				prepared.restore(translated),
				`Please translate this line directly.${separator}The second line should also be kept unchanged.`,
			);
		}
	});

	it("accepts spaced ordinary punctuation while preserving source-owned repeated spaces", () => {
		for (const punctuation of [",", ".", "!", "?", ":", ";", "，", "。", "！", "？", "：", "；"]) {
			for (const spacing of [" ", "  "]) {
				const source = `第一句${spacing}${punctuation}${spacing}第二句`;
				const prepared = prepareTranslation(source);
				const translated = prepared.text.replace("第一句", "First sentence").replace("第二句", "Second sentence")
					.replace(/ {2,}/g, " ");
				assert.equal(prepared.restore(translated), `First sentence${spacing}${punctuation}${spacing}Second sentence`);
			}
		}
	});

	it("rejects missing, duplicated, reordered, malformed and unknown tokens atomically", () => {
		const prepared = prepareTranslation("苹果 `中文`\n香蕉 /path/file.ts\n樱桃 `最後`");
		const valid = prepared.text.replace("苹果", "Apple").replace("香蕉", "Banana").replace("樱桃", "Cherry");
		const markers = valid.match(/<ph\b[^>]*>[^<]*<\/ph>/g)!;
		const invalid = [
			valid.replace(markers[0], ""),
			valid.replace(markers[1], ""),
			valid.replace(markers.at(-1)!, ""),
			valid.replace(markers[1], markers[1] + markers[1]),
			valid.replace(markers[1], "<swap>").replace(markers[2], markers[1]).replace("<swap>", markers[2]),
			valid.replace(markers[1], '<ph id="omp0-999">[999]</ph>'),
			valid.replace(markers[1], '<ph id="omp0-01">[01]</ph>'),
			valid.replace(markers[1], '<ph id="omp0--1">[-1]</ph>'),
			valid.replace(markers[1], '<ph id="omp0-x">[x]</ph>'),
			valid.replace(markers[1], '<ph id="omp0-1">'),
			valid.replace(markers[1], 'ph id="omp0-1">[1]</ph>'),
			valid.replace(markers[1], '<ph id="omp9-1">[1]</ph>'),
			valid.replace("Apple", "Apple ⟦x⟧"),
			`Commentary\n${valid}`,
			`${valid}\nCommentary`,
			valid.slice(0, valid.indexOf("Banana")),
		];
		for (const text of invalid) {
			assert.throws(() => prepared.restore(text));
			// A failed restore commits no partial result and does not poison this document.
			assert.equal(prepared.restore(valid), "Apple `中文`\nBanana /path/file.ts\nCherry `最後`");
		}
	});

	it("rejects incomplete paragraphs and unsafe Markdown rather than salvaging fragments", () => {
		const prepared = prepareTranslation("苹果\n\n香蕉\n樱桃");
		for (const replacement of [
			"",
			"**Apple**",
			"# Apple",
			"- Apple",
			"1. Apple",
			"<script>",
			"Apple\nInjected",
			"Apple\u0000",
			"Apple\u202e",
			"&nbsp;",
		]) {
			assert.throws(() => prepared.restore(prepared.text.replace("苹果", replacement)));
		}
		assert.throws(() => prepared.restore(prepared.text.replace("香蕉", "")));
		assert.throws(() => prepared.restore(prepared.text.replace(/<ph\b[^>]*>[^<]*<\/ph>/, "")));
	});

	it("rejects newly introduced link or image syntax beside protected references", () => {
		for (const [source, from, to] of [
			["[引用]苹果", "苹果", "(destination)"],
			["苹果[引用]", "苹果", "Apple!"],
		]) {
			const prepared = prepareTranslation(source);
			assert.throws(() => prepared.restore(prepared.text.replace(from, to)));
		}
	});

	it("recognizes commands, skills, queue prefixes and continuation shortcuts", () => {
		for (const text of ["/translator off", " /skill:learn", "!ls", "$ echo hi", "-> next", "=> next", ".", " c "]) {
			assert.equal(isControlInput(text), true);
		}
		for (const text of ["Normal prose", "", "continue", "a/b", "A sentence."]) {
			assert.equal(isControlInput(text), false);
		}
	});
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { math } from "micromark-extension-math";
import { mathFromMarkdown } from "mdast-util-math";
import { isControlInput, prepareTranslation, TranslationProtectionError } from "./translator-core.ts";

const parse = (source: string) => fromMarkdown(source, {
	extensions: [gfm(), math()],
	mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
});
const translated = (source: string, pairs: Record<string, string>) => {
	const plan = prepareTranslation(source);
	return plan.restore(plan.units.map(unit => pairs[unit.text] ?? unit.text));
};

describe("parser-backed Markdown translation", () => {
	it("preserves nested prefixes, CRLF, emphasis, escapes and entities", () => {
		const source = "> - **Hello**\r\n>   next &amp; \\* text  \r\n>   last\r\n";
		assert.equal(
			translated(source, { Hello: "你好", next: "接著", text: "文字", last: "最後" }),
			"> - **你好**\r\n>   接著 &amp; \\* 文字  \r\n>   最後\r\n",
		);
	});

	it("preserves GFM table cells, tasks and all code bytes", () => {
		const source = "- [x] Ready\n\n| Status | Command |\n|:---|---:|\n| Ready | `ssh router1` |\n\n```sh\necho 'Do not translate'\n```\n";
		const result = translated(source, { Ready: "就緒", Status: "狀態", Command: "指令" });
		assert.equal(result, "- [x] 就緒\n\n| 狀態 | 指令 |\n|:---|---:|\n| 就緒 | `ssh router1` |\n\n```sh\necho 'Do not translate'\n```\n");
		assert.deepEqual(parse(result).children.map(node => node.type), ["list", "table", "code"]);
	});

	it("translates explicit labels without changing URLs, reference IDs or images", () => {
		const source = "Read [details](https://example.com/a_(b) \"Title\") and [guide][ref].\n\n[ref]: /guide.md \"Literal\"\n\n[ref] [ref][] <https://example.com> ![Image #1](image.png)\n";
		assert.equal(
			translated(source, { Read: "閱讀", details: "詳情", and: "以及", guide: "指南" }),
			"閱讀 [詳情](https://example.com/a_(b) \"Title\") 以及 [指南][ref].\n\n[ref]: /guide.md \"Literal\"\n\n[ref] [ref][] <https://example.com> ![Image #1](image.png)\n",
		);
	});

	it("uses UTF-16 positions correctly after non-BMP characters", () => {
		const source = "🧪 中文 **Hello** `原始碼` and [details](https://example.com)";
		assert.equal(
			translated(source, { Hello: "你好", and: "以及", details: "詳情" }),
			"🧪 中文 **你好** `原始碼` 以及 [詳情](https://example.com)",
		);
	});

	it("contractions and punctuated slash compounds remain translatable", () => {
		const source = "That's a bug/limit; the host's pipeline can't fix it.";
		const plan = prepareTranslation(source);
		assert.equal(plan.restore(plan.units.map(() => "這是限制，無法修復。")), "這是限制，無法修復。");
	});

	for (const [source, target] of [
		["100 MB/file (4 parts)", "100 MB/個檔案（4 個部分）"],
		["Alpha/Beta stays on stage2", "Alpha/Beta仍在stage2"],
		["(IP type/reputation) when serving", "（IP類型/聲譽）於服務時"],
		["backup/rollback and MB/s", "備份/回滾功能（修復中），MB/s）"],
		["Alpha/Beta, Gamma One", "Alpha/Beta、Gamma One"],
		["the app (Alpha/Beta, Gamma One)", "應用程式（Alpha/Beta、Gamma One）"],
		["BOOT/RESET, Pointers/structs", "BOOT/RESET、指針/結構體、cJSON"],
		["process/app rules are deliberate per-device behavior — kept as-is)", "處理/應用程式規則是刻意的逐裝置行為——維持不變。"],
		["slash compounds before Han mid-sentence", "處理/應用程式、備份/回滾都正常。"],
		// Same class in Arabic: candidates end at spaces, but Arabic punctuation (،؛) must not
		// break the two-word shape either.
		["backup/rollback works well", "النسخ/الاستعادة تعمل بشكل جيد، شكراً."],
		["read/write mode", "وضع القراءة/الكتابة؛ مفيد"],
	]) {
		it(`accepts slash-compound translations: ${source}`, () => {
			const plan = prepareTranslation(source);
			assert.deepEqual(plan.units, [{ text: source }]);
			const tree = parse(plan.restore([target]));
			const paragraph = tree.children[0];
			if (paragraph.type !== "paragraph" || paragraph.children[0].type !== "text") throw new Error("Lost prose");
			assert.equal(paragraph.children[0].value, target);
		});
	}

	it("classifies extension-bearing slash compounds consistently around punctuation", () => {
		const result = translated("Use Bun/Node.js, Go, or Python.", {
			Use: "使用",
			"Go, or Python.": "Go 或 Python。",
		});
		assert.equal(result, "使用 Bun/Node.js, Go 或 Python。");
	});

	it("keeps multi-slash ASCII paths protected while prose slashes translate", () => {
		const plan = prepareTranslation("Extract to usr/local/bin and read docs/guide.");
		assert.deepEqual(plan.units.map(unit => unit.text), ["Extract to", "and read"]);
		assert.equal(plan.restore(["解壓到", "並閱讀"]), "解壓到 usr/local/bin 並閱讀 docs/guide.");
	});

	it("keeps strong nodes when translated punctuation changes closer flanking", () => {
		const result = translated("**Every segment stays intact**. A reply has many.", {
			"Every segment stays intact": "每個片段都保持完整。",
			". A reply has many.": "29行內容。",
		});
		assert.equal(result, "**每個片段都保持完整。**&#50;9行內容。");
		const paragraph = parse(result).children[0];
		if (paragraph.type !== "paragraph") throw new Error("Lost paragraph");
		assert.deepEqual(paragraph.children.map(node => node.type), ["strong", "text"]);
	});

	it("retains separate strong and emphasis nodes from the recorded failure", () => {
		const result = translated("Use **small models**. Their fix uses *alignments*.", {
			Use: "使用",
			"small models": "小型模型。",
			". Their fix uses": "他們使用",
			alignments: "對齊方式",
		});
		const paragraph = parse(result).children[0];
		if (paragraph.type !== "paragraph") throw new Error("Lost paragraph");
		assert.deepEqual(paragraph.children.map(node => node.type), ["text", "strong", "text", "emphasis", "text"]);
	});

	it("handles opener flanking and ordinary untranslated digits without added whitespace", () => {
		assert.equal(translated("Lead:**word**", { "Lead:": "前言", word: "「詞」" }), "前&#35328;**「詞」**");
		assert.equal(translated("**Ready**29", { Ready: "就緒。" }), "**就緒。**&#50;9");
		assert.equal(
			translated("**Ready**𝟙**Next**", { Ready: "就緒。", Next: "下一個" }),
			"**就緒。**&#120793;**下一個**",
		);
	});

	it("fails closed when flanking would require changing a protected path", () => {
		const plan = prepareTranslation("**Ready**config.json");
		assert.throws(() => plan.restore(["就緒。"]), TranslationProtectionError);
	});

	it("retains explicit paths and rejects genuinely introduced technical literals", () => {
		const source = "Edit /tmp/資料 src/資料 中文/config.yaml foo/bar1 now";
		assert.equal(
			translated(source, { Edit: "編輯", now: "現在" }),
			"編輯 /tmp/資料 src/資料 中文/config.yaml foo/bar1 現在",
		);
		for (const literal of ["/tmp/資料", "src/資料", "中文/config.yaml", "foo/bar1", "https://example.test", "--danger", "CONFIG_PATH"]) {
			assert.throws(() => prepareTranslation("Hello").restore([`新增 ${literal}`]), TranslationProtectionError);
		}
	});

	it("keeps technical literals and unformatted shell commands intact", () => {
		const source = "Edit '/Users/alice/a b/config.yaml' and config.json on 192.168.50.1 with --dry-run.\n\nssh router1 'uname -a'\n";
		assert.equal(
			translated(source, { Edit: "編輯", and: "以及", on: "位於", with: "使用" }),
			"編輯 '/Users/alice/a b/config.yaml' 以及 config.json 位於 192.168.50.1 使用 --dry-run.\n\nssh router1 'uname -a'\n",
		);
	});

	it("model punctuation cannot inject links, HTML, lists or table columns", () => {
		const result = translated("| Label |\n|---|\n| Value |\n", { Value: "[click](target) | <br>" });
		const tree = parse(result);
		const table = tree.children[0];
		if (table.type !== "table") throw new Error("Translation changed the table");
		assert.equal(table.children[1].children.length, 1);
		const children = table.children[1].children[0].children;
		assert.deepEqual(children.map(node => node.type), ["text"]);
		if (children[0].type !== "text") throw new Error("Translation introduced markup");
		assert.equal(children[0].value, "[click](target) | <br>");
	});

	it("preserves inline math while translating adjacent Unicode and emphasis", () => {
		const source = "🧪 **Bandwidth** $B = f_{\\max}$ needs units.\n";
		assert.equal(
			prepareTranslation(source).restore(["頻寬", "需要單位。"]),
			"🧪 **頻寬** $B = f_{\\max}$ 需要單位。\n",
		);
	});

	it("preserves multiline display math and CRLF while translating prose", () => {
		const formula = "$$\r\nX(f) = \\int_{-\\infty}^{\\infty} x(t) e^{-j 2\\pi f t} \\, dt\r\n$$";
		const source = `Spectrum:\r\n\r\n${formula}\r\n\r\nAfter.\r\n`;
		const result = prepareTranslation(source).restore(["頻譜：", "接著。"]);
		assert.equal(result, `頻譜：\r\n\r\n${formula}\r\n\r\n接著。\r\n`);
		assert.deepEqual(parse(result).children.map(node => node.type), ["paragraph", "math", "paragraph"]);
	});

	it("preserves formulas inside GFM tables without translating their fragments", () => {
		const formula = "$B_{\\text{channel}} \\ge B_{\\text{signal}}$";
		const source = `| Condition | Effect |\n|---|---|\n| ${formula} | Clean signal |\n`;
		const result = prepareTranslation(source).restore(["條件", "效果", "清晰訊號"]);
		assert.equal(result, `| 條件 | 效果 |\n|---|---|\n| ${formula} | 清晰訊號 |\n`);
		const table = parse(result).children[0];
		if (table.type !== "table") throw new Error("Lost table");
		assert.equal(table.children[1].children[0].children[0].type, "inlineMath");
	});

	for (const source of [
		"$f_{\\max}$",
		"$$B \\approx \\frac{0.35}{t_r}$$",
		"$$\r\n10\\%\\text{--}90\\% \\, dt\r\n$$\r\n",
	]) {
		it(`math-only content requires no translation: ${source}`, () => {
			assert.equal(prepareTranslation(source).restore([]), source);
		});
	}

	it("translated dollar signs remain prose instead of creating math", () => {
		const result = prepareTranslation("Explain the cost.").restore(["價格 $5，代號 $x$。"]);
		const paragraph = parse(result).children[0];
		if (paragraph.type !== "paragraph") throw new Error("Lost paragraph");
		assert.deepEqual(paragraph.children.map(node => node.type), ["text"]);
		if (paragraph.children[0].type !== "text") throw new Error("Introduced math");
		assert.equal(paragraph.children[0].value, "價格 $5，代號 $x$。");
	});

	it("code-only documents restore without any translation", () => {
		const source = "```json\n{\"message\":\"hello\"}\n```\n\n    ssh router1\n";
		assert.equal(prepareTranslation(source).restore([]), source);
	});

	it("missing text and control characters fail without partial restoration", () => {
		const plan = prepareTranslation("**Hello** `code` world");
		assert.throws(() => plan.restore(["你好"]), TranslationProtectionError);
		assert.throws(() => plan.restore(["你好", ""]), TranslationProtectionError);
		assert.throws(() => plan.restore(["你好", "世界\u001b[31m"]), TranslationProtectionError);
		assert.throws(() => plan.restore(["你好", "https://evil.test"]), TranslationProtectionError);
	});

	it("existing control inputs retain their bypass behavior", () => {
		for (const input of ["/model", "!echo hi", "$ pwd", "-> next", "=> later", ".", "c"]) assert.equal(isControlInput(input), true);
		assert.equal(isControlInput("Please explain this command."), false);
	});
});

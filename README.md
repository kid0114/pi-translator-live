# pi-translator-live 🔥
[繁體中文](README.zh-TW.md)

Live translation for [pi](https://github.com/earendil-works/pi) when you need an immersive environment with a multilingual mixed agent — including cross-border agents and programming collaboration as immersive language learning. Your input is translated into the **output language** (the language the main model thinks and replies in), and the model's replies are displayed in your **input language** (your reading language). Session history keeps the original text; translations are display-only and never touch what the model sees.

- Automatic source-language detection — type in any language
- Bidirectional: both input→output and reply→display translation, each toggleable independently (`/translator input` translates only input)
- Display translation: while a reply is being generated you see a localized "translating…" placeholder; after the reply finishes, validated translations replace its prose. This is not token-by-token translation streaming.
- Markdown syntax, code, link targets, and recognized technical literals stay intact locally
- Translation runs on a separate, user-selected model; the main model choice is never changed
- Fails closed on input: a failed translation is never sent — your draft is restored to the editor
- Display translations live in memory only; already-printed terminal scrollback is not repainted

## Recent improvements

### 0.1.5: concurrent units and tuned sampling

- **Concurrent units within a job.** Unique prose units are now translated **2 at a time** (`UNIT_CONCURRENCY = 2` in `extensions/translator/index.ts`). Jobs themselves remain single-flight, so input preemption and ordering are unchanged. Results are keyed by unit text and `restore()` reassembles them in original document order, so completion order can never scramble the merged output.
- **Why 2:** a typical local server (`mlx_lm.server --decode-concurrency 4`) has 4 decode slots. Two concurrent clients (this extension and the OMP variant) at 2 each saturate the server evenly instead of one client monopolizing it. On constrained hardware, 2 in-flight requests per client is also a practical ceiling; raising it mainly queues at the server.
- **Tuned request sampling.** Translator requests now send `temperature: 0.2` and `repetition_penalty: 1.02` (see [Recommended Hy-MT2 parameters](#recommended-hy-mt2-parameters)).

### 0.1.4: single-flight queue

- All translation jobs pass through a single FIFO queue — the same mechanism as the OMP variant — so a long reply translation can never run concurrently with your input.
- Interactive input preempts queued reply jobs: your message translates first, queued replies follow. Cancellation rejects the whole queue.

### Fixed in 0.1.3

- **Translated prose containing slashes was falsely rejected.** When the model translated text like `backup/rollback` into Chinese, Japanese, Arabic, or other scripts, the result (a slash followed by CJK text, or trailing Arabic punctuation `،`/`؛`) could be misclassified as a protected file path. Protection validation then discarded the whole reply translation and showed the original. Path detection now requires positive evidence — a root, an extension, a known directory, digits, or multiple slashes — regardless of script.
- **Diagnosable protection failures.** The log line for a rejected translation now includes the offending span (`span N: "…"`), so the cause is identifiable from `translator.log` alone.

### 0.1.2: parser-based translation

- **Parse first, translate prose only:** open-source mdast + GFM parsing replaces model-carried XML markers. The model no longer has to copy Markdown or protected literals correctly.
- **Local reconstruction, atomic publication:** prose units are translated separately, spliced into the original source, and checked against the original Markdown structure before anything is displayed.
- **Mixed prose fixes:** ordinary slash compounds remain translatable; character references at emphasis boundaries preserve formatting without adding visible spaces.
- **Evidence:** the canonical OMP implementation passed parser regressions and historical HyMT2 replays. These are OMP results, not a claim that the newly migrated Pi runtime has passed its smoke checks; see [Verification](#verification).

## Install

```bash
pi install git:github.com/kid0114/pi-translator-live
```

Then start a new pi process. Package installation installs the mdast/GFM parser dependencies automatically; no separate parser setup is needed. On the first interactive session a one-time picker asks you to choose the default translator model; your choice is saved to `~/.pi/agent/translator.json`.

Try it without installing:

```bash
pi -e git:github.com/kid0114/pi-translator-live
```

Pin a release instead of tracking master:

```bash
pi install git:github.com/kid0114/pi-translator-live@v0.1.5
```

Update / remove:

```bash
pi update --extensions
pi remove git:github.com/kid0114/pi-translator-live
```

## Requirements

- pi ≥ 1.1.0
- At least one authenticated model in your pi registry. Any model you already use works — hosted OAuth models and local OpenAI-compatible endpoints (configured in your own `models.json`) alike. Cheap, fast models (e.g. Gemini Flash-class) make the best translators.

## First run

On the first interactive session after installation, a one-time picker asks you to choose the default translator model (recommended lightweight models are marked). Your choice is saved to `~/.pi/agent/translator.json`. Cancel with Esc to use the built-in heuristic pick for the current run; you will be asked again on the next launch.

## Usage

Translation starts enabled. Commands:

| Command | Effect |
|---|---|
| `/translator` or `/translator both` | Enable input + reply translation |
| `/translator input` | Translate input only; replies stay in the output language |
| `/translator off` | Disable; pending translations are cancelled |
| `/translator original` | Read the last completed reply's original text (read-only viewer) |
| `/translator model [query]` | Switch translator model for this run (picker when omitted) |
| `/translator default [query]` | Same, but saved as the default |
| `/translator default clear` | Clear the saved default model |
| `/translator default input [lang]` | Set the **display language** for replies (e.g. `zh-TW`) |
| `/translator default output [lang]` | Set the **main-model language** (e.g. `en`) |

> Naming note: `default input` selects the language replies are **displayed** in; `default output` selects the language your input is translated **into** and the main model replies in.

Language arguments accept codes (`en`, `zh-CN`, `zh-TW`, `ja`, …) or English names; omit the argument to open a picker. 33 languages are built in.

While an input translation is running, press Esc to cancel it.

## Supported languages

All 33 built-in languages can be used as the input (display) language or the output (main-model) language in any combination — the source language is auto-detected by the translator model.

| Code | Language | Code | Language |
|---|---|---|---|
| `en` | English | `ru` | Russian |
| `zh-CN` | Simplified Chinese | `ar` | Arabic |
| `zh-TW` | Traditional Chinese | `hi` | Hindi |
| `ja` | Japanese | `th` | Thai |
| `ko` | Korean | `vi` | Vietnamese |
| `fr` | French | `id` | Indonesian |
| `de` | German | `ms` | Malay |
| `es` | Spanish | `tl` | Filipino |
| `pt` | Portuguese | `tr` | Turkish |
| `it` | Italian | `pl` | Polish |
| `cs` | Czech | `nl` | Dutch |
| `km` | Khmer | `my` | Burmese |
| `fa` | Persian | `gu` | Gujarati |
| `ur` | Urdu | `te` | Telugu |
| `mr` | Marathi | `bn` | Bengali |
| `ta` | Tamil | `jv` | Javanese |
| `he` | Hebrew | | |

Set with `/translator default input <code>` (display) and `/translator default output <code>` (model); English names (`japanese`, …) also work, and omitting the argument opens a picker.

Note: right-to-left languages (`ar`, `he`, `fa`, `ur`) are passed to the terminal as-is; display quality depends on your terminal's bidi support (iTerm2 with bidi enabled, WezTerm, and Windows Terminal handle it well).

## Choosing a translator model

### Local models (recommended when available)

A local model keeps your text on your machine. Latency depends on document length, model size, hardware, and server load. Any OpenAI-compatible server works — llama.cpp, LM Studio, vLLM, SGLang, Ollama, or an MLX server.
Recommended local translator: **Tencent Hunyuan MT2 (HyMT2) 7B, 8-bit quantized** — a dedicated translation model; serve it OpenAI-compatibly and select it with `/translator default`.

Register the endpoint in your own `~/.pi/agent/models.json`:

```json
{
  "providers": {
    "local-translator": {
      "baseUrl": "http://localhost:PORT/v1",
      "api": "openai-completions",
      "apiKey": "local",
      "models": [{ "id": "<model-id-the-server-expects>" }]
    }
  }
}
```

Notes:

- `apiKey` is required by pi even when the server ignores authentication — a dummy value like `"local"` is fine. Without it pi does not list the provider as available.
- The server must accept a `system` role message (the translation instruction) plus one `user` message containing a prose unit, and return only its translated prose.

Then run `/translator default local-translator/<model-id>` once to save it.

### Recommended Hy-MT2 parameters

Tencent's official inference recommendations for Hy-MT2 1.8B/7B (model card and GitHub repo) are:

| Parameter | Tencent recommendation | This extension |
|---|---|---|
| `temperature` | 0.7 | **0.2**, sent per request |
| `top_p` | 0.6 (model card) / 0.8 (generation config) | server default (see below) |
| `top_k` | 20 | server default (see below) |
| `repetition_penalty` | 1.05 | **1.02**, sent per request |
| `max_tokens` | 4096 | model cap (up to 16,384) |

The official values optimize standalone translation quality. This extension deliberately runs a **lower temperature (0.2)**: its prompts demand strict plain-text, single-segment output that is machine-validated before anything is displayed, and near-deterministic decoding measurably reduces format violations and rejected translations. `repetition_penalty` is kept close to the recommendation (1.02 vs 1.05) to suppress repetition loops without distorting ordinary prose. Both are sent on every translator request, so they apply to whichever model is selected.

`top_p` and `top_k` are **not** sent by the extension; if your server supports defaults, set them there. For `mlx_lm.server`, the launch flags matching this profile are:

```bash
python -m mlx_lm.server --model <Hy-MT2-7B-8bit> --host 127.0.0.1 --port 8644 \
  --temp 0.2 --top-p 0.6 --top-k 20 \
  --decode-concurrency 4 --prompt-concurrency 2
```

Server-side `--temp` is only a fallback for clients that do not specify a temperature; the extension's per-request `temperature: 0.2` takes precedence for its own traffic. Note that `mlx_lm.server` has no CLI flag for `repetition_penalty` — that is exactly why the extension sends it per request.

### No local model

Use a hosted model you have already authenticated in pi — no extra setup is needed, it already appears in `/translator model`. Prefer cheap, fast, non-reasoning models (Gemini Flash-class or similar): translation runs on every input and every reply, so a heavyweight reasoning model only adds latency and token cost. The built-in default heuristic already prefers such models on first run.

## How it works

- **Input direction (fail-closed):** your prose is translated to the output language before dispatch. If translation fails, nothing is sent. The current request restores its original draft only when the editor is empty; a newer draft or session is never overwritten. Commands, `!shell`, paths, and code are never translated.
- **Display direction (atomic fallback):** replies show a "translating…" placeholder while generating. Once finalized, the complete reply is translated and validated before a Markdown display transform publishes it. History and what the main model receives are untouched. Failure shows the complete original reply, including original table cells, with one categorized status outside the reply—not failure text or counts inside paragraphs or cells.
- A system-prompt hook asks the main model to write its replies in the output language, preserving your task, code, paths, and tool arguments.
- **Parse-first prose units:** `mdast-util-from-markdown` with GFM parses the source before any model call. Only translatable text spans become units; identical units within a translation job share a request, and unique units are translated with up to 2 concurrent requests (see 0.1.5 above). Code/literal-only content needs no model request. There is no model-carried XML wrapper, marker-copying protocol, or selective fragment-retry protocol.
- **Locally preserved source:** original Markdown delimiters, block order, table layout, line endings, code, link destinations/reference IDs, and recognized commands, paths, URLs, and other technical literals stay on the client. Explicit link labels can be translated without changing their destinations. Literals remain in their original positions rather than being reordered by the model.
- **Reconstruction and validation:** translated prose is escaped as text and spliced into its original source spans. The final document is parsed again; its Markdown structure and protected literal values must match the original before the whole input/reply is accepted. Missing prose, introduced technical literals, or structural changes reject the complete result. Character references may appear beside emphasis delimiters in the raw reconstructed Markdown; they render as ordinary characters without extra visible spacing.
- Ordinary single-slash compounds, including mixed-script prose such as `類型/reputation`, are treated as prose when there is no clear path evidence. This deliberately favors translation for ambiguous bare compounds; put an ambiguous path or technical token in inline code to preserve it explicitly.
- Each request owns its cancellation and **60-second output-idle timer**. The timer starts only after the first nonempty text, thinking, or tool-call delta; empty heartbeats do not reset it. Queue/prefill waiting has no extension deadline, but provider transport and retry limits still apply.
- Mode, session, model, or language changes cancel stale work and prevent stale cache updates. A newer interactive input supersedes an older pending input.
- Translation **jobs** are serialized through a single-flight queue with input priority (same mechanism as the OMP variant); concurrency applies **within** a job, across its prose units. Cross-session fair scheduling remains **not implemented**.
- Pi's Markdown transform exposes no message/block identity. Its display cache is keyed by language and trimmed source text, unlike OMP's message-aware cache; identical text translated differently in separate contexts cannot be independently addressed on Pi's display surface.

## Verification

```bash
node --experimental-strip-types --test extensions/translator/translator-core.test.ts
```

The core regression suite covers source-span restoration, GFM tables/tasks, nested Markdown, Unicode offsets, code and technical literals, link targets, slash compounds, emphasis boundaries, escaped model punctuation, and atomic rejection of missing or unsafe prose. The command above runs the Pi package's Node test suite; parser dependencies are installed by the package manager.

**Verified OMP evidence (2026-10-15):** the canonical OMP parser core passed 22 regressions. All 40 recorded October 13–14 HyMT2 failure cases were reconstructed from cached translations after the parser fixes; the nine cases that had failed the first replay, plus an older October 10 timeout case, also passed 10 fresh real-model replays. A fresh installed OMP 18.10.3 process translated a 5,715-character historical reply in 35.805 seconds while its original viewer retained the English source. A fresh isolated Pi 1.2.0 terminal also loaded this package with the local HyMT2 endpoint: the English assistant reply displayed in Traditional Chinese, and `/translator original` retained the English source. Translation quality is not guaranteed by structural validation.

Pi directly awaits extension handlers and has no OMP-style handler timeout option. The maintained OMP handlers use `{ timeoutMs: 600000 }`, a finite host deadline separate from the per-request output-idle clock; this is not a Pi provider option.

## Troubleshooting

Failures are written to `~/.pi/agent/translator.log` with direction, target language, selected model, elapsed time, category, and cause. Protection failures also include `protectionCode`; original documents and translations are not logged by the extension.

After editing extension files or updating the package, exit Pi and start a new process to load the changed modules. There is no automatic hot reload: switching translator models or toggling translation does not reload extension source.

- `idle-timeout`: output started, then stopped progressing for 60 seconds.
- `provider-timeout` or `provider`: the provider/transport failed; queue waiting alone is not an extension timeout.
- `completion`, `language`, or `protection`: incomplete output, untranslated prose, unsafe prose, or a reconstruction/Markdown structure violation. The complete original reply remains visible; partial translations are never published.
- Input failure: nothing is sent; the original draft is restored only if doing so will not replace newer editor contents.
- `/translator original` opens the latest completed reply's original text without changing history.


## Privacy

Your input and the model's replies are sent to the translator model you selected. Choose a local endpoint if that matters to you. No data is sent anywhere else; the extension stores only your preferences (`translator.json`) and an optional diagnostic log (`translator.log`) inside your own pi agent directory.

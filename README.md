# pi-translator-live 🔥
[繁體中文](README.zh-TW.md)

Live translation for [pi](https://github.com/earendil-works/pi): your input is translated into the **output language** (the language the main model thinks and replies in), and the model's replies are displayed in your **input language** (your reading language). Session history keeps the original text; translations are display-only and never touch what the model sees.

- Automatic source-language detection — type in any language
- Bidirectional: both input→output and reply→display translation, each toggleable independently (`/translator input` translates only input)
- Display translation: while a reply is being generated you see a localized "translating…" placeholder; after the reply finishes, validated translations replace its prose. This is not token-by-token translation streaming.
- Code blocks, inline code, commands, paths, and URLs stay byte-for-byte intact
- Translation runs on a separate, user-selected model; the main model choice is never changed
- Fails closed on input: a failed translation is never sent — your draft is restored to the editor
- Display translations live in memory only; already-printed terminal scrollback is not repainted

## Install

```bash
pi install git:github.com/kid0114/pi-translator-live
```

Then restart pi. On the first interactive session a one-time picker asks you to choose the default translator model; your choice is saved to `~/.pi/agent/translator.json`.

Try it without installing:

```bash
pi -e git:github.com/kid0114/pi-translator-live
```

Pin a release instead of tracking master:

```bash
pi install git:github.com/kid0114/pi-translator-live@v0.1.0
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
- The server must accept a `system` role message (the translation instruction) plus one `user` message containing the complete protected document.

Then run `/translator default local-translator/<model-id>` once to save it.

### No local model

Use a hosted model you have already authenticated in pi — no extra setup is needed, it already appears in `/translator model`. Prefer cheap, fast, non-reasoning models (Gemini Flash-class or similar): translation runs on every input and every reply, so a heavyweight reasoning model only adds latency and token cost. The built-in default heuristic already prefers such models on first run.

## How it works

- **Input direction (fail-closed):** your prose is translated to the output language before dispatch. If translation fails, nothing is sent. The current request restores its original draft only when the editor is empty; a newer draft or session is never overwritten. Commands, `!shell`, paths, and code are never translated.
- **Display direction (atomic fallback):** replies show a "translating…" placeholder while generating. Once finalized, the complete reply is translated and validated before a Markdown display transform publishes it. History and what the main model receives are untouched. Failure shows the complete original reply, including original table cells, with one categorized status outside the reply—not failure text or counts inside paragraphs or cells.
- A system-prompt hook asks the main model to write its replies in the output language, preserving your task, code, paths, and tool arguments.
- Each input or reply uses **one whole-document request**, not per-cell slots or selective fragment retries. Text blocks separated by tool calls retain their order through protected boundaries.
- A paired document wrapper keeps translated prose inside its boundaries, including Chinese without spaces. Formatting and literal bytes are restored from the source; missing, duplicate, malformed, or illegally moved markers reject the complete result. Inline literals may reorder only within the same protected prose region. Line endings, blank lines, Markdown hard breaks, and repeated spaces are protected source formatting, not text the model may collapse. Provider padding outside the wrapper is ignored; ordinary punctuation may be translated.
- Each request owns its cancellation and **60-second output-idle timer**. The timer starts only after the first nonempty text, thinking, or tool-call delta; empty heartbeats do not reset it. Queue/prefill waiting has no extension deadline, but provider transport and retry limits still apply.
- Mode, session, model, or language changes cancel stale work and prevent stale cache updates. A newer interactive input supersedes an older pending input.
- Shared cross-session fair scheduling and asynchronous sharding are **not implemented**. Requests are submitted to the selected provider; backend scheduling determines interleaving.
- Pi's Markdown transform exposes no message/block identity. Its display cache is keyed by language and trimmed source text, unlike OMP's message-aware cache; identical text translated differently in separate contexts cannot be independently addressed on Pi's display surface.

## Verification

```bash
node --experimental-strip-types --test extensions/translator/translator-core.test.ts
```

The shared core regression suite covers complete-document restoration, unspaced prose, whitespace, punctuation, protected literal bytes, bounded literal reordering, malformed boundaries, and atomic rejection of damaged Markdown. Runtime validation additionally exercises the actual Pi terminal, real HyMT2 input/output, malformed and truncated responses, overlapping requests within and across sessions, queue cancellation, newer-draft preservation, and independent output-idle clocks. Pi directly awaits extension handlers; maintained OMP handlers opt out of the host deadline with `{ timeoutMs: 0 }`. That OMP hook option is not a Pi provider option.

## Troubleshooting

Failures are written to `~/.pi/agent/translator.log` with direction, target language, selected model, elapsed time, category, and cause. Protection failures also include `protectionCode`; original documents and translations are not logged by the extension.

After editing extension files, restart Pi to load the changed modules. Switching translator models or toggling translation does not reload extension source.

- `idle-timeout`: output started, then stopped progressing for 60 seconds.
- `provider-timeout` or `provider`: the provider/transport failed; queue waiting alone is not an extension timeout.
- `completion`, `language`, or `protection`: incomplete output, untranslated prose, or a violated document/literal contract. The complete original reply remains visible.
- Input failure: nothing is sent; the original draft is restored only if doing so will not replace newer editor contents.
- `/translator original` opens the latest completed reply's original text without changing history.


## Privacy

Your input and the model's replies are sent to the translator model you selected. Choose a local endpoint if that matters to you. No data is sent anywhere else; the extension stores only your preferences (`translator.json`) and an optional diagnostic log (`translator.log`) inside your own pi agent directory.

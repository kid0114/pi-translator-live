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

A local model keeps your text on your machine. Latency depends on model size, hardware, server load, and the number of prose segments. Any OpenAI-compatible server works — llama.cpp, LM Studio, vLLM, SGLang, Ollama, or an MLX server.

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
- The server must accept a `system` role message (the translation instruction) plus one `user` message per prose segment.

Then run `/translator default local-translator/<model-id>` once to save it.

### No local model

Use a hosted model you have already authenticated in pi — no extra setup is needed, it already appears in `/translator model`. Prefer cheap, fast, non-reasoning models (Gemini Flash-class or similar): translation runs on every input and every reply, so a heavyweight reasoning model only adds latency and token cost. The built-in default heuristic already prefers such models on first run.

## How it works

- **Input direction (fail-closed):** your prose is translated to the output language before dispatch. If translation fails, nothing is sent and your draft returns to the editor. Commands, `!shell`, paths, and code are never translated.
- **Display direction (degrades gracefully):** replies show a "translating…" placeholder while generating; prose segments are translated when the message finalizes, and a Markdown display transform swaps in the cached translation. History and what the model receives are untouched. If translation fails or reaches its 30-second display deadline, validated translations remain; unresolved prose shows an explicit localized failure message alongside its original text.
- A system-prompt hook asks the main model to write its replies in the output language, preserving your task, code, paths, and tool arguments.
- Marked batches contain at most **8 prose slots** and **1,200 characters**, including markers and separators. An indivisible oversized slot is translated alone.
- Unique, canonical segment identities can arrive out of order. Missing, duplicate, ambiguous, or invalid segments are retried individually; already validated segments are not requested again. Request failures do not trigger blind batch retries.
- Input stays all-or-nothing: no partially translated draft is submitted. Mode, session, model, or language changes cancel stale work and prevent stale cache updates.

## Verification

```bash
node --experimental-strip-types --test extensions/translator/translator-core.test.ts
```

The regression suite exercises bounded batching, selective retries, malformed identities, protected source bytes, partial-result retention, cancellation, and fail-closed input. OMP and Pi share the same core algorithm but retain their own host APIs and deadlines; the maintained OMP host supports a 65-second handler budget around the translator's 60-second internal deadline.


## Privacy

Your input and the model's replies are sent to the translator model you selected. Choose a local endpoint if that matters to you. No data is sent anywhere else; the extension stores only your preferences (`translator.json`) and an optional diagnostic log (`translator.log`) inside your own pi agent directory.

# AI use

Every AI tool used in this project, what it did, and what it did not do. Team Ingito directed the
work and made the product decisions.

## Tools

| Tool | Used for |
|---|---|
| **Claude** (Anthropic), through Claude Code | Wrote most of the code in this repository: the radar pipeline in `sar-flood/`, and the pack pipeline and field app in `ingito/`. Also wrote the documentation, and built the compositions for the team's videos (not in this repository). |
| **Codex** (OpenAI), through codex-cli | Built a separate practice project, Shakti Map, which is not in this repository. Its build logs, with the prompts sent to Codex, are in `build-logs/`. |
| **Kokoro** text-to-speech (model `kokoro-v1.0`, run on our own computer with the open-source `kokoro-onnx` package, voice `af_heart`) | The narration voice in the team's videos (not in this repository). |

## What AI does not do

- **No AI model detects the flood.** The flood layer comes from fixed, readable code: the ratio of
  two Sentinel-1 radar images and a threshold chosen by Otsu's method. See `sar-flood/s1_flood.py`
  and `sar-flood/METHODOLOGY.md`.
- **The field app has no AI features** and calls no AI service. It works with no network at all.
- **Every number the app shows comes from the pack**, which the pipeline builds from the satellite
  data. None of them were written by a language model.

## Key prompts

- Codex: the prompts are kept verbatim in `build-logs/`.
- Claude: *to be added by the team.*

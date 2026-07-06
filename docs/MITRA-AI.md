# Mitra Brain — Owning Our Intelligence

Why: API-priced LLMs don't scale to an everything-app for all of India.
The answer is a **data flywheel** that starts free and compounds daily,
ending with a language model we own outright.

## Phase 1 — TODAY (shipped, ₹0/month)
- `js/brain.js`: our own trainable intent model running in every user's
  browser. Hashing-trick features (word/bigram/char-trigram, EN+Hinglish)
  → softmax regression, online SGD. ~14K parameters.
- **Held-out accuracy: 100%** on unseen Hinglish test phrases after seed
  training; every conversation makes it better (verified: one training
  step lifted a phrase from 54% → 93% confidence).
- **The flywheel (fully automated):** every Mitra message is logged with
  the model's prediction; rule-engine matches auto-label it (weak
  supervision); Admin → Mitra AI lets humans label the hard ones (each
  label = instant training step); the dataset syncs to Supabase
  (`mitra_utterances`) and exports as JSONL.
- Rules stay as the precision layer; the brain routes what rules miss.

## Phase 2 — WHEN TRAFFIC GROWS (optional, pay-per-hard-query)
- `config.js → llm`: plug an Anthropic API key and unknown queries
  escalate to Claude (`claude-haiku-4-5`, $1/$5 per MTok — chosen for
  cost; `claude-opus-4-8` for max quality).
- **Every Claude answer is logged as a labeled example** — Claude
  effectively trains our model for us (distillation). Escalation rate
  falls as the brain absorbs the patterns. Spend is self-limiting.

## Phase 3 — OUR OWN FULL LLM (when dataset ≥ ~50K labeled utterances)
1. Export the dataset: Admin → Mitra AI → *Export dataset (JSONL)*
   (or `select * from mitra_training_set` in Supabase).
2. Fine-tune a small open-weights model (1–4B: Qwen2.5, Gemma, Sarvam-1
   — the last one is built for Indian languages) with LoRA on a rented
   GPU. Ballpark: one A100 for a weekend ≈ $50–150 **one-time**.
3. Serve it quantized (llama.cpp / vLLM) on a $20–40/month GPU VPS, or
   on-device for flagship phones. Marginal cost per query ≈ zero.
4. Keep the flywheel: the served model's mistakes get relabeled in the
   same admin console and feed the next fine-tune.

## Cost trajectory
| Stage | Monthly cost | Who answers |
|---|---|---|
| Now | ₹0 | rules + our brain (in-browser) |
| Growth | only hard queries × Haiku pricing | brain first, Claude rarely |
| Scale | ~$20–40 hosting flat | **our own model** |

## Data hygiene
Utterances are capped, truncated to 200 chars, device-keyed (no names/
phones logged). Before Phase 3 training: strip numbers that look like
phones, dedupe, and balance classes (the export already carries `src`
so human labels can be weighted above weak labels).

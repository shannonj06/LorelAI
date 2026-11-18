"""Model providers for the generation step.

generation.py only needs one thing from a model: given a system prompt and a
conversation, return text plus why it stopped and how many tokens it used.
Each provider adapts one API to that:

  OpenRouterProvider  OpenAI-compatible chat API at openrouter.ai, used for the
                      free models (default: google/gemma-4-26b-a4b-it:free).
  AnthropicProvider   Claude through the Anthropic SDK, with schema-enforced JSON.

Which one runs is picked from the environment (see default_provider()):
  LLM_PROVIDER=openrouter|anthropic   (default: openrouter when OPENROUTER_API_KEY is set)
  OPENROUTER_API_KEY, OPENROUTER_MODEL, OPENROUTER_FALLBACK_MODELS, OPENROUTER_BASE_URL
  ANTHROPIC_API_KEY

Providers raise ModelError("unavailable") for temporary problems (network, rate
limits, overloaded upstream) and ModelError("config") for ones a retry won't fix
(missing or rejected key, unknown model). A refusal is not an error: it comes
back as stop_reason "refusal".
"""

import json
import os
import socket
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field

import anthropic

ANTHROPIC_MODEL = "claude-opus-5-5"
# On a safety refusal, the API reruns the request on Anthropic's recommended fallback model
ANTHROPIC_FALLBACK_BETA = "server-side-fallback-2026-07-01"
ANTHROPIC_MAX_TOKENS = 16000

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
OPENROUTER_MODEL = "google/gemma-4-26b-a4b-it:free"
# Free models are often rate-limited upstream; OpenRouter tries these in order when the first is busy
OPENROUTER_FALLBACK_MODELS = ("google/gemma-4-31b-it:free", "nvidia/nemotron-3.5-super-vl:free")
# Generous because some free fallbacks are reasoning models whose thinking counts toward the limit
OPENROUTER_MAX_TOKENS = 8192
# Upstream statuses worth retrying: rate limited, timeout, bad gateway, unavailable, gateway timeout
RETRYABLE_STATUS = {408, 429, 500, 502, 503, 504}


class ModelError(Exception):
    """kind: "unavailable" (temporary, worth retrying later) or "config" (needs fixing)."""

    def __init__(self, kind, message):
        super().__init__(message)
        self.kind = kind


@dataclass
class ModelReply:
    text: str | None
    # "end_turn" | "max_tokens" | "refusal"
    stop_reason: str
    usage: dict = field(default_factory=lambda: {"input_tokens": 0, "output_tokens": 0})
    # The model that actually answered (a fallback may have stepped in)
    model: str | None = None


def json_instructions(schema):
    """Output-format rules for models without schema-enforced JSON."""
    example = {
        "status": "answered",
        "statements": [{"text": "A plain sentence supported by the passage.", "source_ids": ["S1"]}],
        "conflicts": [],
        "not_covered": [],
    }
    return (
        "Output format: reply with one JSON object and nothing else: no markdown, no code fences, "
        "no text before or after it. It must match this JSON Schema:\n"
        f"{json.dumps(schema)}\n"
        f"Example of the shape (not of the content): {json.dumps(example)}"
    )


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, client=None, model=ANTHROPIC_MODEL):
        # client: an anthropic.Anthropic (or a test double); created on first use if omitted
        self.client = client
        self.model = model

    def complete(self, system, messages, schema):
        try:
            if self.client is None:
                self.client = anthropic.Anthropic()
            response = self.client.beta.messages.create(
                model=self.model,
                max_tokens=ANTHROPIC_MAX_TOKENS,
                system=system,
                messages=messages,
                output_config={"effort": "medium", "format": {"type": "json_schema", "schema": schema}},
                betas=[ANTHROPIC_FALLBACK_BETA],
                fallbacks="default",
            )
        # The SDK has already retried these with backoff before raising
        except (anthropic.APIConnectionError, anthropic.RateLimitError) as e:
            raise ModelError("unavailable", f"Anthropic API unreachable or rate limited: {e}") from e
        except anthropic.APIStatusError as e:
            kind = "unavailable" if e.status_code >= 500 else "config"
            raise ModelError(kind, f"Anthropic API returned {e.status_code}: {e}") from e
        except anthropic.AnthropicError as e:
            raise ModelError("config", f"Anthropic client error: {e}") from e
        except TypeError as e:
            # The SDK raises a plain TypeError at request time when no API key, auth token
            # or credentials profile is configured. Any other TypeError is a bug, so re-raise it.
            if "authentication" not in str(e):
                raise
            raise ModelError("config", "No Anthropic credentials configured (set ANTHROPIC_API_KEY)") from e

        response_usage = getattr(response, "usage", None)
        usage = {key: getattr(response_usage, key, 0) or 0 for key in ("input_tokens", "output_tokens")}
        text = next((block.text for block in response.content if block.type == "text"), None)
        stop = response.stop_reason if response.stop_reason in ("max_tokens", "refusal") else "end_turn"
        return ModelReply(text=text, stop_reason=stop, usage=usage, model=getattr(response, "model", self.model))


def _urllib_post(url, headers, payload, timeout):
    request = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


class OpenRouterProvider:
    """OpenRouter's OpenAI-compatible chat completions API, standard library only."""

    name = "openrouter"

    def __init__(
        self,
        api_key,
        model=OPENROUTER_MODEL,
        fallbacks=OPENROUTER_FALLBACK_MODELS,
        base_url=OPENROUTER_BASE_URL,
        timeout=120,
        retries=2,
        post=_urllib_post,
        sleep=time.sleep,
    ):
        self.api_key = api_key
        self.model = model
        self.fallbacks = tuple(m for m in fallbacks if m and m != model)
        self.url = base_url.rstrip("/") + "/chat/completions"
        self.timeout = timeout
        self.retries = retries
        self.post = post
        self.sleep = sleep

    @classmethod
    def from_env(cls, env=None):
        env = os.environ if env is None else env
        fallbacks = env.get("OPENROUTER_FALLBACK_MODELS")
        return cls(
            api_key=env.get("OPENROUTER_API_KEY"),
            model=env.get("OPENROUTER_MODEL") or OPENROUTER_MODEL,
            fallbacks=OPENROUTER_FALLBACK_MODELS if fallbacks is None else [m.strip() for m in fallbacks.split(",")],
            base_url=env.get("OPENROUTER_BASE_URL") or OPENROUTER_BASE_URL,
        )

    def complete(self, system, messages, schema):
        if not self.api_key:
            raise ModelError("config", "OPENROUTER_API_KEY is not set")
        payload = {
            "model": self.model,
            "messages": [{"role": "system", "content": f"{system}\n\n{json_instructions(schema)}"}, *messages],
            "max_tokens": OPENROUTER_MAX_TOKENS,
            "temperature": 0.2,
            "response_format": {"type": "json_object"},
            # Answers are short and grounded; long hidden reasoning only adds latency.
            # Models without a reasoning mode ignore this.
            "reasoning": {"effort": "low"},
        }
        if self.fallbacks:
            payload["models"] = [self.model, *self.fallbacks]
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}

        last_problem = "no response"
        for attempt in range(self.retries + 1):
            if attempt:
                self.sleep(2 * attempt)  # 2 s, then 4 s
            try:
                status, raw = self.post(self.url, headers, payload, self.timeout)
            except (urllib.error.URLError, TimeoutError, socket.timeout, ConnectionError, OSError) as e:
                last_problem = f"could not reach OpenRouter: {e}"
                continue

            try:
                data = json.loads(raw or b"{}")
            except json.JSONDecodeError:
                data = {}
            error = data.get("error") if isinstance(data, dict) else None
            if error or status != 200:
                code = error.get("code") if isinstance(error, dict) else None
                code = code if isinstance(code, int) else status
                detail = ""
                if isinstance(error, dict):
                    raw_detail = (error.get("metadata") or {}).get("raw") if isinstance(error.get("metadata"), dict) else None
                    detail = raw_detail or error.get("message") or ""
                last_problem = f"OpenRouter returned {code}: {str(detail)[:300]}"
                if code in RETRYABLE_STATUS:
                    continue
                raise ModelError("config", last_problem)

            choice = (data.get("choices") or [{}])[0]
            finish = choice.get("finish_reason")
            if finish == "error":
                last_problem = "the upstream model failed mid-answer"
                continue
            content = (choice.get("message") or {}).get("content")
            if isinstance(content, list):  # some providers return content parts
                content = "".join(part.get("text", "") for part in content if isinstance(part, dict))
            usage = data.get("usage") or {}
            return ModelReply(
                text=content,
                stop_reason={"length": "max_tokens", "content_filter": "refusal"}.get(finish, "end_turn"),
                usage={"input_tokens": usage.get("prompt_tokens") or 0, "output_tokens": usage.get("completion_tokens") or 0},
                model=data.get("model") or self.model,
            )

        raise ModelError("unavailable", last_problem)


def default_provider(env=None):
    env = os.environ if env is None else env
    name = (env.get("LLM_PROVIDER") or ("openrouter" if env.get("OPENROUTER_API_KEY") else "anthropic")).lower()
    if name == "openrouter":
        return OpenRouterProvider.from_env(env)
    if name == "anthropic":
        return AnthropicProvider()
    raise ValueError(f"Unknown LLM_PROVIDER {name!r}; use openrouter or anthropic")


def as_provider(client):
    """None -> the configured provider; a provider -> itself; an Anthropic client -> wrapped."""
    if client is None:
        return default_provider()
    if hasattr(client, "complete"):
        return client
    return AnthropicProvider(client)


def describe(env=None):
    """Which provider and model will answer, and whether its key is set (for health checks)."""
    env = os.environ if env is None else env
    try:
        provider = default_provider(env)
    except ValueError as e:
        return {"provider": None, "model": None, "key_set": False, "error": str(e)}
    if provider.name == "openrouter":
        return {"provider": "openrouter", "model": provider.model, "fallbacks": list(provider.fallbacks),
                "key_set": bool(provider.api_key)}
    return {"provider": "anthropic", "model": provider.model,
            "key_set": bool(env.get("ANTHROPIC_API_KEY") or env.get("ANTHROPIC_AUTH_TOKEN"))}

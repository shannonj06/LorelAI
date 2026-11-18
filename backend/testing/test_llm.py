import json

import pytest

import generation
import llm
from generation import INSUFFICIENT_MESSAGE, generate_answer
from test_generation import BATH, FEEDING, FEEDING_OTHER


class FakeOpenRouter:
    """Records requests and replays canned (status, body) pairs, like urllib would return them."""

    def __init__(self, *replies):
        self.replies = list(replies)
        self.requests = []

    def __call__(self, url, headers, payload, timeout):
        self.requests.append({"url": url, "headers": headers, "payload": payload})
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        status, body = reply
        return status, json.dumps(body).encode()


def completion(content, finish="stop", model="google/gemma-4-26b-a4b-it:free"):
    return 200, {
        "model": model,
        "choices": [{"message": {"role": "assistant", "content": content}, "finish_reason": finish}],
        "usage": {"prompt_tokens": 900, "completion_tokens": 120},
    }


def answer_json(statements, status="answered", conflicts=(), not_covered=()):
    return json.dumps({
        "status": status,
        "statements": [{"text": t, "source_ids": ids} for t, ids in statements],
        "conflicts": [{"summary": s, "source_ids": ids} for s, ids in conflicts],
        "not_covered": list(not_covered),
    })


def provider(fake, **kwargs):
    return llm.OpenRouterProvider(api_key="sk-or-test", post=fake, sleep=lambda s: None, **kwargs)


RATE_LIMITED = (429, {"error": {"code": 429, "message": "Provider returned error",
                                "metadata": {"raw": "temporarily rate-limited upstream"}}})


# Test 1: a grounded answer through OpenRouter
def test_openrouter_answer_with_citations():
    fake = FakeOpenRouter(completion(answer_json([("Bathe at about ten days old.", ["S1"])])))

    result = generate_answer("When can I bathe my baby?", [BATH], client=provider(fake))

    assert result.status == "answered"
    assert "[Holt 1894, p. 2]" in result.answer
    assert result.usage == {"input_tokens": 900, "output_tokens": 120}
    assert result.model == "google/gemma-4-26b-a4b-it:free"

    request = fake.requests[0]
    assert request["url"] == "https://openrouter.ai/api/v1/chat/completions"
    assert request["headers"]["Authorization"] == "Bearer sk-or-test"
    payload = request["payload"]
    assert payload["model"] == "google/gemma-4-26b-a4b-it:free"
    # Fallbacks for when the free model is busy
    assert payload["models"][0] == "google/gemma-4-26b-a4b-it:free"
    assert len(payload["models"]) == 3
    assert payload["response_format"] == {"type": "json_object"}
    system, user = payload["messages"]
    assert system["role"] == "system"
    assert "untrusted data" in system["content"]
    assert '"source_ids"' in system["content"]  # the JSON schema is spelled out
    assert user["role"] == "user" and "<passages>" in user["content"]


@pytest.mark.parametrize(
    "content",
    [
        "```json\n" + answer_json([("Bathe at about ten days old.", ["S1"])]) + "\n```",
        "Here is the answer:\n" + answer_json([("Bathe at about ten days old.", ["S1"])]),
        "<think>The passage says ten days.</think>" + answer_json([("Bathe at about ten days old.", ["S1"])]),
        [{"type": "text", "text": answer_json([("Bathe at about ten days old.", ["S1"])])}],
    ],
    ids=["fenced", "prose-before", "reasoning-block", "content-parts"],
)
def test_json_is_found_inside_common_wrappers(content):
    fake = FakeOpenRouter(completion(content))

    assert generate_answer("When can I bathe my baby?", [BATH], client=provider(fake)).status == "answered"


# Test 2: free-tier rate limits are retried, then reported as temporary
def test_rate_limit_is_retried():
    fake = FakeOpenRouter(RATE_LIMITED, completion(answer_json([("Bathe at about ten days old.", ["S1"])])))

    result = generate_answer("When can I bathe my baby?", [BATH], client=provider(fake))

    assert result.status == "answered"
    assert len(fake.requests) == 2


def test_persistent_rate_limit_is_service_unavailable():
    fake = FakeOpenRouter(RATE_LIMITED, RATE_LIMITED, RATE_LIMITED)

    result = generate_answer("When can I bathe my baby?", [BATH], client=provider(fake))

    assert result.status == "error"
    assert result.error == "service_unavailable"
    assert len(fake.requests) == 3


def test_network_failure_is_service_unavailable():
    fake = FakeOpenRouter(OSError("connection refused"), OSError("connection refused"), OSError("connection refused"))

    assert generate_answer("When can I bathe my baby?", [BATH], client=provider(fake)).error == "service_unavailable"


@pytest.mark.parametrize(
    "reply",
    [
        (401, {"error": {"code": 401, "message": "No auth credentials found"}}),
        (404, {"error": {"code": 404, "message": "No endpoints found matching your data policy"}}),
        (200, {"error": {"code": 400, "message": "Invalid model"}}),
    ],
)
def test_configuration_problems_are_service_errors_without_retry(reply):
    fake = FakeOpenRouter(reply)

    result = generate_answer("When can I bathe my baby?", [BATH], client=provider(fake))

    assert result.error == "service_error"
    assert len(fake.requests) == 1


def test_missing_key_is_a_service_error_without_a_request():
    fake = FakeOpenRouter()

    result = generate_answer("When can I bathe my baby?", [BATH], client=llm.OpenRouterProvider(api_key=None, post=fake))

    assert result.error == "service_error"
    assert fake.requests == []


def test_content_filter_is_a_refusal_and_length_is_retried():
    refused = FakeOpenRouter(completion(None, finish="content_filter"))
    cut_off = FakeOpenRouter(
        completion('{"status": "answered", "statements": [', finish="length"),
        completion(answer_json([("Bathe at about ten days old.", ["S1"])])),
    )

    assert generate_answer("When can I bathe my baby?", [BATH], client=provider(refused)).error == "refusal"
    assert generate_answer("When can I bathe my baby?", [BATH], client=provider(cut_off)).status == "answered"


def test_invalid_citations_get_feedback_on_retry():
    fake = FakeOpenRouter(
        completion(answer_json([("Bathe at about ten days old.", ["S7"])])),
        completion(answer_json([("Bathe at about ten days old.", ["S1"])]), model="google/gemma-4-31b-it:free"),
    )

    result = generate_answer("When can I bathe my baby?", [BATH], client=provider(fake))

    assert result.status == "answered"
    retry = fake.requests[1]["payload"]["messages"]
    assert [m["role"] for m in retry] == ["system", "user", "assistant", "user"]
    assert "unknown source IDs ['S7']" in retry[-1]["content"]
    # Usage adds up across both calls; the model that answered is reported
    assert result.usage == {"input_tokens": 1800, "output_tokens": 240}
    assert result.model == "google/gemma-4-31b-it:free"


def test_multi_book_conflict_through_openrouter():
    fake = FakeOpenRouter(completion(answer_json(
        [("Feed every three hours during the day.", ["S1"]), ("Feed every two hours.", ["S2"])],
        conflicts=[("The books give different feeding intervals.", ["S1", "S2"])],
    )))

    response = generation.to_api_response(
        generate_answer("How often should a 3-month-old eat?", [FEEDING, FEEDING_OTHER], client=provider(fake))
    )

    assert "The books differ" in response["answer"]
    assert response["model"] == "google/gemma-4-26b-a4b-it:free"
    assert response["usage"]["input_tokens"] == 900


# Test 3: provider selection from the environment
def test_default_provider_from_environment():
    openrouter = llm.default_provider({"OPENROUTER_API_KEY": "k", "OPENROUTER_MODEL": "some/model:free",
                                       "OPENROUTER_FALLBACK_MODELS": "a/b:free, c/d:free"})
    assert isinstance(openrouter, llm.OpenRouterProvider)
    assert openrouter.model == "some/model:free"
    assert openrouter.fallbacks == ("a/b:free", "c/d:free")

    assert isinstance(llm.default_provider({}), llm.AnthropicProvider)
    assert isinstance(llm.default_provider({"OPENROUTER_API_KEY": "k", "LLM_PROVIDER": "anthropic"}), llm.AnthropicProvider)
    no_fallbacks = llm.default_provider({"OPENROUTER_API_KEY": "k", "OPENROUTER_FALLBACK_MODELS": ""})
    assert no_fallbacks.fallbacks == ()
    with pytest.raises(ValueError):
        llm.default_provider({"LLM_PROVIDER": "nope"})


def test_describe_never_reveals_the_key():
    info = llm.describe({"OPENROUTER_API_KEY": "sk-or-secret"})

    assert info["provider"] == "openrouter"
    assert info["key_set"] is True
    assert "sk-or-secret" not in json.dumps(info)


def test_unknown_provider_is_a_service_error(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "nope")

    assert generate_answer("When can I bathe my baby?", [BATH]).error == "service_error"


# Test 4: conversation context and relevance scores
def test_earlier_questions_are_context_only():
    fake = FakeOpenRouter(completion(answer_json([("Bathe at about ten days old.", ["S1"])])))

    generate_answer("And how warm should it be?", [BATH], client=provider(fake),
                    earlier_questions=["When can I give a <b>bath</b>?", "  "])

    user = fake.requests[0]["payload"]["messages"][1]["content"]
    assert "<earlier_questions>\n- When can I give a &lt;b&gt;bath&lt;/b&gt;?\n</earlier_questions>" in user
    assert user.index("<earlier_questions>") < user.index("<question>")
    assert "<question>\nAnd how warm should it be?\n</question>" in user


def test_no_earlier_questions_block_by_default():
    fake = FakeOpenRouter(completion(answer_json([("Bathe at about ten days old.", ["S1"])])))

    generate_answer("When can I bathe my baby?", [BATH], client=provider(fake))

    assert "<earlier_questions>" not in fake.requests[0]["payload"]["messages"][1]["content"]


def test_citations_carry_relevance_score_and_source():
    fake = FakeOpenRouter(completion(answer_json([("Bathe at about ten days old.", ["S1"])])))

    response = generation.to_api_response(generate_answer("When can I bathe my baby?", [BATH], client=provider(fake)))

    citation = response["citations"][0]
    assert citation["score"] == 0.8  # BATH has distance 0.2
    assert citation["source"] == "library"
    # The distance is internal: not shown to the model
    assert "distance" not in fake.requests[0]["payload"]["messages"][1]["content"]


def test_insufficient_answers_cost_nothing():
    result = generate_answer("Best car seat?", [], client=provider(FakeOpenRouter()))

    assert result.answer == INSUFFICIENT_MESSAGE
    assert result.usage == {"input_tokens": 0, "output_tokens": 0}


@pytest.mark.parametrize(
    "text, expected",
    [
        ('{"a": 1}', '{"a": 1}'),
        ('```json\n{"a": 1}\n```', '{"a": 1}'),
        ('Sure! {"a": {"b": 2}} Hope that helps.', '{"a": {"b": 2}}'),
        ("no json here", "no json here"),
        (None, None),
    ],
)
def test_extract_json(text, expected):
    assert generation.extract_json(text) == expected

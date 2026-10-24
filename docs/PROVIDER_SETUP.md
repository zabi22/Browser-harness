# Provider setup

Configure the app's Supabase project and server encryption secret as described in [DEPLOYMENT.md](DEPLOYMENT.md). Settings → AI Providers lists connections and lets the owner save/replace/delete encrypted credentials and test authenticated model listing. A successful listing is not a successful inference test.

| Provider          | Routing                                                     | Status                                                                                  |
| ----------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| OpenAI            | Fixed `https://api.openai.com/v1`, Responses for chat       | Existing adapter retained; live inference untested here                                 |
| Anthropic         | Fixed `https://api.anthropic.com/v1`, native Messages       | Existing adapter retained; live inference untested here                                 |
| Google Gemini     | Fixed Google compatible chat endpoint; native model listing | Existing adapter retained; live inference untested here                                 |
| OpenRouter        | Fixed `https://openrouter.ai/api/v1`                        | Separate saved key and backend dynamic metadata discovery added                         |
| Ollama Cloud      | Fixed `https://ollama.com/v1`                               | Separate hosted account/key; actual account quotas apply; live access untested          |
| Ollama Local      | User's own loopback instance                                | Address/metadata helpers only; local inference transport and setup UI are still missing |
| Custom compatible | Exact server operator allowlist                             | Existing `custom` key IDs preserved; arbitrary destinations and redirects rejected      |

`POST /api/providers` requires the owner's bearer session and accepts `{ "provider": "openrouter", "action": "models" }` or `action: "test"`. It does not generate tokens. Models/prices/capabilities are parsed from live metadata when a configured user invokes it. A `:free` suffix alone does not establish zero cost; pricing must be known and zero. No free-to-paid fallback was added. Full searchable/favorite/default model picker integration and reliable usage/cost display remain incomplete.

Connection deletion removes the app's saved copy; revoke the key with the provider when external revocation is required. New encrypted writes are bound to user/provider and carry a key version. Keep the matching previous secret ring until every old row/backup can be decrypted or has been safely re-encrypted. The session-only server header path exists, but its complete client credential lifecycle is not finished.

The legacy public gateway is separate and uses hashed app API keys. Its 429/5xx/network fallback semantics are preserved. Do not configure unrestricted sponsored inference until durable authentication, quotas, concurrency/spending limits and a shutdown switch are verified.

No live provider test passed in this session: there were no provider credentials used and no billable inference calls. The local Browser QA pairing token is unrelated to AI provider credentials and never travels through the chat API.

Official protocol references consulted: [OpenAI streaming](https://developers.openai.com/api/docs/guides/streaming-responses), [OpenRouter models](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties), [Ollama compatibility](https://docs.ollama.com/api/openai-compatibility). These document wire protocols; they do not certify this deployment's account access.

// Cloudflare Worker — CV Maker via Workers AI REST API (robust JSON)
// Requires:
//   CF_ACCOUNT_ID  (Text)
//   CF_API_TOKEN   (Secret, Account → Workers AI → Read)

const MODEL = "@cf/meta/llama-3-8b-instruct";

// ---------- CORS ----------
function corsHeadersFor(origin) {
  const ALLOWED = new Set(["https://arrafahvg.github.io"]);
  const allowOrigin = ALLOWED.has(origin) ? origin : "https://arrafahvg.github.io";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin",
  };
}

// ---------- Prompt Builder ----------
function buildPrompt(inputs, lang) {
  const language = lang === "en" ? "English" : "Indonesian";
  return `
You are an expert CV writer. Your ONLY output must be ONE valid JSON object (no code fences, no surrounding quotes, no markdown, no comments).

SCHEMA (fill only useful fields):
{
  "header": { "full_name": "", "title": "", "location": "", "email": "", "phone": "", "links": [] },
  "summary": "",
  "skills": { "core": [], "tools": [], "languages": [] },
  "experience": [
    {
      "company": "", "role": "", "location": "", "employment_type": "",
      "start_date": "MMM YYYY", "end_date": "MMM YYYY or Present",
      "bullets": ["", ""]
    }
  ],
  "education": [
    { "degree": "", "school": "", "location": "", "start_date": "", "end_date": "" }
  ],
  "certifications": [],
  "extras": []
}

STYLE GUIDELINES:
- Language: ${language}.
- Bullet points start with strong verbs, quantify impact where possible.
- Present tense for current role; past tense for previous roles.
- No emojis. No decorative characters.

RAW_CV:
${inputs}

REMINDERS:
- Output must be a single, minified JSON object.
- Do NOT wrap the JSON in quotes or code fences.
- Do NOT escape quotes.
`.trim();
}

// ---------- JSON helpers ----------
function stripCodeFences(s) {
  return String(s).replace(/```[\s\S]*?```/g, "").trim();
}
function extractJsonString(raw) {
  const stripped = stripCodeFences(raw);
  const a = stripped.indexOf("{");
  const b = stripped.lastIndexOf("}");
  return (a >= 0 && b > a) ? stripped.slice(a, b + 1) : stripped;
}
function tryParse(s) {
  try { return { ok: true, value: JSON.parse(s) }; }
  catch (e) { return { ok: false, err: e }; }
}
// Heuristic repair for common LLM formatting issues
function coerceJson(raw) {
  // 1) try direct
  let jsonStr = extractJsonString(raw);
  let p = tryParse(jsonStr);
  if (p.ok) return p.value;

  // 2) if the extracted block itself is a quoted JSON string, parse twice
  // e.g. "{\"header\":{\"full_name\":\"...\"}}"
  const q = tryParse(jsonStr);
  if (!q.ok && /^"\{[\s\S]*\}"$/.test(jsonStr)) {
    const inner = JSON.parse(jsonStr);         // remove outer quotes
    const p2 = tryParse(inner); if (p2.ok) return p2.value;
  }

  // 3) unescape common sequences then retry
  const unescaped = jsonStr
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .replace(/,\s*([}\]])/g, "$1"); // trailing commas
  const p3 = tryParse(unescaped);
  if (p3.ok) return p3.value;

  // 4) last attempt: remove invisible chars and retry
  const cleaned = unescaped.replace(/[\u0000-\u001f\u007f\u200b\u200e\u200f]/g, "");
  const p4 = tryParse(cleaned);
  if (p4.ok) return p4.value;

  // give up: return null so caller can raise a helpful error
  return null;
}

// ---------- Worker ----------
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeadersFor(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Max-Age": "86400" } });
    }

    // Debug route
    if (request.method === "GET") {
      const url = new URL(request.url);
      if (url.searchParams.get("debug") === "1") {
        const haveId = !!env.CF_ACCOUNT_ID, haveTok = !!env.CF_API_TOKEN;
        let test = null;
        if (haveId && haveTok) {
          try {
            const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/${MODEL}`, {
              method: "POST",
              headers: { "Authorization": `Bearer ${env.CF_API_TOKEN}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                messages: [
                  { role: "system", content: "Reply with exactly: ok" },
                  { role: "user", content: "say ok" }
                ],
                max_tokens: 8, temperature: 0.2
              })
            });
            const data = await res.json().catch(() => ({}));
            test = { status: res.status, ok: res.ok, snippet: JSON.stringify(data).slice(0, 160) };
          } catch (e) { test = { error: String(e?.message || e) }; }
        }
        return new Response(JSON.stringify({ ok: true, model: MODEL, account_id_present: haveId, token_present: haveTok, test }, null, 2), {
          headers: { "Content-Type": "application/json", ...cors }
        });
      }
      return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json", ...cors } });
    }

    // POST /generate
    try {
      if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) {
        return new Response(JSON.stringify({ error: "Missing CF_ACCOUNT_ID or CF_API_TOKEN in Worker settings." }), {
          status: 500, headers: { "Content-Type": "application/json", ...cors }
        });
      }

      const { inputs, lang = "id" } = await request.json();

      const aiUrl = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/${MODEL}`;
      const body = {
        messages: [
          { role: "system", content: "Only output one valid JSON object. No explanations or code fences." },
          { role: "user", content: buildPrompt(inputs, lang) }
        ],
        // Some models honor this OpenAI-style hint:
        response_format: { type: "json_object" },
        max_tokens: 900,
        temperature: 0.2
      };

      const res = await fetch(aiUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.CF_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return new Response(JSON.stringify({ error: data || "Workers AI request failed" }), {
          status: res.status, headers: { "Content-Type": "application/json", ...cors }
        });
      }

      const raw = data?.result?.response ?? data?.result ?? "";
      const repaired = coerceJson(raw);

      if (!repaired) {
        // send helpful preview so UI can show details
        return new Response(JSON.stringify({
          error: "Model did not return valid JSON.",
          preview: String(raw).slice(0, 1000)
        }), { status: 502, headers: { "Content-Type": "application/json", ...cors } });
      }

      return new Response(JSON.stringify(repaired), {
        headers: { "Content-Type": "application/json", ...cors }
      });

    } catch (e) {
      return new Response(JSON.stringify({ error: String(e?.message || e) }), {
        status: 500, headers: { "Content-Type": "application/json", ...cors }
      });
    }
  }
};

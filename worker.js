// Cloudflare Worker — CV Maker via Workers AI REST API
// Requires two runtime values set in the Worker Settings:
//   Text Variable:  CF_ACCOUNT_ID           (e.g., "9165a339e9b5eb55e7727366085e7f60")
//   Secret:         CF_API_TOKEN            (token with Account → Workers AI → Read)
// Model we’ll use:
const MODEL = "@cf/meta/llama-3-8b-instruct";

// ---------- CORS ----------
function corsHeadersFor(origin) {
  // ✅ Allow only your real site
  const ALLOWED = new Set(["https://arrafahvg.github.io"]);

  // If the origin matches, allow it; otherwise, fall back to your site
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
You are an expert CV writer. Rewrite the following raw CV info into a clean, ATS-optimized ${language} resume.

STRICT RULES:
- Respond with JSON ONLY (no markdown, no code fences, no commentary).
- Use this exact schema and fill only useful fields:

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

Content rules:
- Bullet points start with strong verbs and are concise.
- Present tense for current role; past tense for previous roles.
- Remove duplicates, fix grammar, quantify impact where possible.
- No emojis or decorative characters.

RAW_CV:
${inputs}
`.trim();
}

// ---------- Extract JSON-only from any text ----------
function extractJsonString(raw) {
  const stripped = String(raw || "").replace(/```[\s\S]*?```/g, "").trim();
  const a = stripped.indexOf("{");
  const b = stripped.lastIndexOf("}");
  return (a >= 0 && b > a) ? stripped.slice(a, b + 1) : stripped;
}

// ---------- Worker ----------
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeadersFor(origin);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Max-Age": "86400" } });
    }

    // --- Debug / health check ---
    if (request.method === "GET") {
      const url = new URL(request.url);
      if (url.searchParams.get("debug") === "1") {
        const haveId = !!env.CF_ACCOUNT_ID;
        const haveToken = !!env.CF_API_TOKEN;
        // Optional tiny test call (only if both present)
        let test = null;
        if (haveId && haveToken) {
          try {
            const res = await fetch(
              `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/${MODEL}`,
              {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${env.CF_API_TOKEN}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  messages: [
                    { role: "system", content: "Reply with exactly: ok" },
                    { role: "user", content: "say ok" },
                  ],
                  max_tokens: 8,
                  temperature: 0.2
                })
              }
            );
            const data = await res.json().catch(() => ({}));
            test = {
              status: res.status,
              ok: res.ok,
              snippet: JSON.stringify(data)?.slice(0, 160)
            };
          } catch (e) {
            test = { error: String(e?.message || e) };
          }
        }
        return new Response(JSON.stringify({
          ok: true,
          model: MODEL,
          account_id_present: haveId,
          token_present: haveToken,
          test
        }, null, 2), { headers: { "Content-Type": "application/json", ...cors } });
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json", ...cors }
      });
    }

    // --- Main POST /generate ---
    try {
      if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) {
        return new Response(JSON.stringify({
          error: "Missing CF_ACCOUNT_ID or CF_API_TOKEN in Worker settings."
        }), { status: 500, headers: { "Content-Type": "application/json", ...cors } });
      }

      const { inputs, lang = "id" } = await request.json();

      const aiUrl = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/${MODEL}`;
      const body = {
        messages: [
          { role: "system", content: "You are a strict JSON-only resume generator. Do not add any commentary." },
          { role: "user", content: buildPrompt(inputs, lang) }
        ],
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
      const jsonStr = extractJsonString(raw);
      let json;
      try {
        json = JSON.parse(jsonStr);
      } catch {
        return new Response(JSON.stringify({
          error: "Model did not return valid JSON.",
          preview: String(raw).slice(0, 500)
        }), { status: 502, headers: { "Content-Type": "application/json", ...cors } });
      }

      return new Response(JSON.stringify(json), {
        headers: { "Content-Type": "application/json", ...cors }
      });

    } catch (e) {
      return new Response(JSON.stringify({ error: String(e?.message || e) }), {
        status: 500, headers: { "Content-Type": "application/json", ...cors }
      });
    }
  }
};

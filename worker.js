// Cloudflare Worker — CV Maker via Workers AI REST API (robust JSON)
// Vars (Worker Settings):
//   Text Variable:  CF_ACCOUNT_ID  (e.g. "9165a339e9b5eb55e7727366085e7f60")
//   Secret:         CF_API_TOKEN   (Account → Workers AI → Read)
const MODEL = "@cf/meta/llama-3-8b-instruct";

// ---------- CORS ----------
function corsHeadersFor(origin) {
  // Allow ONLY your GitHub Pages origin
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

STYLE:
- Language: ${language}.
- Bullet points start with strong verbs; quantify impact where possible.
- Present tense for current role; past tense for previous roles.
- No emojis. No decorative characters.

RAW_CV:
${inputs}

REMINDERS:
- Output a single *minified* JSON object.
- Do NOT wrap the JSON in quotes or code fences.
- Do NOT escape quotes.
`.trim();
}

// ---------- JSON helpers ----------
function stripCodeFences(s) {
  return String(s).replace(/```[\s\S]*?```/g, "").trim();
}
function tryParseJSON(s) {
  try { return { ok: true, val: JSON.parse(s) }; }
  catch (e) { return { ok: false, err: e }; }
}
// Force a real JS object from any model output
function forceJson(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();

  // 0) remove code fences if any
  s = stripCodeFences(s);

  // 1) try direct parse
  let p = tryParseJSON(s);
  if (p.ok) {
    // sometimes the model returns a *string* that itself is JSON
    if (typeof p.val === "string") {
      const p2 = tryParseJSON(p.val);
      if (p2.ok && typeof p2.val === "object") return p2.val;
    }
    if (typeof p.val === "object") return p.val;
  }

  // 2) find the outermost {...} block
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a >= 0 && b > a) {
    let block = s.slice(a, b + 1);

    // 2a) parse block as-is
    p = tryParseJSON(block);
    if (p.ok) return p.val;

    // 2b) if escaped (\" \\n), unescape then parse
    const looksEscaped = /\\\"|\\n|\\\\/.test(block);
    if (looksEscaped) {
      const unescaped = block
        .replace(/\\\\/g, "\\")   // backslashes first
        .replace(/\\"/g, '"')
        .replace(/\\n/g, "\n")
        .replace(/,\s*([}\]])/g, "$1"); // trailing commas
      const p3 = tryParseJSON(unescaped);
      if (p3.ok) return p3.val;
    }
  }

  // 3) last attempt: strip invisible chars and retry
  const cleaned = s.replace(/[\u0000-\u001f\u007f\u200b\u200e\u200f]/g, "");
  p = tryParseJSON(cleaned);
  if (p.ok && typeof p.val === "object") return p.val;

  return null; // give up; caller handles fallback
}

// Minimal server-side fallback (guarantees a JSON payload)
function minimalFallback(inputs) {
  const txt = String(inputs || "");
  const lines = txt.split(/\r?\n/).map(t => t.trim()).filter(Boolean);
  const full_name = lines[0] || "Your Name";
  return {
    header: { full_name, title: "", location: "", email: "", phone: "", links: [] },
    summary: lines.slice(1, 4).join(" "),
    skills: { core: [], tools: [], languages: [] },
    experience: [],
    education: [],
    certifications: [],
    extras: []
  };
}

// ---------- Worker ----------
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeadersFor(origin);

    // Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Max-Age": "86400" } });
    }

    // Debug
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
          { role: "system", content: "Only output one valid JSON object. No explanations, no code fences, do not wrap in quotes." },
          { role: "user", content: buildPrompt(inputs, lang) }
        ],
        // Some models honor it; safe if ignored
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
      const parsed = forceJson(raw) || minimalFallback(inputs);

      return new Response(JSON.stringify(parsed), {
        headers: { "Content-Type": "application/json", ...cors }
      });

    } catch (e) {
      return new Response(JSON.stringify({ error: String(e?.message || e) }), {
        status: 500, headers: { "Content-Type": "application/json", ...cors }
      });
    }
  }
};

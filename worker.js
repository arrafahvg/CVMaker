// Cloudflare Worker — CV Maker via Workers AI REST API (robust JSON + retry)
// Vars (Worker Settings):
//   Text Variable:  CF_ACCOUNT_ID
//   Secret:         CF_API_TOKEN
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

// ---------- Prompt Builders ----------
function buildPrompt(inputs, lang) {
  const language = lang === "en" ? "English" : "Indonesian";
  const clean = String(inputs || "").replace(/\r/g, "").trim();
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
- No emojis or decorative characters.

RAW_CV:
${clean}

REMINDERS:
- Output a single *minified* JSON object.
- Do NOT wrap the JSON in quotes or code fences.
- Do NOT escape quotes.
`.trim();
}

function buildReformatPrompt(previousOutput) {
  // 2nd pass: tell the model to fix formatting and return bare JSON only
  const sample = String(previousOutput || "").slice(0, 4000);
  return `
You will receive a model output that is supposed to be a single JSON object but may contain quotes/escapes/markdown.
Return a SINGLE valid JSON object only. No code fences. No quotes around the object. No commentary.

OUTPUT_TO_FIX:
${sample}
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
function forceJson(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  s = stripCodeFences(s);

  // Try direct
  let p = tryParseJSON(s);
  if (p.ok) {
    if (typeof p.val === "string") {
      const p2 = tryParseJSON(p.val);
      if (p2.ok && typeof p2.val === "object") return p2.val;
    }
    if (typeof p.val === "object") return p.val;
  }

  // Try outermost {...}
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a >= 0 && b > a) {
    let block = s.slice(a, b + 1);

    // As-is
    p = tryParseJSON(block);
    if (p.ok) return p.val;

    // Unescape then parse
    const looksEscaped = /\\\"|\\n|\\\\/.test(block);
    if (looksEscaped) {
      const unescaped = block
        .replace(/\\\\/g, "\\")   // order matters
        .replace(/\\"/g, '"')
        .replace(/\\n/g, "\n")
        .replace(/,\s*([}\]])/g, "$1"); // trailing commas
      const p3 = tryParseJSON(unescaped);
      if (p3.ok) return p3.val;
    }
  }

  // Clean control chars and retry
  const cleaned = s.replace(/[\u0000-\u001f\u007f\u200b\u200e\u200f]/g, "");
  p = tryParseJSON(cleaned);
  if (p.ok && typeof p.val === "object") return p.val;

  return null;
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

// ---------- Call Workers AI ----------
async function callWorkersAI(env, payload) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/${MODEL}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.CF_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
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
          const { status, ok, data } = await callWorkersAI(env, {
            messages: [
              { role: "system", content: "Reply with exactly: ok" },
              { role: "user", content: "say ok" }
            ],
            max_tokens: 8,
            temperature: 0.1
          });
          test = { status, ok, snippet: JSON.stringify(data).slice(0, 160) };
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

      // ---- First attempt (full CV prompt) ----
      let resp1 = await callWorkersAI(env, {
        messages: [
          { role: "system", content: "Only output one valid JSON object. No explanations, code fences, or quotes around the object." },
          { role: "user", content: buildPrompt(inputs, lang) }
        ],
        response_format: { type: "json_object" }, // hint; ignored if unsupported
        max_tokens: 1200,
        temperature: 0.0
      });

      let raw1 = resp1.data?.result?.response ?? resp1.data?.result ?? "";
      let parsed = forceJson(raw1);

      // ---- Second attempt (reformat the first output) ----
      if (!parsed) {
        const resp2 = await callWorkersAI(env, {
          messages: [
            { role: "system", content: "Return a single valid JSON object only. No commentary, no code fences, no quotes around the object." },
            { role: "user", content: buildReformatPrompt(raw1 || "") }
          ],
          response_format: { type: "json_object" },
          max_tokens: 800,
          temperature: 0.0
        });
        const raw2 = resp2.data?.result?.response ?? resp2.data?.result ?? "";
        parsed = forceJson(raw2);
      }

      // ---- Last resort fallback ----
      if (!parsed) {
        parsed = minimalFallback(inputs);
      }

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

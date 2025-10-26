// Cloudflare Worker — CV Maker (Enhanced Experience Handling)
// Vars:
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

// ---------- Pre-clean and prompt ----------
function cleanText(raw) {
  return String(raw || "")
    .replace(/\r/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/·/g, "-")
    .replace(/\+?\d+\s*skills?/gi, "")
    .replace(/\b(Full-time|Hybrid|Remote|Freelance)\b/gi, "")
    .replace(/([A-Za-z])\1{2,}/g, "$1") // remove triple repeats
    .replace(/([A-Z][a-z]+)\s+\1/gi, "$1") // remove doubled words
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function buildPrompt(inputs, lang) {
  const language = lang === "en" ? "English" : "Indonesian";
  const cleaned = cleanText(inputs);
  return `
You are an expert CV writer. Rewrite the following raw CV info into a clean, ATS-optimized ${language} resume.

Focus on:
- Condensing redundant experience text.
- Merging repeated job titles or duplicated descriptions.
- Keeping clear bullet points with measurable impact.
- Using strong verbs and results.
- Preserving accurate chronology and company names.

STRICT RULES:
- Respond with JSON ONLY (no markdown, no commentary).
- Follow this schema exactly:

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

RAW_CV:
${cleaned}
`.trim();
}

// ---------- JSON helpers ----------
function tryParseJSON(s) {
  try { return JSON.parse(s); } catch { return null; }
}
function coerceJson(raw) {
  if (!raw) return null;
  let s = String(raw).trim().replace(/```[\s\S]*?```/g, "");
  let p = tryParseJSON(s);
  if (p && typeof p === "object") return p;
  if (/^"\{/.test(s)) {
    const inner = tryParseJSON(JSON.parse(s));
    if (inner) return inner;
  }
  s = s.replace(/\\n/g, "\n").replace(/\\"/g, '"');
  return tryParseJSON(s);
}
function fallback(inputs) {
  const txt = String(inputs || "");
  const lines = txt.split(/\r?\n/).filter(Boolean);
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

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Max-Age": "86400" } });
    }

    if (request.method === "GET") {
      return new Response(JSON.stringify({ ok: true, model: MODEL }), {
        headers: { "Content-Type": "application/json", ...cors },
      });
    }

    try {
      const { inputs, lang = "id" } = await request.json();
      const aiUrl = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/${MODEL}`;

      const body = {
        messages: [
          { role: "system", content: "You are a strict JSON-only resume generator." },
          { role: "user", content: buildPrompt(inputs, lang) }
        ],
        max_tokens: 1400,
        temperature: 0.3,
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
      const raw = data?.result?.response ?? data?.result ?? "";
      const parsed = coerceJson(raw) || fallback(inputs);

      return new Response(JSON.stringify(parsed), {
        headers: { "Content-Type": "application/json", ...cors },
      });

    } catch (e) {
      return new Response(JSON.stringify({ error: String(e?.message || e) }), {
        status: 500, headers: { "Content-Type": "application/json", ...cors }
      });
    }
  }
};

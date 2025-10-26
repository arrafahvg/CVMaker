// Cloudflare Worker — CV Maker (structured fields + robust JSON, tuned for speed)
// Vars in Worker Settings:
//   Text Variable:  CF_ACCOUNT_ID
//   Secret:         CF_API_TOKEN
const MODEL = "@cf/meta/llama-3-8b-instruct";

/* ------------------- CORS ------------------- */
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

/* ------------------- Helpers ------------------- */
const norm = (s) => (s ?? "").toString().trim();
const stripFences = (s) => (s || "").replace(/```[\s\S]*?```/g, "").trim();
const tryParseJSON = (s) => { try { return JSON.parse(s); } catch { return null; } };

// keep inputs modest to reduce model latency
const LIMIT_EXPERIENCE = 4000;    // was 12000
const LIMIT_EDUCATION  = 1500;
const LIMIT_SUMMARY    = 1000;
const LIMIT_SKILLS     = 800;

function cleanMultiline(s, limit) {
  return norm(s)
    .replace(/\r/g, "")
    .replace(/[•▪·]/g, "-")
    .replace(/\s{2,}/g, " ")
    .replace(/\n{2,}/g, "\n")
    .slice(0, limit);
}

function coerceJson(raw) {
  if (!raw) return null;
  let s = stripFences(String(raw).trim());

  // direct
  let j = tryParseJSON(s);
  if (j && typeof j === "object") return j;

  // quoted JSON object
  if (/^"\{/.test(s)) {
    const inner = tryParseJSON(JSON.parse(s));
    if (inner && typeof inner === "object") return inner;
  }

  // unescape then parse
  s = s
    .replace(/\\\\/g, "\\")
    .replace(/\\"/g, '"')
    .replace(/\\n/g, "\n")
    .replace(/,\s*([}\]])/g, "$1");
  j = tryParseJSON(s);
  if (j && typeof j === "object") return j;

  // outermost block
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a >= 0 && b > a) {
    const block = s.slice(a, b + 1);
    const j2 = tryParseJSON(block);
    if (j2 && typeof j2 === "object") return j2;
  }
  return null;
}

function minimalFallback(fields) {
  const full_name = [norm(fields.firstName), norm(fields.lastName)].filter(Boolean).join(" ") || "Your Name";
  return {
    header: {
      full_name,
      title: "",
      location: [norm(fields.city), norm(fields.province)].filter(Boolean).join(", "),
      email: norm(fields.email),
      phone: norm(fields.phone),
      links: []
    },
    summary: norm(fields.summary) || "Professional with experience. Replace this with your achievements.",
    skills: { core: [], tools: [], languages: [] },
    experience: [],
    education: [],
    certifications: [],
    extras: []
  };
}

/* ------------------- Prompt ------------------- */
function buildPromptFromFields(fields, lang) {
  const language = lang === "en" ? "English" : "Indonesian";

  const headerBlock = `
Full Name: ${[norm(fields.firstName), norm(fields.lastName)].filter(Boolean).join(" ")}
Title (if any): ${norm(fields.title || "")}
Location: ${[norm(fields.city), norm(fields.province)].filter(Boolean).join(", ")}
Email: ${norm(fields.email)}
Phone: ${norm(fields.phone)}
Links: ${norm(fields.links || "")}
`.trim();

  const skillsBlock     = cleanMultiline(fields.skills || "",     LIMIT_SKILLS);
  const experienceBlock = cleanMultiline(fields.experience || "", LIMIT_EXPERIENCE);
  const educationBlock  = cleanMultiline(fields.education || "",  LIMIT_EDUCATION);
  const summaryBlock    = cleanMultiline(fields.summary || "",    LIMIT_SUMMARY);

  return `
You are an expert CV writer. Your ONLY output must be ONE valid JSON object (no code fences, no quotes around the object, no markdown).

Language: ${language}.

Schema (fill only useful fields exactly as keys below):
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

Rules:
- Condense and de-duplicate experience text; use 3–6 strong, results-oriented bullets per role.
- Use present tense for current roles; past tense for previous roles.
- No emojis or decorative characters.
- Output must be a single minified JSON object.

DATA:
[HEADER]
${headerBlock}

[SKILLS]
${skillsBlock}

[EXPERIENCE]
${experienceBlock}

[EDUCATION]
${educationBlock}

[SUMMARY]
${summaryBlock}
`.trim();
}

/* ------------------- CF Workers AI ------------------- */
async function runModel(env, content, { maxTokens = 900, temperature = 0.1 } = {}) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/${MODEL}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.CF_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages: [
        { role: "system", content: "Only output one valid JSON object. No explanations, no code fences, no quotes around the object." },
        { role: "user", content }
      ],
      response_format: { type: "json_object" }, // hint; safe if ignored
      max_tokens: maxTokens,
      temperature
    }),
  });
  const text = await res.text().catch(() => "");
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data, text };
}

/* ------------------- Worker ------------------- */
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeadersFor(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Max-Age": "86400" } });
    }

    if (request.method === "GET") {
      return new Response(JSON.stringify({ ok: true, model: MODEL }), {
        headers: { "Content-Type": "application/json", ...cors }
      });
    }

    // POST /generate
    try {
      if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) {
        return new Response(JSON.stringify({ error: "Missing CF_ACCOUNT_ID or CF_API_TOKEN in Worker settings." }), {
          status: 500, headers: { "Content-Type": "application/json", ...cors }
        });
      }

      const { inputs, lang = "id" } = await request.json();

      // Ensure we have the structured fields we expect
      const fields = {
        firstName: norm(inputs?.firstName),
        lastName: norm(inputs?.lastName),
        email: norm(inputs?.email),
        phone: norm(inputs?.phone),
        city: norm(inputs?.city),
        province: norm(inputs?.province),
        title: norm(inputs?.title),
        links: norm(inputs?.links),
        skills: norm(inputs?.skills),
        experience: norm(inputs?.experience),
        education: norm(inputs?.education),
        summary: norm(inputs?.summary)
      };

      const prompt = buildPromptFromFields(fields, lang);

      // First attempt (fast settings)
      const r1 = await runModel(env, prompt, { maxTokens: 900, temperature: 0.1 });
      if (!r1.ok) {
        return new Response(JSON.stringify({ error: `Workers AI failed`, detail: r1.data || r1.text }), {
          status: r1.status, headers: { "Content-Type": "application/json", ...cors }
        });
      }
      const raw1 = r1.data?.result?.response ?? r1.data?.result ?? r1.text ?? "";
      let json = coerceJson(raw1);

      // Second attempt: reformat to clean JSON (also fast settings)
      if (!json) {
        const fixPrompt = `
You will receive a supposed JSON resume but it may be quoted or escaped.
Return only a SINGLE valid JSON object, minified, matching the schema.
OUTPUT:
${(raw1 || "").toString().slice(0, 4000)}
`.trim();
        const r2 = await runModel(env, fixPrompt, { maxTokens: 700, temperature: 0.0 });
        const raw2 = r2.data?.result?.response ?? r2.data?.result ?? r2.text ?? "";
        json = coerceJson(raw2);
      }

      if (!json) json = minimalFallback(fields);

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

// Cloudflare Worker — CV Maker (enforce sections when provided)
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

const LIMIT_EXPERIENCE = 4000;
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

  let j = tryParseJSON(s);
  if (j && typeof j === "object") return j;

  if (/^"\{/.test(s)) {
    const inner = tryParseJSON(JSON.parse(s));
    if (inner && typeof inner === "object") return inner;
  }

  s = s.replace(/\\\\/g, "\\").replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/,\s*([}\]])/g, "$1");
  j = tryParseJSON(s);
  if (j && typeof j === "object") return j;

  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a >= 0 && b > a) {
    const j2 = tryParseJSON(s.slice(a, b + 1));
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

  const haveSkills = skillsBlock.length > 0;
  const haveExp    = experienceBlock.length > 0;
  const haveEdu    = educationBlock.length > 0;

  return `
You are an expert CV writer. Your ONLY output must be ONE valid JSON object (no code fences, no quotes around the object, no markdown).

Language: ${language}.

Schema (use exactly these keys):
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

Hard requirements (must follow):
- Use the exact full name from [HEADER]; never invent a different person.
- If [SKILLS] is not empty: split by comma/semicolon and place into skills.core (3–12 items). Keep tools/languages empty unless clearly stated.
- If [EXPERIENCE] is not empty: create at least ONE role with 3–6 strong bullets. Derive company, role, location, employment_type, and dates when available. If a date is unclear, estimate the month (e.g., "Jan 2024") or leave blank—do NOT drop the role.
- Bullets must be results-focused (owning verbs like Led, Built, Improved, Reduced, Increased, Delivered) and should compress duplicates.
- If [EDUCATION] is not empty: create at least ONE entry with degree/school and years if present.
- Output must be ONE minified JSON object. No markdown, no commentary.

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
async function runModel(env, content, { maxTokens = 1000, temperature = 0.2 } = {}) {
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

    try {
      if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) {
        return new Response(JSON.stringify({ error: "Missing CF_ACCOUNT_ID or CF_API_TOKEN in Worker settings." }), {
          status: 500, headers: { "Content-Type": "application/json", ...cors }
        });
      }

      const { inputs, lang = "id" } = await request.json();

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

      // First attempt
      const r1 = await runModel(env, prompt, { maxTokens: 1000, temperature: 0.15 });
      if (!r1.ok) {
        return new Response(JSON.stringify({ error: `Workers AI failed`, detail: r1.data || r1.text }), {
          status: r1.status, headers: { "Content-Type": "application/json", ...cors }
        });
      }
      const raw1 = r1.data?.result?.response ?? r1.data?.result ?? r1.text ?? "";
      let json = coerceJson(raw1);

      // Second attempt: force reformat to pure JSON
      if (!json) {
        const fixPrompt = `
Return only a SINGLE valid JSON object (minified) that matches the required schema.
If the text below is quoted or escaped, unescape and fix it to strict JSON. No commentary.

TEXT:
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

function getFormText(formEl) {
  const fd = new FormData(formEl);
  return Array.from(fd.values()).map(v => (v || "").toString().trim()).filter(Boolean).join("\n");
}

async function callAI(combinedText, lang, { signal } = {}) {
// ✅ use your real Worker URL
const WORKER_URL = "https://cv-maker.arrafahvega.workers.dev/generate";

const res = await fetch(WORKER_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ inputs: combinedText, lang }),
  signal
});

if (!res.ok) throw new Error(`AI HTTP ${res.status}: ${await res.text()}`);
return await res.json();

// Very simple fallback formatter if AI fails
function fallbackJson(combinedText) {
  const lines = combinedText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const header = { full_name: lines[0] || "Your Name", title: "", location: "", email: "", phone: "", links: [] };
  // naive grouping
  const summary = lines.slice(1, 6).join(" ");
  const rest = lines.slice(6);
  const bullets = rest.slice(0, 6).map(s => s.replace(/^[-•]\s*/, ""));

  return {
    header,
    summary: summary || "Professional with experience in the field. Replace this summary with your achievements.",
    skills: { core: [], tools: [], languages: [] },
    experience: bullets.length ? [{
      company: "", role: "", location: "", employment_type: "",
      start_date: "", end_date: "Present",
      bullets
    }] : [],
    education: [],
    certifications: [],
    extras: []
  };
}

function renderPdfFromJson(json) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const left = 10, right = 200 - 10, width = right - left;

  // Header
  doc.setFont("Helvetica", "bold"); doc.setFontSize(18);
  doc.text(json.header?.full_name || "Name", left, 15);
  doc.setFont("Helvetica", "normal"); doc.setFontSize(11);
  const titleLine = [json.header?.title, json.header?.location].filter(Boolean).join(" • ");
  if (titleLine) doc.text(titleLine, left, 21);
  const contact = [json.header?.email, json.header?.phone, ...(json.header?.links || [])].filter(Boolean).join("  |  ");
  if (contact) doc.text(contact, left, 27);

  function section(title, y) {
    doc.setFont("Helvetica", "bold"); doc.setFontSize(13);
    doc.text(title, left, y);
    doc.setDrawColor(0); doc.setLineWidth(0.3);
    doc.line(left, y + 2, right, y + 2);
    return y + 8;
  }

  let y = 35;

  if (json.summary) {
    y = section("Professional Summary", y);
    doc.setFont("Helvetica", "normal"); doc.setFontSize(11);
    doc.splitTextToSize(json.summary, width).forEach((ln) => { doc.text(ln, left, y); y += 6; });
    y += 2;
  }

  const allSkills = [...(json.skills?.core || []), ...(json.skills?.tools || []), ...(json.skills?.languages || [])];
  if (allSkills.length) {
    y = section("Skills", y);
    doc.splitTextToSize(allSkills.join(" • "), width).forEach((ln) => { doc.text(ln, left, y); y += 6; });
    y += 2;
  }

  if (Array.isArray(json.experience) && json.experience.length) {
    y = section("Experience", y);
    json.experience.forEach((xp) => {
      doc.setFont("Helvetica", "bold"); doc.setFontSize(11);
      const headline = [xp.role, xp.company].filter(Boolean).join(" — ") || "Experience";
      doc.text(headline, left, y);
      doc.setFont("Helvetica", "normal");
      const sub = [xp.location, xp.employment_type, [xp.start_date, xp.end_date].filter(Boolean).join(" – ")].filter(Boolean).join(" • ");
      y += 6; if (sub) doc.text(sub, left, y); y += 2;

      (xp.bullets || []).filter(Boolean).forEach(b => {
        doc.splitTextToSize(`• ${b}`, width).forEach(ln => { y += 6; doc.text(ln, left, y); });
      });
      y += 8;
      if (y > 275) { doc.addPage(); y = 15; }
    });
  }

  if (Array.isArray(json.education) && json.education.length) {
    y = section("Education", y);
    json.education.forEach(ed => {
      doc.setFont("Helvetica", "bold"); doc.setFontSize(11);
      doc.text([ed.degree, ed.school].filter(Boolean).join(" — "), left, y);
      doc.setFont("Helvetica", "normal");
      y += 6; doc.text([ed.location, [ed.start_date, ed.end_date].filter(Boolean).join(" – ")].filter(Boolean).join(" • "), left, y);
      y += 8;
      if (y > 275) { doc.addPage(); y = 15; }
    });
  }

  if (Array.isArray(json.certifications) && json.certifications.length) {
    y = section("Certifications", y);
    json.certifications.forEach(c => { doc.text(`• ${c}`, left, y); y += 6; });
  }

  doc.save("ATS_CV.pdf");
}

document.getElementById("generateBtn").addEventListener("click", async () => {
  const btn = document.getElementById("generateBtn");
  const form = document.getElementById("cvForm");
  const lang = document.getElementById("language")?.value === "en" ? "en" : "id";
  const original = btn.textContent;

  btn.disabled = true; btn.textContent = "Processing...";
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort("timeout"), 20000);

  const combined = getFormText(form);

  try {
    let json;
    try {
      json = await callAI(combined, lang, { signal: controller.signal });
    } catch (aiErr) {
      console.error(aiErr);
      // Show exact server error, but STILL produce a PDF using fallback
      alert(`AI gagal memproses.\nDetail: ${aiErr.message.slice(0, 300)}`);
      json = fallbackJson(combined);
    }
    renderPdfFromJson(json);
    document.getElementById("downloadSection")?.classList?.remove("hidden");
  } finally {
    clearTimeout(t);
    btn.disabled = false; btn.textContent = original;
  }
});

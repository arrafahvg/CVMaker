// FRONTEND — send structured fields to Worker and render the returned JSON

// 1) Make sure this URL is correct:
const WORKER_URL = "https://cv-maker.arrafahvega.workers.dev/generate";

// Helper: read the form into a structured object the Worker expects
function getFields() {
  const f = document.getElementById("cvForm");
  const fd = new FormData(f);
  const g = (name) => (fd.get(name) || "").toString().trim();

  // IMPORTANT: these names MUST match your <input name="..."> in index.html
  // From your page they are: nama_depan, nama_belakang, email, telepon,
  // kota, provinsi, keahlian, pengalaman, pendidikan, profil
  const fields = {
    firstName: g("nama_depan"),
    lastName: g("nama_belakang"),
    email: g("email"),
    phone: g("telepon"),
    city: g("kota"),
    province: g("provinsi"),
    title: "",   // optional; keep empty unless you add a field
    links: "",   // optional; keep empty unless you add a field
    skills: g("keahlian"),
    experience: g("pengalaman"),
    education: g("pendidikan"),
    summary: g("profil")
  };

  // helpful log so you can verify what will be sent
  console.log("CV payload (inputs):", fields);
  return fields;
}

async function callAI(fields, lang, { signal } = {}) {
  const res = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inputs: fields, lang }),
    signal
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`AI HTTP ${res.status}: ${text || res.statusText}`);
  }
  return await res.json();
}

// === PDF rendering (kept same as before) ===
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
  const contact = [json.header?.email, json.header?.phone, ...(json.header?.links || [])]
    .filter(Boolean).join("  |  ");
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

// Button handler
document.getElementById("generateBtn").addEventListener("click", async () => {
  const btn = document.getElementById("generateBtn");
  const lang = document.getElementById("language")?.value === "en" ? "en" : "id";
  const original = btn.textContent;

  btn.disabled = true; btn.textContent = "Processing...";
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort("timeout"), 45000);

  try {
    const fields = getFields();                      // <- structured object
    const json = await callAI(fields, lang, { signal: controller.signal });
    renderPdfFromJson(json);
    document.getElementById("downloadSection")?.classList?.remove("hidden");
  } catch (err) {
    console.error(err);
    alert(`AI gagal memproses.\nDetail: ${String(err.message).slice(0, 400)}`);
  } finally {
    clearTimeout(t);
    btn.disabled = false; btn.textContent = original;
  }
});

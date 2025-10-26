async function callAI(combinedText, lang, { signal } = {}) {
  const res = await fetch("https://cv-maker.arrafahvega.workers.dev/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inputs: combinedText, lang }),
    signal
  });
  if (!res.ok) {
    throw new Error(`AI HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  }
  return await res.json(); // should be the JSON schema we requested
}

function getFormText(formEl) {
  const fd = new FormData(formEl);
  return Array.from(fd.values())
    .map(v => (v || "").toString().trim())
    .filter(Boolean)
    .join("\n");
}

// Render ATS CV from JSON
function renderPdfFromJson(json) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  // Layout settings
  const left = 10, right = 200 - 10, width = right - left, lineTop = 18;

  // Header
  doc.setFont("Helvetica", "bold"); doc.setFontSize(18);
  doc.text(json.header?.full_name || "Name", left, 15);
  doc.setFont("Helvetica", "normal"); doc.setFontSize(11);
  const titleLine = [json.header?.title, json.header?.location].filter(Boolean).join(" • ");
  doc.text(titleLine || "", left, lineTop);
  const contact = [json.header?.email, json.header?.phone, ...(json.header?.links || [])]
    .filter(Boolean).join("  |  ");
  doc.text(contact || "", left, lineTop + 6);

  // Section helper
  function section(title, y) {
    doc.setFont("Helvetica", "bold"); doc.setFontSize(13);
    doc.text(title, left, y);
    doc.setDrawColor(0); doc.setLineWidth(0.3);
    doc.line(left, y + 2, right, y + 2);
    return y + 8;
  }

  let y = lineTop + 16;

  // Summary
  if (json.summary) {
    y = section("Professional Summary", y);
    doc.setFont("Helvetica", "normal"); doc.setFontSize(11);
    const lines = doc.splitTextToSize(json.summary, width);
    lines.forEach((ln) => { doc.text(ln, left, y); y += 6; });
    y += 2;
  }

  // Skills
  const allSkills = [
    ...(json.skills?.core || []),
    ...(json.skills?.tools || []),
    ...(json.skills?.languages || [])
  ];
  if (allSkills.length) {
    y = section("Skills", y);
    const skillLine = allSkills.join(" • ");
    const lines = doc.splitTextToSize(skillLine, width);
    lines.forEach((ln) => { doc.text(ln, left, y); y += 6; });
    y += 2;
  }

  // Experience
  if (Array.isArray(json.experience) && json.experience.length) {
    y = section("Experience", y);
    json.experience.forEach((xp) => {
      // role @ company
      doc.setFont("Helvetica", "bold"); doc.setFontSize(11);
      const headline = [xp.role, xp.company].filter(Boolean).join(" — ");
      doc.text(headline, left, y);
      doc.setFont("Helvetica", "normal");
      const sub = [xp.location, xp.employment_type, [xp.start_date, xp.end_date].filter(Boolean).join(" – ")].filter(Boolean).join(" • ");
      y += 6; doc.text(sub, left, y); y += 4;

      // bullets
      const bullets = (xp.bullets || []).filter(Boolean);
      bullets.forEach(b => {
        const wrapped = doc.splitTextToSize(`• ${b}`, width);
        wrapped.forEach(ln => { y += 6; doc.text(ln, left, y); });
      });
      y += 8;

      // page break if near bottom
      if (y > 275) { doc.addPage(); y = 15; }
    });
  }

  // Education
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

  // Certifications
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

  // Busy UI + timeout
  btn.disabled = true; btn.textContent = "Processing...";
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort("timeout"), 20000);

  try {
    const combined = getFormText(form);
    const json = await callAI(combined, lang, { signal: controller.signal });
    renderPdfFromJson(json);
    document.getElementById("downloadSection")?.classList?.remove("hidden");
  } catch (e) {
    console.error(e);
    alert("AI gagal memproses. Periksa koneksi/Server. PDF tidak dibuat.");
  } finally {
    clearTimeout(t);
    btn.disabled = false; btn.textContent = original;
  }
});

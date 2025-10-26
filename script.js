// --- Helper to call your Worker robustly ---
async function enhanceText(inputText, { signal, lang } = {}) {
  const promptLang = lang === "en" ? "English" : "Bahasa Indonesia";
  const payload = { inputs: `Improve this CV text in ${promptLang}:\n\n${inputText}` };

  const res = await fetch("https://cv-maker.arrafahvega.workers.dev/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} ${text}`);
  }

  // Accept several common response shapes
  const data = await res.json();
  const improved =
    (Array.isArray(data) && data[0]?.generated_text) ||
    data.generated_text ||
    data?.choices?.[0]?.text ||
    data.text;

  if (!improved || typeof improved !== "string") {
    throw new Error("Unexpected AI response shape");
  }
  return improved.trim();
}

// --- Gather all form fields into one clean block of text ---
function combineFormData(formEl) {
  const fd = new FormData(formEl);
  const parts = [];
  for (const [k, v] of fd.entries()) {
    const clean = (v || "").toString().trim();
    if (clean) parts.push(clean);
  }
  return parts.join("\n");
}

document.getElementById("generateBtn").addEventListener("click", async () => {
  const btn = document.getElementById("generateBtn");
  const form = document.getElementById("cvForm");
  const lang = document.getElementById("language")?.value || "id";
  const downloadSection = document.getElementById("downloadSection");

  // UI busy state
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.setAttribute("aria-busy", "true");
  btn.textContent = "Processing...";

  // Build combined text from the form
  const combinedText = combineFormData(form);

  // Timeout protection (prevents infinite hanging)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort("timeout"), 20000); // 20s

  let finalText = combinedText;

  try {
    // Try AI improvement
    finalText = await enhanceText(combinedText, { signal: controller.signal, lang });
  } catch (err) {
    console.error(err);
    alert("Gagal memproses AI. CV tetap dibuat dari teks asli.");
    // finalText remains as combinedText
  } finally {
    clearTimeout(timeoutId);
    // Always restore button
    btn.disabled = false;
    btn.removeAttribute("aria-busy");
    btn.textContent = originalLabel;
  }

  // Create the PDF (works whether AI succeeded or not)
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFont("Helvetica", "normal");
  doc.setFontSize(14);
  doc.text("Curriculum Vitae (ATS Friendly)", 10, 20);
  doc.setFontSize(11);

  // Ensure long text wraps inside the page margins
  doc.text(finalText, 10, 35, { maxWidth: 180 });
  doc.save("ATS_CV.pdf");

  // Show the download section UI
  downloadSection?.classList?.remove("hidden");
});

document.getElementById("downloadCV").addEventListener("click", () => {
  alert("Your CV has been downloaded!");
});

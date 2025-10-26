// ---- script.js (hardened) ----
async function enhanceText(inputText, { signal } = {}) {
  // Add a short prefix to keep prompt small & controlled
  const payload = { inputs: `Improve this CV text in Bahasa Indonesia:\n\n${inputText}` };

  const res = await fetch("https://cv-maker.arrafahvega.workers.dev/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal
  });

  if (!res.ok) {
    // Surface server-side errors clearly
    const text = await res.text().catch(() => "");
    throw new Error(`AI generate failed: ${res.status} ${res.statusText} ${text}`);
  }

  // Be generous about possible shapes the endpoint might return
  const data = await res.json();
  // Common HF shapes:
  //  - [{ generated_text: "..." }]
  //  - { generated_text: "..." }
  //  - { choices: [{ text: "..." }] }
  //  - { text: "..." }
  const improved =
    (Array.isArray(data) && data[0]?.generated_text) ||
    data.generated_text ||
    data?.choices?.[0]?.text ||
    data.text;

  if (!improved || typeof improved !== "string") {
    throw new Error("Unexpected AI response shape.");
  }

  return improved.trim();
}

function combineFormData(formEl) {
  const fd = new FormData(formEl);
  const obj = Object.fromEntries(fd.entries());
  // Keep order stable and drop empty lines
  return Object.values(obj)
    .map(v => (v || "").trim())
    .filter(Boolean)
    .join("\n");
}

document.getElementById("generateBtn").addEventListener("click", async () => {
  const btn = document.getElementById("generateBtn");
  const form = document.getElementById("cvForm");
  const downloadSection = document.getElementById("downloadSection");

  // UI: busy
  btn.disabled = true;
  btn.setAttribute("aria-busy", "true");
  const originalLabel = btn.textContent;
  btn.textContent = "Processing...";

  // Setup a timeout so we don't hang forever
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort("timeout"), 20000); // 20s

  let improvedText;
  const combinedText = combineFormData(form);

  try {
    // Try AI enhancement
    improvedText = await enhanceText(combinedText, { signal: controller.signal });
  } catch (err) {
    // Fallback to the raw text if AI fails (CORS / bad JSON / timeout)
    console.error(err);
    alert("Gagal memproses AI. CV tetap dibuat dari teks asli.");
    improvedText = combinedText || "CV";
  } finally {
    clearTimeout(timeoutId);
    // Always restore UI state
    btn.disabled = false;
    btn.removeAttribute("aria-busy");
    btn.textContent = originalLabel;
  }

  // Create PDF no matter what
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFont("Helvetica", "normal");
  doc.setFontSize(14);
  doc.text("Curriculum Vitae (ATS Friendly)", 10, 20);
  doc.setFontSize(11);
  doc.text(improvedText, 10, 35, { maxWidth: 180 });
  doc.save("ATS_CV.pdf");

  downloadSection.classList.remove("hidden");
});

// Optional: keep your existing handler
document.getElementById("downloadCV").addEventListener("click", () => {
  alert("Your CV has been downloaded!");
});

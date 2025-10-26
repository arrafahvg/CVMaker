async function enhanceText(inputText) {
  const response = await fetch("https://api-inference.huggingface.co/models/google/flan-t5-base", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inputs: "Improve this CV text in Bahasa Indonesia: " + inputText })
  });
  const result = await response.json();
  return result[0]?.generated_text || inputText;
}

document.getElementById('generateBtn').addEventListener('click', async () => {
  const form = document.getElementById('cvForm');
  const formData = new FormData(form);
  const data = Object.fromEntries(formData.entries());

  document.getElementById('generateBtn').textContent = "Processing...";
  const combinedText = Object.values(data).join("\n");
  const improved = await enhanceText(combinedText);

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFont("Helvetica", "normal");
  doc.setFontSize(14);
  doc.text("Curriculum Vitae (ATS Friendly)", 10, 20);
  doc.setFontSize(11);
  doc.text(improved, 10, 35, { maxWidth: 180 });
  doc.save("ATS_CV.pdf");

  document.getElementById('downloadSection').classList.remove('hidden');
  document.getElementById('generateBtn').textContent = "Generate CV (AI)";
});

document.getElementById('downloadCV').addEventListener('click', () => {
  alert('Your CV has been downloaded!');
});

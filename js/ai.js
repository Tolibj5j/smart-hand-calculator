// Qo'lda yozilgan misolni Google Gemini (REST API) orqali tanish.

export const DEFAULT_MODEL = "gemini-3.8-flash";

const PROMPT =
  "The image contains a handwritten math expression (dark strokes on a white background). " +
  "Recognize the expression and solve it. " +
  "Reply STRICTLY in the format: expression = answer (for example: 2 + 2 = 4 or 5 * 10 = 50). " +
  "Use only the symbols + - * / and digits. No extra words.";

export async function solveImage(pngBase64, apiKey, model = DEFAULT_MODEL) {
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(model) +
    ":generateContent";

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: PROMPT },
            { inline_data: { mime_type: "image/png", data: pngBase64 } },
          ],
        },
      ],
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `HTTP ${res.status}`);
  }
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p.text ?? "").join("").trim();
  if (!text) throw new Error("Bo'sh javob keldi");
  return text;
}

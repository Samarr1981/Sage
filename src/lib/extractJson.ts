// Pull JSON out of an LLM text response even if it's wrapped in stray text
// or markdown fences. Returns null instead of throwing, so a parse hiccup
// never crashes the route that calls it.
export function extractJson(raw: string): any | null {
  const cleaned = raw.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

// Same idea as extractJson, but for responses that are a JSON array.
export function extractJsonArray(raw: string): any[] | null {
  const cleaned = raw.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1) return null;
  try {
    const result = JSON.parse(cleaned.slice(start, end + 1));
    return Array.isArray(result) ? result : null;
  } catch {
    return null;
  }
}
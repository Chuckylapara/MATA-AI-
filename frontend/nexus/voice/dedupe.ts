/** Collapse a phrase that the recogniser repeated back-to-back ("hola que tal hola que tal" → "hola que tal"). */
export function dedupeRepeats(text: string): string {
  let words = text.trim().split(/\s+/);
  const norm = (w: string) => w.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w]/g, "");
  let changed = true;
  while (changed) {
    changed = false;
    for (let size = Math.floor(words.length / 2); size >= 1; size--) {
      for (let i = 0; i + 2 * size <= words.length; i++) {
        const a = words.slice(i, i + size).map(norm).join(" ");
        const b = words.slice(i + size, i + 2 * size).map(norm).join(" ");
        if (a && a === b) { words = [...words.slice(0, i + size), ...words.slice(i + 2 * size)]; changed = true; break; }
      }
      if (changed) break;
    }
  }
  return words.join(" ");
}

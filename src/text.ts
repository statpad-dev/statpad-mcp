const FOLDED: Record<string, string> = { ø: 'o', ß: 'ss', æ: 'ae', œ: 'oe', đ: 'd', ð: 'd', ł: 'l', þ: 'th', ı: 'i' };

/** Lowercases and strips accents, so "Müller" matches "muller" and "Ødegaard" matches "odegaard". */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[øßæœđðłþı]/g, (char) => FOLDED[char] ?? char)
    .replace(/\s+/g, ' ')
    .trim();
}

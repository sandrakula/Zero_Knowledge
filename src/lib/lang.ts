export type Lang = "en" | "ru";

export function normalizeLang(lang?: string | null): Lang {
  return lang === "ru" ? "ru" : "en";
}

/** Instruction appended to generation prompts to control output language. */
export function langInstruction(lang?: string | null): string {
  return normalizeLang(lang) === "ru"
    ? "Respond entirely in Russian (Русский язык)."
    : "Respond entirely in English.";
}

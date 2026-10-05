export type Preferences = { theme: "light" | "dark"; reducedMotion: boolean };
export function preferences(): Preferences {
  try {
    const raw = JSON.parse(
      localStorage.getItem("cablesim-preferences") || "{}",
    );
    return {
      theme: raw.theme === "dark" ? "dark" : "light",
      reducedMotion: raw.reducedMotion === true,
    };
  } catch {
    return { theme: "light", reducedMotion: false };
  }
}
export function savePreferences(value: Preferences) {
  localStorage.setItem("cablesim-preferences", JSON.stringify(value));
  document.documentElement.dataset.reducedMotion = value.reducedMotion
    ? "true"
    : "false";
}

"use client";

// Robust download: fetch as blob and save (forces a real file download, works for
// cross-origin and data URLs). Falls back to opening in a new tab.
export async function downloadFile(url: string, filename: string): Promise<void> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objUrl);
  } catch {
    window.open(url, "_blank");
  }
}

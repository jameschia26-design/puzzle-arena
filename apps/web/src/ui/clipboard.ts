/** navigator.clipboard is absent on insecure origins and can reject. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the failure toast */
  }
  return false;
}

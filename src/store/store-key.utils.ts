export function isPoolKey(key: string): boolean {
  return key.endsWith('|bidPool') || key.endsWith('|askPool');
}


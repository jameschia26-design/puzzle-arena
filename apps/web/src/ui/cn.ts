import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Every component uses this; no raw string concatenation of classes. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

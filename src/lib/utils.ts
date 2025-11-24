import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function downloadCsv(data: any[], filename: string) {
  if (!data || data.length === 0) {
    return;
  }
  const headers = Object.keys(data[0]);
  const csvContent = [
    headers.join(','),
    ...data.map((row) =>
      headers
        .map((header) => {
          let cell = row[header] === null || row[header] === undefined ? '' : String(row[header]);
          cell = cell.includes(',') ? `"${cell}"` : cell;
          return cell;
        })
        .join(',')
    ),
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

// --- Local Storage for Audit Report State ---
const FIXED_MISMATCHES_KEY = 'fixedMismatches';
const CREATED_PRODUCTS_KEY = 'createdProducts';

// --- Mismatches ---

export function getFixedMismatches(): Set<string> {
  if (typeof window === 'undefined') {
    return new Set();
  }
  const saved = localStorage.getItem(FIXED_MISMATCHES_KEY);
  if (!saved) {
    return new Set();
  }
  try {
    const parsed = JSON.parse(saved);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch (e) {
    return new Set();
  }
}

export function markMismatchAsFixed(sku: string, field: string) {
  if (typeof window === 'undefined') return;
  const currentFixed = getFixedMismatches();
  currentFixed.add(`${sku}-${field}`);
  localStorage.setItem(FIXED_MISMATCHES_KEY, JSON.stringify(Array.from(currentFixed)));
}

// --- Created Products ---

export function getCreatedProductHandles(): Set<string> {
  if (typeof window === 'undefined') {
    return new Set();
  }
  const saved = localStorage.getItem(CREATED_PRODUCTS_KEY);
  if (!saved) {
    return new Set();
  }
  try {
    const parsed = JSON.parse(saved);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch (e) {
    return new Set();
  }
}

export function markProductAsCreated(handle: string) {
  if (typeof window === 'undefined') return;
  const currentCreated = getCreatedProductHandles();
  currentCreated.add(handle);
  localStorage.setItem(CREATED_PRODUCTS_KEY, JSON.stringify(Array.from(currentCreated)));
}

// --- Clear All ---

export function clearAuditMemory() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(FIXED_MISMATCHES_KEY);
  localStorage.removeItem(CREATED_PRODUCTS_KEY);
}

import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

// cn(): gabungkan className + rapikan bentrok kelas Tailwind (dipakai semua komponen shadcn/ui)
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

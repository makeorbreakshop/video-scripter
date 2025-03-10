import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function extractYouTubeId(url: string): string | null {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/
  const match = url.match(regExp)
  return match && match[2].length === 11 ? match[2] : null
}

export function formatWordCount(text: string): string {
  const wordCount = text.trim().split(/\s+/).length
  const minutes = Math.ceil(wordCount / 150) // Assuming 150 words per minute
  return `${wordCount} words (approx. ${minutes} min)`
}

export function generateRandomId(): string {
  return Math.random().toString(36).substring(2, 9)
}


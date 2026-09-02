import Link from "next/link"

export function SiteFooter() {
  return (
    <footer className="border-t border-white/10 mt-16">
      <div className="max-w-3xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
        <span>&copy; {new Date().getFullYear()} Make or Break Shop LLC</span>
        <nav className="flex items-center gap-6">
          <Link href="/about" className="hover:text-foreground transition-colors">
            About
          </Link>
          <Link href="/privacy" className="hover:text-foreground transition-colors">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-foreground transition-colors">
            Terms
          </Link>
          <Link href="/docs/api" className="hover:text-foreground transition-colors">
            API docs
          </Link>
        </nav>
      </div>
    </footer>
  )
}

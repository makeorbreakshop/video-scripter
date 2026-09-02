import { SiteFooter } from "@/components/site-footer"

export const metadata = {
  title: "Terms of Service — ChannelSmith",
}

export default function TermsPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <main className="flex-1 max-w-3xl mx-auto px-6 py-16 text-sm leading-relaxed">
        <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
        <p className="text-muted-foreground mb-10">Last updated September 2, 2026</p>

        <p className="mb-6">
          ChannelSmith is operated by Make or Break Shop LLC, based in Watkinsville,
          Georgia. By using ChannelSmith you agree to these terms. Questions go to{" "}
          <a href="mailto:brandon@makeorbreakshop.com" className="underline">
            brandon@makeorbreakshop.com
          </a>
          .
        </p>

        <h2 className="text-xl font-semibold mt-10 mb-3">Beta status</h2>
        <p className="mb-6">
          ChannelSmith is in beta. Features, pricing, and data retention may change
          without notice. We do not guarantee uptime, accuracy of scores or
          detections, or that the service will be available at any given time. Use it
          knowing it can break, change, or be discontinued.
        </p>

        <h2 className="text-xl font-semibold mt-10 mb-3">Your account</h2>
        <p className="mb-6">
          You are responsible for the activity on your account and for keeping your
          credentials secure. You must be at least 18 years old, or the age of
          majority in your jurisdiction, to use ChannelSmith.
        </p>

        <h2 className="text-xl font-semibold mt-10 mb-3">API keys</h2>
        <p className="mb-6">
          If you generate an API key to access ChannelSmith programmatically, you are
          responsible for keeping it secret and for all activity made with it. Keys
          are shown once at creation and stored only as a hash; if you lose a key you
          must revoke it and create a new one. Report a compromised key to us
          immediately so we can revoke it.
        </p>

        <h2 className="text-xl font-semibold mt-10 mb-3">Acceptable use</h2>
        <p className="mb-3">You agree not to:</p>
        <ul className="list-disc pl-6 mb-6 space-y-1">
          <li>Scrape, crawl, or bulk-extract data from ChannelSmith outside the documented API.</li>
          <li>Exceed documented rate limits or attempt to circumvent them.</li>
          <li>Resell or redistribute ChannelSmith data as a standalone product.</li>
          <li>Use the service to harass, defame, or infringe the rights of any creator or channel.</li>
          <li>Attempt to access another user's account or data without authorization.</li>
          <li>Use the service in a way that violates YouTube's Terms of Service.</li>
        </ul>

        <h2 className="text-xl font-semibold mt-10 mb-3">Termination</h2>
        <p className="mb-6">
          We may suspend or terminate your account at any time, with or without
          notice, for violating these terms, abusing the API, or any other reason at
          our discretion. You may stop using ChannelSmith and delete your account at
          any time.
        </p>

        <h2 className="text-xl font-semibold mt-10 mb-3">Disclaimer</h2>
        <p className="mb-6">
          ChannelSmith is provided "as is" without warranties of any kind. Outlier
          scores, performance predictions, and change detections are estimates based
          on available data and are not guaranteed to be accurate or complete. We are
          not liable for decisions made based on ChannelSmith data.
        </p>

        <h2 className="text-xl font-semibold mt-10 mb-3">Changes to these terms</h2>
        <p>
          We may update these terms as ChannelSmith changes. Continued use after an
          update means you accept the revised terms.
        </p>
      </main>
      <SiteFooter />
    </div>
  )
}

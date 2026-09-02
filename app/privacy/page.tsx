import { SiteFooter } from "@/components/site-footer"

export const metadata = {
  title: "Privacy Policy — ChannelSmith",
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <main className="flex-1 max-w-3xl mx-auto px-6 py-16 text-sm leading-relaxed">
        <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-muted-foreground mb-10">Last updated September 2, 2026</p>

        <p className="mb-6">
          ChannelSmith is operated by Make or Break Shop LLC, based in Watkinsville,
          Georgia. This page explains what data we collect, why, and how you can
          control it. Questions go to{" "}
          <a href="mailto:brandon@makeorbreakshop.com" className="underline">
            brandon@makeorbreakshop.com
          </a>
          .
        </p>

        <h2 className="text-xl font-semibold mt-10 mb-3">What we collect</h2>
        <p className="mb-3">
          When you create an account, we collect the email address and profile
          information provided by our authentication provider.
        </p>
        <p className="mb-6">
          When you connect a YouTube channel or track a competitor's channel, we
          collect public channel and video metadata through the YouTube Data API:
          channel names and handles, subscriber counts, video titles, descriptions,
          publish dates, thumbnails, and view/like/comment counts. We do not collect
          private YouTube account data unless you explicitly authorize it through
          Google's OAuth consent screen.
        </p>

        <h2 className="text-xl font-semibold mt-10 mb-3">YouTube API Services</h2>
        <p className="mb-3">
          ChannelSmith uses YouTube API Services. By using ChannelSmith, you are also
          agreeing to be bound by the{" "}
          <a
            href="https://www.youtube.com/t/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            YouTube Terms of Service
          </a>{" "}
          and the{" "}
          <a
            href="https://policies.google.com/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Google Privacy Policy
          </a>
          .
        </p>
        <p className="mb-3">
          Data collected from YouTube API Services is limited to public channel and
          video metadata — titles, descriptions, thumbnails, publish dates, view
          counts, like counts, comment counts, subscriber counts, and thumbnail/title
          change history that we detect over time. We retain this data for as long as
          your account is active and you continue tracking the relevant channel, plus
          a limited period afterward for backups. If you delete your account, we
          delete or anonymize this data within 30 days, except where retention is
          required for fraud prevention, legal compliance, or dispute resolution.
        </p>
        <p className="mb-3">
          You can revoke ChannelSmith's access to your Google/YouTube account at any
          time from Google's security settings:{" "}
          <a
            href="https://security.google.com/settings/security/permissions"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            https://security.google.com/settings/security/permissions
          </a>
          . Revoking access stops future data collection but does not automatically
          delete data already stored; email us to request deletion.
        </p>
        <p className="mb-6">We do not sell your data or YouTube data to third parties.</p>

        <h2 className="text-xl font-semibold mt-10 mb-3">How we use data</h2>
        <p className="mb-6">
          We use collected data to operate ChannelSmith's core features: showing you
          outlier videos, thumbnail and title change history, and per-channel
          performance scoring. We do not use YouTube data for advertising, and we do
          not share it with advertisers.
        </p>

        <h2 className="text-xl font-semibold mt-10 mb-3">Cookies and analytics</h2>
        <p className="mb-6">
          We use cookies to keep you signed in and to remember basic preferences. We
          may use privacy-conscious analytics to understand aggregate product usage;
          this data is not sold or shared with third parties for advertising.
        </p>

        <h2 className="text-xl font-semibold mt-10 mb-3">Data sharing</h2>
        <p className="mb-6">
          We share data with service providers who help us run ChannelSmith
          (hosting, database, authentication) under agreements that limit their use
          of it to providing that service. We do not sell data. We may disclose data
          if required by law.
        </p>

        <h2 className="text-xl font-semibold mt-10 mb-3">Your choices</h2>
        <p className="mb-6">
          You can stop tracking any channel, delete your account, or revoke YouTube
          access at any time. Contact{" "}
          <a href="mailto:brandon@makeorbreakshop.com" className="underline">
            brandon@makeorbreakshop.com
          </a>{" "}
          to request a copy of your data or full deletion.
        </p>

        <h2 className="text-xl font-semibold mt-10 mb-3">Changes to this policy</h2>
        <p>
          We may update this policy as ChannelSmith changes. Material changes will be
          reflected by updating the date at the top of this page.
        </p>
      </main>
      <SiteFooter />
    </div>
  )
}

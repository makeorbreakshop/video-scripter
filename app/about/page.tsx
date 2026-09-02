import { SiteFooter } from "@/components/site-footer"

export const metadata = {
  title: "About — ChannelSmith",
}

export default function AboutPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <main className="flex-1 max-w-3xl mx-auto px-6 py-16 text-sm leading-relaxed">
        <h1 className="text-3xl font-bold mb-8">About ChannelSmith</h1>

        <p className="mb-6">
          ChannelSmith shows YouTube creators what their competitors changed about
          their videos — new thumbnails, new titles, A/B tests — and whether the
          change worked, using per-channel outlier scoring that compares each video
          against that channel's own baseline rather than a generic benchmark.
        </p>

        <p>
          ChannelSmith is built by Brandon Cullum, who also runs Make or Break Shop
          and Machines for Makers, YouTube channels covering lasers, 3D printers, and
          maker tools. It's operated by Make or Break Shop LLC in Watkinsville,
          Georgia. Questions go to{" "}
          <a href="mailto:brandon@makeorbreakshop.com" className="underline">
            brandon@makeorbreakshop.com
          </a>
          .
        </p>
      </main>
      <SiteFooter />
    </div>
  )
}

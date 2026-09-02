import fs from "fs"
import path from "path"
import type { ReactNode } from "react"

export const metadata = {
  title: "API Docs — ChannelSmith",
}

// Minimal markdown -> JSX renderer for docs/api-v1.md.
// Supports: headings, paragraphs, fenced code blocks, tables, unordered lists,
// horizontal rules, and inline bold/code/links.
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  // Split on inline code, bold, and links while keeping delimiters.
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let i = 0
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index))
    }
    const token = match[0]
    const key = `${keyPrefix}-${i++}`
    if (token.startsWith("`")) {
      nodes.push(
        <code key={key} className="bg-white/10 rounded px-1.5 py-0.5 text-[0.85em] font-mono">
          {token.slice(1, -1)}
        </code>
      )
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith("[")) {
      const linkMatch = /\[([^\]]+)\]\(([^)]+)\)/.exec(token)
      if (linkMatch) {
        nodes.push(
          <a
            key={key}
            href={linkMatch[2]}
            className="underline"
            target={linkMatch[2].startsWith("http") ? "_blank" : undefined}
            rel={linkMatch[2].startsWith("http") ? "noopener noreferrer" : undefined}
          >
            {linkMatch[1]}
          </a>
        )
      }
    }
    lastIndex = match.index + token.length
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }
  return nodes
}

function renderMarkdown(markdown: string): ReactNode[] {
  const lines = markdown.split("\n")
  const blocks: ReactNode[] = []
  let i = 0
  let blockKey = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.trim() === "") {
      i++
      continue
    }

    if (line.trim() === "---") {
      blocks.push(<hr key={blockKey++} className="my-10 border-white/10" />)
      i++
      continue
    }

    // Fenced code block
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i])
        i++
      }
      i++ // skip closing fence
      blocks.push(
        <pre
          key={blockKey++}
          className="bg-white/5 border border-white/10 rounded-lg p-4 overflow-x-auto text-[0.85em] font-mono mb-6"
        >
          <code data-lang={lang}>{codeLines.join("\n")}</code>
        </pre>
      )
      continue
    }

    // Headings
    const headingMatch = /^(#{1,3})\s+(.*)$/.exec(line)
    if (headingMatch) {
      const level = headingMatch[1].length
      const text = headingMatch[2]
      const key = blockKey++
      if (level === 1) {
        blocks.push(
          <h1 key={key} className="text-3xl font-bold mb-2">
            {renderInline(text, `h${key}`)}
          </h1>
        )
      } else if (level === 2) {
        blocks.push(
          <h2 key={key} className="text-xl font-semibold mt-10 mb-3">
            {renderInline(text, `h${key}`)}
          </h2>
        )
      } else {
        blocks.push(
          <h3 key={key} className="text-lg font-semibold mt-8 mb-2">
            {renderInline(text, `h${key}`)}
          </h3>
        )
      }
      i++
      continue
    }

    // Table
    if (line.trim().startsWith("|")) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i])
        i++
      }
      const rows = tableLines
        .filter((l) => !/^\|[\s-:|]+\|$/.test(l.trim()))
        .map((l) =>
          l
            .trim()
            .replace(/^\|/, "")
            .replace(/\|$/, "")
            .split("|")
            .map((c) => c.trim())
        )
      const [header, ...body] = rows
      const key = blockKey++
      blocks.push(
        <div key={key} className="overflow-x-auto mb-6">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/20">
                {header.map((cell, ci) => (
                  <th key={ci} className="py-2 pr-4 font-semibold">
                    {renderInline(cell, `th${key}-${ci}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, ri) => (
                <tr key={ri} className="border-b border-white/10">
                  {row.map((cell, ci) => (
                    <td key={ci} className="py-2 pr-4 align-top">
                      {renderInline(cell, `td${key}-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      continue
    }

    // Unordered list
    if (/^\s*-\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*-\s+/, ""))
        i++
      }
      const key = blockKey++
      blocks.push(
        <ul key={key} className="list-disc pl-6 mb-6 space-y-1">
          {items.map((item, ii) => (
            <li key={ii}>{renderInline(item, `li${key}-${ii}`)}</li>
          ))}
        </ul>
      )
      continue
    }

    // Paragraph (collect consecutive non-empty, non-special lines)
    const paraLines: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("```") &&
      !lines[i].startsWith("#") &&
      lines[i].trim() !== "---" &&
      !lines[i].trim().startsWith("|") &&
      !/^\s*-\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i])
      i++
    }
    const key = blockKey++
    blocks.push(
      <p key={key} className="mb-6">
        {renderInline(paraLines.join(" "), `p${key}`)}
      </p>
    )
  }

  return blocks
}

export default function ApiDocsPage() {
  const filePath = path.join(process.cwd(), "docs", "api-v1.md")
  const markdown = fs.readFileSync(filePath, "utf-8")

  return (
    <div className="min-h-screen bg-background">
      <main className="max-w-3xl mx-auto px-6 py-16 text-sm leading-relaxed">
        {renderMarkdown(markdown)}
      </main>
    </div>
  )
}

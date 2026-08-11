import React from "react";

// Minimal markdown renderer for AI stage output. Builds React nodes directly
// (no dangerouslySetInnerHTML) so model output can never inject HTML.

function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Split on **bold** and `code` spans.
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  const parts = text.split(re);
  parts.forEach((part, i) => {
    const key = `${keyBase}-${i}`;
    if (part.startsWith("**") && part.endsWith("**")) {
      nodes.push(
        <strong key={key} className="font-semibold text-slate-100">
          {part.slice(2, -2)}
        </strong>
      );
    } else if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      nodes.push(
        <code
          key={key}
          className="rounded bg-slate-800 px-1 py-0.5 font-mono text-[0.85em] text-indigo-300"
        >
          {part.slice(1, -1)}
        </code>
      );
    } else if (part) {
      nodes.push(part);
    }
  });
  return nodes;
}

interface Block {
  type: "h1" | "h2" | "h3" | "p" | "ul" | "ol" | "code" | "table" | "quote";
  lines: string[];
  lang?: string;
}

function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        code.push(lines[i]);
        i++;
      }
      i++; // closing fence
      blocks.push({ type: "code", lines: code, lang });
    } else if (/^###\s/.test(line)) {
      blocks.push({ type: "h3", lines: [line.replace(/^###\s+/, "")] });
      i++;
    } else if (/^##\s/.test(line)) {
      blocks.push({ type: "h2", lines: [line.replace(/^##\s+/, "")] });
      i++;
    } else if (/^#\s/.test(line)) {
      blocks.push({ type: "h1", lines: [line.replace(/^#\s+/, "")] });
      i++;
    } else if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ type: "quote", lines: quote });
    } else if (/^\s*[-*]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ul", lines: items });
    } else if (/^\s*\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ type: "ol", lines: items });
    } else if (/^\|.*\|\s*$/.test(line)) {
      const rows: string[] = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) {
        rows.push(lines[i]);
        i++;
      }
      blocks.push({ type: "table", lines: rows });
    } else if (line.trim() === "") {
      i++;
    } else {
      const para: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() !== "" &&
        !/^(#{1,3}\s|```|\s*[-*]\s|\s*\d+\.\s|>|\|)/.test(lines[i])
      ) {
        para.push(lines[i]);
        i++;
      }
      blocks.push({ type: "p", lines: [para.join(" ")] });
    }
  }
  return blocks;
}

function parseTableRow(row: string): string[] {
  return row
    .replace(/^\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim());
}

export default function Markdown({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className="space-y-3 text-sm leading-relaxed text-slate-300">
      {blocks.map((block, bi) => {
        const key = `b-${bi}`;
        switch (block.type) {
          case "h1":
          case "h2":
            return (
              <h3 key={key} className="pt-1 text-base font-semibold text-slate-100">
                {renderInline(block.lines[0], key)}
              </h3>
            );
          case "h3":
            return (
              <h4 key={key} className="pt-1 text-sm font-semibold text-slate-200">
                {renderInline(block.lines[0], key)}
              </h4>
            );
          case "code":
            return (
              <pre
                key={key}
                className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs text-slate-300"
              >
                <code>{block.lines.join("\n")}</code>
              </pre>
            );
          case "quote":
            return (
              <blockquote
                key={key}
                className="border-l-2 border-indigo-500/50 pl-3 text-xs italic text-slate-400"
              >
                {block.lines.map((l, li) => (
                  <p key={`${key}-${li}`}>{renderInline(l, `${key}-${li}`)}</p>
                ))}
              </blockquote>
            );
          case "ul":
            return (
              <ul key={key} className="list-disc space-y-1 pl-5">
                {block.lines.map((item, li) => (
                  <li key={`${key}-${li}`}>{renderInline(item, `${key}-${li}`)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={key} className="list-decimal space-y-1 pl-5">
                {block.lines.map((item, li) => (
                  <li key={`${key}-${li}`}>{renderInline(item, `${key}-${li}`)}</li>
                ))}
              </ol>
            );
          case "table": {
            const [header, separator, ...rows] = block.lines;
            const headerCells = header ? parseTableRow(header) : [];
            const bodyRows = (separator && /^\|[\s:-]+\|/.test(separator) ? rows : [separator, ...rows])
              .filter((r): r is string => Boolean(r))
              .map(parseTableRow);
            return (
              <div key={key} className="overflow-x-auto">
                <table className="min-w-full border-collapse text-xs">
                  <thead>
                    <tr>
                      {headerCells.map((c, ci) => (
                        <th
                          key={`${key}-h-${ci}`}
                          className="border border-slate-800 bg-slate-900 px-2 py-1 text-left font-semibold text-slate-200"
                        >
                          {renderInline(c, `${key}-h-${ci}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bodyRows.map((r, ri) => (
                      <tr key={`${key}-r-${ri}`}>
                        {r.map((c, ci) => (
                          <td
                            key={`${key}-r-${ri}-${ci}`}
                            className="border border-slate-800 px-2 py-1"
                          >
                            {renderInline(c, `${key}-r-${ri}-${ci}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }
          case "p":
          default:
            return <p key={key}>{renderInline(block.lines[0], key)}</p>;
        }
      })}
    </div>
  );
}

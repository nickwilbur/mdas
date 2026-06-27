'use client';

import type { ReactNode } from 'react';
export function MarkdownDocument({ markdown }: { markdown: string }) {
  const lines = markdown.split('\n');
  const nodes: JSX.Element[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';

    if (line.startsWith('|') && line.includes('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && (lines[i]?.startsWith('|') ?? false)) {
        tableLines.push(lines[i]!);
        i += 1;
      }
      if (tableLines.length >= 2) {
        const header = tableLines[0]!
          .split('|')
          .map((c) => c.trim())
          .filter(Boolean);
        const body = tableLines.slice(2).map((row) =>
          row
            .split('|')
            .map((c) => c.trim())
            .filter(Boolean),
        );
        nodes.push(
          <div key={key++} className="my-4 overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="bg-gray-100">
                  {header.map((h) => (
                    <th key={h} className="border border-gray-200 px-2 py-1 text-left font-semibold">
                      {inlineFormat(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.map((row, ri) => (
                  <tr key={ri} className="even:bg-gray-50">
                    {row.map((cell, ci) => (
                      <td key={ci} className="border border-gray-200 px-2 py-1 align-top">
                        {inlineFormat(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
      }
      continue;
    }

    if (line.startsWith('# ')) {
      nodes.push(
        <h1 key={key++} className="mb-4 text-2xl font-semibold">
          {line.slice(2)}
        </h1>,
      );
      i += 1;
      continue;
    }
    if (line.startsWith('## ')) {
      nodes.push(
        <h2 key={key++} className="mb-3 mt-8 text-lg font-semibold">
          {line.slice(3)}
        </h2>,
      );
      i += 1;
      continue;
    }
    if (line.startsWith('### ')) {
      nodes.push(
        <h3 key={key++} className="mb-2 mt-6 text-base font-semibold">
          {line.slice(4)}
        </h3>,
      );
      i += 1;
      continue;
    }
    if (line.startsWith('- ')) {
      const items: string[] = [];
      while (i < lines.length && (lines[i]?.startsWith('- ') ?? false)) {
        items.push(lines[i]!.slice(2));
        i += 1;
      }
      nodes.push(
        <ul key={key++} className="my-2 list-disc space-y-1 pl-5 text-sm">
          {items.map((item, idx) => (
            <li key={idx}>{inlineFormat(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    if (line.trim() === '---') {
      nodes.push(<hr key={key++} className="my-6 border-gray-200" />);
      i += 1;
      continue;
    }
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    nodes.push(
      <p key={key++} className="my-2 text-sm leading-relaxed text-gray-800">
        {inlineFormat(line)}
      </p>,
    );
    i += 1;
  }

  return <article className="max-w-5xl">{nodes}</article>;
}

function inlineFormat(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}

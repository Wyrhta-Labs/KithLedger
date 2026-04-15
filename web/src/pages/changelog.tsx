import { Fragment, ReactNode } from 'react';
import { ScrollText } from 'lucide-react';
import changelogMarkdown from '../../../CHANGELOG.md?raw';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type InlineToken =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string }
  | { type: 'strong'; children: InlineToken[] }
  | { type: 'link'; label: string; href: string };

type ListNode = {
  content: string;
  children: ListNode[];
};

export default function ChangelogPage() {
  const blocks = parseMarkdown(changelogMarkdown);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ScrollText className="h-5 w-5 text-blue-600" />
            Changelog
          </CardTitle>
          <CardDescription>Release history and unreleased changes from the repository changelog.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6 text-sm leading-7 text-gray-700">
            {blocks.map((block, index) => (
              <Fragment key={`${block.type}-${index}`}>{renderBlock(block)}</Fragment>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3; content: string }
  | { type: 'paragraph'; content: string }
  | { type: 'list'; items: ListNode[] }
  | { type: 'rule' };

function parseMarkdown(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length as 1 | 2 | 3,
        content: headingMatch[2],
      });
      index += 1;
      continue;
    }

    if (trimmed === '---') {
      blocks.push({ type: 'rule' });
      index += 1;
      continue;
    }

    if (/^\s*-\s+/.test(line)) {
      const { items, nextIndex } = parseList(lines, index, 0);
      blocks.push({ type: 'list', items });
      index = nextIndex;
      continue;
    }

    const paragraphLines = [trimmed];
    index += 1;
    while (index < lines.length) {
      const nextLine = lines[index];
      const nextTrimmed = nextLine.trim();
      if (!nextTrimmed || /^(#{1,3})\s+/.test(nextTrimmed) || nextTrimmed === '---' || /^\s*-\s+/.test(nextLine)) {
        break;
      }

      paragraphLines.push(nextTrimmed);
      index += 1;
    }

    blocks.push({ type: 'paragraph', content: paragraphLines.join(' ') });
  }

  return blocks;
}

function parseList(lines: string[], startIndex: number, indent: number) {
  const items: ListNode[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const lineIndent = line.match(/^\s*/)?.[0].length ?? 0;
    if (lineIndent < indent) break;

    const itemMatch = line.match(/^(\s*)-\s+(.*)$/);
    if (!itemMatch) break;

    if (lineIndent > indent) {
      const lastItem = items[items.length - 1];
      if (!lastItem) break;
      const nested = parseList(lines, index, lineIndent);
      lastItem.children = nested.items;
      index = nested.nextIndex;
      continue;
    }

    items.push({
      content: itemMatch[2],
      children: [],
    });
    index += 1;
  }

  return { items, nextIndex: index };
}

function renderBlock(block: MarkdownBlock) {
  if (block.type === 'heading') {
    if (block.level === 1) {
      return <h1 className="text-3xl font-semibold text-gray-950">{renderInline(block.content)}</h1>;
    }

    if (block.level === 2) {
      return (
        <h2 className="border-b border-gray-200 pb-2 text-2xl font-semibold text-gray-900">
          {renderInline(block.content)}
        </h2>
      );
    }

    return <h3 className="text-lg font-semibold text-gray-900">{renderInline(block.content)}</h3>;
  }

  if (block.type === 'paragraph') {
    return <p>{renderInline(block.content)}</p>;
  }

  if (block.type === 'rule') {
    return <hr className="border-gray-200" />;
  }

  return <MarkdownList items={block.items} />;
}

function MarkdownList({ items }: { items: ListNode[] }) {
  return (
    <ul className="space-y-2 pl-5 marker:text-gray-400">
      {items.map((item, index) => (
        <li key={`${item.content}-${index}`} className="list-disc">
          <span>{renderInline(item.content)}</span>
          {item.children.length > 0 ? <MarkdownList items={item.children} /> : null}
        </li>
      ))}
    </ul>
  );
}

function renderInline(content: string): ReactNode[] {
  return parseInline(content).map((token, index) => {
    if (token.type === 'text') {
      return <Fragment key={index}>{token.value}</Fragment>;
    }

    if (token.type === 'code') {
      return (
        <code key={index} className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[0.9em] text-gray-900">
          {token.value}
        </code>
      );
    }

    if (token.type === 'strong') {
      return (
        <strong key={index} className="font-semibold text-gray-900">
          {token.children.map((child, childIndex) => renderInlineToken(child, `${index}-${childIndex}`))}
        </strong>
      );
    }

    return (
      <a
        key={index}
        href={token.href}
        target="_blank"
        rel="noreferrer"
        className="font-medium text-blue-600 underline decoration-blue-200 underline-offset-4 hover:text-blue-700"
      >
        {token.label}
      </a>
    );
  });
}

function renderInlineToken(token: InlineToken, key: string) {
  if (token.type === 'text') return <Fragment key={key}>{token.value}</Fragment>;
  if (token.type === 'code') {
    return (
      <code key={key} className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[0.9em] text-gray-900">
        {token.value}
      </code>
    );
  }
  if (token.type === 'strong') {
    return (
      <strong key={key} className="font-semibold text-gray-900">
        {token.children.map((child, index) => renderInlineToken(child, `${key}-${index}`))}
      </strong>
    );
  }

  return (
    <a
      key={key}
      href={token.href}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-blue-600 underline decoration-blue-200 underline-offset-4 hover:text-blue-700"
    >
      {token.label}
    </a>
  );
}

function parseInline(content: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let remaining = content;

  while (remaining.length > 0) {
    const nextMatch = findNextInlineMatch(remaining);

    if (!nextMatch) {
      tokens.push({ type: 'text', value: remaining });
      break;
    }

    if (nextMatch.index > 0) {
      tokens.push({ type: 'text', value: remaining.slice(0, nextMatch.index) });
    }

    if (nextMatch.type === 'code') {
      tokens.push({ type: 'code', value: nextMatch.value });
    } else if (nextMatch.type === 'strong') {
      tokens.push({ type: 'strong', children: parseInline(nextMatch.value) });
    } else {
      tokens.push({ type: 'link', label: nextMatch.label, href: nextMatch.href });
    }

    remaining = remaining.slice(nextMatch.index + nextMatch.length);
  }

  return tokens;
}

function findNextInlineMatch(content: string) {
  const codeMatch = content.match(/`([^`]+)`/);
  const strongMatch = content.match(/\*\*([^*]+)\*\*/);
  const linkMatch = content.match(/\[([^\]]+)\]\(([^)]+)\)/);

  const matches = [
    codeMatch
      ? { type: 'code' as const, index: codeMatch.index ?? 0, length: codeMatch[0].length, value: codeMatch[1] }
      : null,
    strongMatch
      ? { type: 'strong' as const, index: strongMatch.index ?? 0, length: strongMatch[0].length, value: strongMatch[1] }
      : null,
    linkMatch
      ? {
          type: 'link' as const,
          index: linkMatch.index ?? 0,
          length: linkMatch[0].length,
          label: linkMatch[1],
          href: linkMatch[2],
        }
      : null,
  ].filter((match): match is NonNullable<typeof match> => match !== null);

  if (matches.length === 0) return null;

  matches.sort((a, b) => a.index - b.index);
  return matches[0];
}

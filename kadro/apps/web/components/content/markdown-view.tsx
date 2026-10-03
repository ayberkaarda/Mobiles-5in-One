import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import type { Block, Inline } from '../../lib/content/markdown';
import styles from './prose.module.css';

/**
 * Renders parsed content (ADR-0080) as React elements. Text reaches the page only as React text
 * children, which React escapes; links are built from targets that the parser already limited to
 * site paths and `https:` URLs. No HTML string is parsed or injected.
 */

function InlineNodes({ nodes }: { readonly nodes: readonly Inline[] }): ReactNode {
  return nodes.map((node, index) => {
    const key = `${node.kind}-${index}`;
    switch (node.kind) {
      case 'text':
        return node.text;
      case 'code':
        return (
          <code key={key} className={styles.code}>
            {node.text}
          </code>
        );
      case 'strong':
        return (
          <strong key={key}>
            <InlineNodes nodes={node.children} />
          </strong>
        );
      case 'link':
        return node.href.startsWith('/') ? (
          <Link key={key} href={node.href as Route} className={styles.link}>
            <InlineNodes nodes={node.children} />
          </Link>
        ) : (
          <a key={key} href={node.href} className={styles.link} rel="noopener noreferrer">
            <InlineNodes nodes={node.children} />
          </a>
        );
    }
  });
}

export function MarkdownView({ blocks }: { readonly blocks: readonly Block[] }) {
  return (
    <div className={styles.prose}>
      {blocks.map((block, index) => {
        const key = `${block.kind}-${index}`;
        switch (block.kind) {
          case 'heading':
            return block.level === 2 ? (
              <h2 key={key} id={block.id}>
                {block.text}
              </h2>
            ) : (
              <h3 key={key} id={block.id}>
                {block.text}
              </h3>
            );
          case 'paragraph':
            return (
              <p key={key}>
                <InlineNodes nodes={block.children} />
              </p>
            );
          case 'quote':
            return (
              <blockquote key={key}>
                <InlineNodes nodes={block.children} />
              </blockquote>
            );
          case 'list': {
            const items = block.items.map((item, itemIndex) => (
              <li key={`item-${itemIndex}`}>
                <InlineNodes nodes={item} />
              </li>
            ));
            return block.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
          }
          case 'table':
            return (
              <div
                key={key}
                className={styles.tableScroll}
                role="region"
                aria-label="Tablo"
                tabIndex={0}
              >
                <table>
                  <thead>
                    <tr>
                      {block.header.map((cell, cellIndex) => (
                        <th key={`head-${cellIndex}`} scope="col">
                          <InlineNodes nodes={cell} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={`row-${rowIndex}`}>
                        {row.map((cell, cellIndex) => (
                          <td key={`cell-${rowIndex}-${cellIndex}`}>
                            <InlineNodes nodes={cell} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
}

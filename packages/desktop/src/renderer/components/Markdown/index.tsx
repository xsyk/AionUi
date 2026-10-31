/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';

import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';

// Import KaTeX CSS to make it available in the document
import 'katex/dist/katex.min.css';

import { openExternalUrl } from '@/renderer/utils/platform';
import { parseHttpUrl } from '@/renderer/utils/url';
import { useOptionalPreviewContext } from '@/renderer/pages/conversation/Preview/context/PreviewContext';
import classNames from 'classnames';
import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { convertLatexDelimiters } from '@renderer/utils/chat/latexDelimiters';
import LocalImageView from '@renderer/components/media/LocalImageView';
import CodeBlock from './CodeBlock';
import LocalFileLink from './LocalFileLink';
import ShadowView from './ShadowView';
import { MARKDOWN_REMARK_PLUGINS, MarkdownTable, MarkdownTd } from './markdownComponents';
import { resolveLocalFileLinkPath, resolveLocalFileLinkReference } from './markdownUtils';
import type { LocalFileLinkReference } from './markdownUtils';

const isLocalFilePath = (src: string): boolean => {
  if (src.startsWith('http://') || src.startsWith('https://')) return false;
  if (src.startsWith('data:')) return false;
  return true;
};

const isRelativeResourcePath = (value: string): boolean =>
  Boolean(value.trim()) && !/^(?:[a-z][a-z\d+.-]*:|[\\/])|[?#]/i.test(value.trim()) && !/\p{Cc}/u.test(value);

const resolveRelativeResourcePath = (href: string): string | null => {
  if (!isRelativeResourcePath(href)) return null;
  try {
    // Markdown has URI-encoded this destination; the resource API expects a path.
    const path = decodeURIComponent(href);
    return isRelativeResourcePath(path) ? path : null;
  } catch {
    return null;
  }
};

type MarkdownViewProps = {
  children: string;
  hiddenCodeCopyButton?: boolean;
  codeStyle?: React.CSSProperties;
  className?: string;
  onRef?: (el?: HTMLDivElement | null) => void;
  onLocalFileLink?: (path: string, reference?: LocalFileLinkReference) => void | Promise<void>;
  /** Resolve token-scoped resources on anonymous read-only pages. */
  renderResource?: (path: string, label: React.ReactNode, kind: 'image' | 'file') => React.ReactNode;
  /** Enable raw HTML rendering in markdown content. Use with caution — only for trusted sources. */
  allowHtml?: boolean;
};

const MarkdownView: React.FC<MarkdownViewProps> = React.memo(
  ({
    hiddenCodeCopyButton,
    codeStyle,
    className,
    onRef,
    onLocalFileLink,
    renderResource,
    allowHtml,
    children: childrenProp,
  }) => {
    const { t } = useTranslation();
    const preview = useOptionalPreviewContext();

    const normalizedChildren = useMemo(() => {
      if (typeof childrenProp === 'string') {
        let text = renderResource ? childrenProp : childrenProp.replace(/file:\/\//g, '');
        text = convertLatexDelimiters(text);
        return text;
      }
      return childrenProp;
    }, [childrenProp, renderResource]);

    const handleLinkClick = useCallback(
      (e: React.MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault();
        e.stopPropagation();
        const href = (e.currentTarget as HTMLAnchorElement).href;
        if (!href) return;
        // Prefer the built-in browser tab for http(s) links; fall back to the
        // system browser for other schemes or when no Preview panel is available.
        const httpUrl = parseHttpUrl(href);
        if (httpUrl && preview) {
          preview.openBrowserTab(httpUrl);
          return;
        }
        openExternalUrl(href).catch((error: unknown) => {
          console.error(t('messages.openLinkFailed'), error);
        });
      },
      [t, preview]
    );

    // Memoize components so React preserves component identity across re-renders.
    // Without this, every streaming update creates new function references → React
    // unmounts/remounts all custom components → hooks & DOM state are lost.
    const components = useMemo(
      () => ({
        span: ({ node: _node, className: cn, children: ch, ...rest }: Record<string, unknown>) => (
          <span {...(rest as React.HTMLAttributes<HTMLSpanElement>)} className={cn as string}>
            {ch as React.ReactNode}
          </span>
        ),
        code: (props: Record<string, unknown>) => (
          <CodeBlock
            {...(props as Parameters<typeof CodeBlock>[0])}
            codeStyle={codeStyle}
            hiddenCodeCopyButton={hiddenCodeCopyButton}
            diagramPanZoom
          />
        ),
        a: ({ node: _node, ...rest }: Record<string, unknown>) => {
          const anchorProps = rest as React.AnchorHTMLAttributes<HTMLAnchorElement>;
          const rawHref = typeof anchorProps.href === 'string' ? anchorProps.href : '';
          if (renderResource && /^file:/i.test(rawHref)) {
            try {
              // The private link resolver also normalizes editor locations. A public
              // resource needs the URI pathname decoded exactly once, preserving %25.
              const path = decodeURIComponent(new URL(rawHref).pathname).replace(/^\/([A-Za-z]:[\\/])/, '$1');
              return renderResource(path, anchorProps.children, 'file');
            } catch {
              return <span>{anchorProps.children}</span>;
            }
          }
          const localFileReference = resolveLocalFileLinkReference(rawHref);
          if (localFileReference && renderResource) {
            return renderResource(localFileReference.filePath, anchorProps.children, 'file');
          }
          const relativeResource = renderResource ? resolveRelativeResourcePath(rawHref) : null;
          if (relativeResource && renderResource) {
            return renderResource(relativeResource, anchorProps.children, 'file');
          }
          if (localFileReference) {
            return (
              <LocalFileLink reference={localFileReference} onOpen={onLocalFileLink}>
                {anchorProps.children}
              </LocalFileLink>
            );
          }
          return (
            <a {...anchorProps} href={anchorProps.href} target='_blank' rel='noreferrer' onClick={handleLinkClick} />
          );
        },
        table: MarkdownTable,
        td: MarkdownTd,
        img: ({ node: _node, ...rest }: Record<string, unknown>) => {
          const imgProps = rest as React.ImgHTMLAttributes<HTMLImageElement>;
          let sameOriginImage = false;
          if (renderResource && typeof window !== 'undefined') {
            try {
              sameOriginImage = new URL(imgProps.src || '', window.location.href).origin === window.location.origin;
            } catch {
              /* A malformed URL stays subject to normal markdown sanitization. */
            }
          }
          if (renderResource && (isLocalFilePath(imgProps.src || '') || sameOriginImage)) {
            let path = imgProps.src || '';
            try {
              path = decodeURIComponent(path);
            } catch {
              /* Keep the original malformed reference. */
            }
            return renderResource(path, imgProps.alt || '', 'image');
          }
          if (isLocalFilePath(imgProps.src || '')) {
            const src = decodeURIComponent(imgProps.src || '');
            return <LocalImageView src={src} alt={imgProps.alt || ''} className={imgProps.className} />;
          }
          return (
            <img {...imgProps} alt={imgProps.alt || ''} referrerPolicy={renderResource ? 'no-referrer' : undefined} />
          );
        },
      }),
      [codeStyle, hiddenCodeCopyButton, handleLinkClick, onLocalFileLink, renderResource]
    );

    const rehypePlugins = useMemo(() => (allowHtml ? [rehypeRaw, rehypeKatex] : [rehypeKatex]), [allowHtml]);

    return (
      <div className={classNames('relative w-full', className)}>
        <ShadowView privateTheme={!renderResource}>
          <div ref={onRef} className='markdown-shadow-body'>
            <ReactMarkdown
              remarkPlugins={MARKDOWN_REMARK_PLUGINS}
              rehypePlugins={rehypePlugins}
              components={components}
              urlTransform={(url) => (resolveLocalFileLinkPath(url) ? url : defaultUrlTransform(url))}
            >
              {normalizedChildren}
            </ReactMarkdown>
          </div>
        </ShadowView>
      </div>
    );
  }
);

MarkdownView.displayName = 'MarkdownView';

export default MarkdownView;

import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

interface MarkdownContentProps {
  content: string;
  className?: string;
}

const components: Components = {
  a: ({ href, children }) => {
    // nostr: URIs (NIP-21) open the in-app NIP-19 route
    if (href?.startsWith('nostr:')) {
      return <Link to={`/${href.slice('nostr:'.length)}`}>{children}</Link>;
    }
    return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
  },
  img: ({ src, alt }) => <img src={src} alt={alt ?? ''} loading="lazy" className="rounded-md" />,
};

/** Keep nostr: URIs (handled by the link renderer); sanitise everything else as usual. */
function urlTransform(url: string): string {
  return /^nostr:[a-z0-9]+$/i.test(url) ? url : defaultUrlTransform(url);
}

/**
 * Renders Markdown (NIP-23 long-form content). Raw HTML in the source is not rendered,
 * and react-markdown drops unsafe URL schemes such as `javascript:`.
 */
export function MarkdownContent({ content, className }: MarkdownContentProps) {
  return (
    <div className={cn('prose prose-neutral dark:prose-invert max-w-none break-words', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} urlTransform={urlTransform}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

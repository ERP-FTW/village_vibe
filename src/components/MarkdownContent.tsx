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

/** Minimal mdast node shape used by the plugin below. */
interface MdNode { type: string; value?: string; url?: string; children?: MdNode[] }

const NOSTR_URI = /nostr:(?:npub|note|nevent|nprofile|naddr)1[023456789acdefghjklmnpqrstuvwxyz]+/g;

/** Split a text node so bare nostr: URIs (NIP-21) become links. */
function linkifyText(value: string): MdNode[] {
  const nodes: MdNode[] = [];
  let last = 0;
  for (const match of value.matchAll(NOSTR_URI)) {
    const start = match.index ?? 0;
    if (start > last) nodes.push({ type: 'text', value: value.slice(last, start) });
    const id = match[0].slice('nostr:'.length);
    nodes.push({ type: 'link', url: match[0], children: [{ type: 'text', value: `${id.slice(0, 12)}…` }] });
    last = start + match[0].length;
  }
  if (last < value.length) nodes.push({ type: 'text', value: value.slice(last) });
  return nodes;
}

function linkifyTree(node: MdNode): void {
  if (!node.children || node.type === 'link' || node.type === 'linkReference') return;
  node.children = node.children.flatMap(child => {
    if (child.type === 'text' && child.value && child.value.includes('nostr:')) return linkifyText(child.value);
    linkifyTree(child);
    return [child];
  });
}

/** remark plugin: autolink bare nostr: references that CommonMark/GFM leave as text. */
function remarkNostrLinks() {
  return (tree: unknown) => linkifyTree(tree as MdNode);
}

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
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkNostrLinks]} components={components} urlTransform={urlTransform}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

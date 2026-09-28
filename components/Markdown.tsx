"use client";

import { isValidElement, type ReactElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Tag } from "./ui";
import { ChartBlock, KpiBlock } from "./Charts";

// « [FAIT] », « [HYPOTHÈSE] »… écrits par l'agent deviennent des étiquettes colorées.
const TAG_RE = /\[(FAIT|WEB|INTERPR[ÉE]TATION|HYPOTH[ÈE]SE|RECOMMANDATION|POURQUOI|COMMENT|ALERTE|VALIDATION|PRIORIT[ÉE])\]/gi;

type CodeProps = { className?: string; children?: ReactNode };

/** Blocs ```chart et ```kpi : rendus en graphiques / tuiles animés au lieu de code. */
function vizOf(node: ReactNode) {
  if (!isValidElement(node)) return null;
  const props = (node as ReactElement<CodeProps>).props;
  const lang = props.className?.match(/language-(chart|kpi)/)?.[1];
  return lang ? { lang, raw: String(props.children ?? "") } : null;
}

export default function Markdown({ children }: { children: string }) {
  const source = children.replace(TAG_RE, (_, t: string) => `\`§${t}\``);
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: (props) => (
            <div className="table-wrap">
              <table {...props} />
            </div>
          ),
          a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
          pre: ({ children: c, ...rest }) => {
            const viz = vizOf(Array.isArray(c) ? c[0] : c);
            if (viz) return viz.lang === "chart" ? <ChartBlock raw={viz.raw} /> : <KpiBlock raw={viz.raw} />;
            return <pre {...rest}>{c}</pre>;
          },
          code: ({ children: c, className, ...rest }) => {
            if (!className && typeof c === "string" && c.startsWith("§")) return <Tag kind={c.slice(1)} />;
            return (
              <code className={className} {...rest}>
                {c}
              </code>
            );
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

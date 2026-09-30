import { useState } from "react";

import { InfoGlyph } from "../../shared/ui/icons";
import { HELP_GROUP_ORDER, HELP_TOPICS, type HelpBlock, type HelpGroup } from "./helpTopics";

function HelpBlockView({ block }: { block: HelpBlock }) {
  switch (block.kind) {
    case "text":
      return <p>{block.text}</p>;
    case "heading":
      return <h4 className="wb-help__subheading">{block.text}</h4>;
    case "steps":
      return (
        <ol className="wb-help__steps">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      );
    case "example":
      return (
        <figure className="wb-help__example">
          <figcaption>{block.example.title}</figcaption>
          <pre>{block.example.lines.join("\n")}</pre>
          {block.example.note ? <p>{block.example.note}</p> : null}
        </figure>
      );
    case "note":
      return <aside className="wb-help__note">{block.text}</aside>;
    case "ref":
      return <p className="wb-help__ref">{block.text}</p>;
  }
}

function topicById(id: string) {
  return HELP_TOPICS.find((entry) => entry.id === id);
}

export function HelpWorkspace({
  onReturnToWork,
  onOpenAbout,
}: {
  onReturnToWork: () => void;
  onOpenAbout: () => void;
}) {
  const [topicId, setTopicId] = useState(HELP_TOPICS[0]!.id);
  const topic = topicById(topicId) ?? HELP_TOPICS[0]!;
  const groups: HelpGroup[] = HELP_GROUP_ORDER.filter((group) =>
    HELP_TOPICS.some((entry) => entry.group === group),
  );

  return (
    <div className="wb-canvas wb-canvas--workspace">
      <section className="wb-help" aria-labelledby="wb-help-title">
        <header className="wb-help__header wb-view-head">
          <div>
            <span className="wb-eyebrow">
              <InfoGlyph />
              Guide
            </span>
            <h2 id="wb-help-title">How this works</h2>
          </div>
          <div className="wb-page-actions">
            <button className="wb-button wb-button--ghost" onClick={onOpenAbout}>
              About
            </button>
            <button className="wb-button wb-button--primary" onClick={onReturnToWork}>
              Return to work
            </button>
          </div>
        </header>
        <div className="wb-help__layout">
          <nav className="wb-help__topics" aria-label="Help topics">
            {groups.map((group) => (
              <section key={group} className="wb-help__group">
                <h3>{group}</h3>
                <ol>
                  {HELP_TOPICS.filter((entry) => entry.group === group).map((entry) => (
                    <li key={entry.id}>
                      <button
                        className="wb-help__topic"
                        aria-current={entry.id === topic.id ? "true" : undefined}
                        onClick={() => setTopicId(entry.id)}
                      >
                        {entry.title}
                      </button>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </nav>
          <article className="wb-help__article">
            <h3>{topic.title}</h3>
            {topic.summary ? <p className="wb-help__summary">{topic.summary}</p> : null}
            {topic.blocks.map((block, index) =>
              block.kind === "ref" ? (
                <p className="wb-help__ref" key={topic.id + "-" + String(index)}>
                  {block.text}{" "}
                  <button
                    className="wb-button wb-button--quiet"
                    onClick={() => setTopicId(block.topicId)}
                  >
                    {topicById(block.topicId)?.title ?? block.topicId}
                  </button>
                </p>
              ) : (
                <HelpBlockView key={topic.id + "-" + String(index)} block={block} />
              ),
            )}
          </article>
        </div>
      </section>
    </div>
  );
}

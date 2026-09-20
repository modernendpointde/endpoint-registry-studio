import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { HelpWorkspace } from "./HelpWorkspace";
import { HELP_TOPICS } from "./helpTopics";

describe("HelpWorkspace", () => {
  it("lists every topic and switches to the one that is chosen", async () => {
    const user = userEvent.setup();
    render(<HelpWorkspace onReturnToWork={vi.fn()} onOpenAbout={vi.fn()} />);

    const topics = screen.getByRole("navigation", { name: "Help topics" });
    for (const topic of HELP_TOPICS) {
      expect(within(topics).getByRole("button", { name: topic.title })).toBeVisible();
    }
    expect(screen.getByRole("heading", { name: "Start here" })).toBeVisible();

    const templateTopic = "Create, review, and download an administrative template";
    await user.click(within(topics).getByRole("button", { name: templateTopic }));

    expect(screen.getByRole("heading", { name: templateTopic })).toBeVisible();
    expect(screen.getByText(/A template can express a named value/)).toBeVisible();
  });

  it("offers the way back to work and to About", async () => {
    const user = userEvent.setup();
    const onReturnToWork = vi.fn();
    const onOpenAbout = vi.fn();
    render(<HelpWorkspace onReturnToWork={onReturnToWork} onOpenAbout={onOpenAbout} />);

    await user.click(screen.getByRole("button", { name: "Return to work" }));
    await user.click(screen.getByRole("button", { name: "About" }));

    expect(onReturnToWork).toHaveBeenCalledOnce();
    expect(onOpenAbout).toHaveBeenCalledOnce();
  });

  it("uses the fictional vendor from the product examples, not a Microsoft placeholder", () => {
    const text = JSON.stringify(HELP_TOPICS);

    expect(text).toContain("Northgate");
    for (const placeholder of ["Contoso", "Fabrikam", "Northwind", "Adventure Works"]) {
      expect(text).not.toContain(placeholder);
    }
  });

  it("separates consecutive step lists with a heading", () => {
    const offenders = HELP_TOPICS.flatMap((topic) =>
      topic.blocks.flatMap((block, index) =>
        block.kind === "steps" && topic.blocks[index - 1]?.kind === "steps" ? [topic.id] : [],
      ),
    );

    expect(offenders).toEqual([]);
  });

  it("starts each continuing step list under its own heading", async () => {
    const user = userEvent.setup();
    render(<HelpWorkspace onReturnToWork={vi.fn()} onOpenAbout={vi.fn()} />);
    await user.click(
      within(screen.getByRole("navigation", { name: "Help topics" })).getByRole("button", {
        name: "Worked examples",
      }),
    );

    const article = screen.getByRole("article");
    for (const name of ["Introduce and correct drift", "Verify uninstall behaviour"]) {
      expect(within(article).getByRole("heading", { name }).nextElementSibling?.tagName).toBe("OL");
    }
  });
});

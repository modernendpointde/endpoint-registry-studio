import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppFooter } from "./AppFooter";

describe("AppFooter", () => {
  it("renders nothing when the item list is empty", () => {
    const { container } = render(<AppFooter items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders external links with noopener noreferrer and an https target", () => {
    render(
      <AppFooter
        items={[
          {
            kind: "github",
            label: "GitHub",
            url: "https://github.com/modernendpointde/endpoint-registry-studio",
          },
        ]}
      />,
    );
    const link = screen.getByRole("link", { name: "GitHub" });
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/modernendpointde/endpoint-registry-studio",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("opens relative links in a new tab with opener isolation", () => {
    render(<AppFooter items={[{ kind: "privacy", label: "Privacy", url: "./privacy" }]} />);
    const link = screen.getByRole("link", { name: "Privacy" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("labels the navigation and renders labels as plain text (no HTML parsing)", () => {
    render(<AppFooter items={[{ kind: "privacy", label: "<b>Privacy</b>", url: "./privacy" }]} />);
    expect(screen.getByRole("contentinfo")).toHaveAttribute("aria-label", "Product links");
    expect(screen.getByText("<b>Privacy</b>")).toBeVisible();
  });

  it("renders the identity label when provided and hides it from assistive technology", () => {
    render(
      <AppFooter
        items={[{ kind: "github", label: "GitHub", url: "https://github.com/x" }]}
        identity="Example Operator"
      />,
    );
    const identity = screen.getByText("Example Operator");
    expect(identity).toHaveAttribute("aria-hidden", "true");
    expect(identity.closest("footer")).not.toBeNull();
  });

  it("omits the identity when empty and stays a single-line fixed utility bar", () => {
    const { container } = render(
      <AppFooter items={[{ kind: "privacy", label: "Privacy", url: "./privacy" }]} />,
    );
    expect(screen.queryByText("Endpoint Registry Studio")).toBeNull();
    const footer = container.querySelector("footer");
    expect(footer).not.toBeNull();
    expect(footer?.classList.contains("wb-footer")).toBe(true);
  });
});

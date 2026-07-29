import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NavLink } from "./NavLink";

function renderAt(path: string, ui: React.ReactNode) {
  return render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);
}

describe("NavLink", () => {
  it("renders an anchor pointing at `to`", () => {
    renderAt(
      "/",
      <NavLink to="/videos" className="base">
        Videos
      </NavLink>,
    );

    expect(screen.getByRole("link", { name: "Videos" })).toHaveAttribute(
      "href",
      "/videos",
    );
  });

  it("applies activeClassName only on the matching route", () => {
    renderAt(
      "/videos",
      <NavLink to="/videos" className="base" activeClassName="is-active">
        Videos
      </NavLink>,
    );

    const link = screen.getByRole("link", { name: "Videos" });
    expect(link).toHaveClass("base");
    expect(link).toHaveClass("is-active");
  });

  it("omits activeClassName on a non-matching route", () => {
    renderAt(
      "/artists",
      <NavLink to="/videos" className="base" activeClassName="is-active">
        Videos
      </NavLink>,
    );

    const link = screen.getByRole("link", { name: "Videos" });
    expect(link).toHaveClass("base");
    expect(link).not.toHaveClass("is-active");
  });

  it("keeps the base class when no activeClassName is supplied", () => {
    renderAt(
      "/videos",
      <NavLink to="/videos" className="base">
        Videos
      </NavLink>,
    );

    expect(screen.getByRole("link", { name: "Videos" })).toHaveClass("base");
  });

  it("forwards a ref to the underlying anchor", () => {
    let node: HTMLAnchorElement | null = null;
    renderAt(
      "/",
      <NavLink
        to="/videos"
        ref={(el) => {
          node = el;
        }}
      >
        Videos
      </NavLink>,
    );

    expect(node).toBeInstanceOf(HTMLAnchorElement);
  });
});

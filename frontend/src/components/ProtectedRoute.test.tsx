import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import ProtectedRoute from "./ProtectedRoute";

// ProtectedRoute reads auth state from context; drive it directly so these
// tests cover the routing decision rather than the auth plumbing.
const useAuthMock = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => useAuthMock(),
}));

function LoginProbe() {
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } } | null)?.from;
  return <div>login page for {from?.pathname ?? "nowhere"}</div>;
}

function renderAt(path: string, ui: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<LoginProbe />} />
        <Route path="/" element={<div>home page</div>} />
        <Route path={path} element={ui} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProtectedRoute", () => {
  it("renders children for an authenticated user", () => {
    useAuthMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      user: { role: "user" },
    });

    renderAt("/videos", <ProtectedRoute>secret content</ProtectedRoute>);

    expect(screen.getByText("secret content")).toBeInTheDocument();
  });

  it("shows a spinner instead of redirecting while auth is still loading", () => {
    useAuthMock.mockReturnValue({
      isAuthenticated: false,
      isLoading: true,
      user: null,
    });

    const { container } = renderAt(
      "/videos",
      <ProtectedRoute>secret content</ProtectedRoute>,
    );

    // Must not leak protected content, and must not bounce to /login yet --
    // redirecting during load would sign out anyone on a slow refresh.
    expect(screen.queryByText("secret content")).not.toBeInTheDocument();
    expect(screen.queryByText(/login page/)).not.toBeInTheDocument();
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("redirects an anonymous user to /login", () => {
    useAuthMock.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      user: null,
    });

    renderAt("/videos", <ProtectedRoute>secret content</ProtectedRoute>);

    expect(screen.queryByText("secret content")).not.toBeInTheDocument();
    expect(screen.getByText(/login page/)).toBeInTheDocument();
  });

  it("passes the attempted location so login can bounce back", () => {
    useAuthMock.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      user: null,
    });

    renderAt("/videos", <ProtectedRoute>secret content</ProtectedRoute>);

    expect(screen.getByText("login page for /videos")).toBeInTheDocument();
  });

  it("sends a non-admin away from an adminOnly route", () => {
    useAuthMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      user: { role: "user" },
    });

    renderAt(
      "/settings",
      <ProtectedRoute adminOnly>admin panel</ProtectedRoute>,
    );

    expect(screen.queryByText("admin panel")).not.toBeInTheDocument();
    expect(screen.getByText("home page")).toBeInTheDocument();
  });

  it("lets an admin into an adminOnly route", () => {
    useAuthMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      user: { role: "admin" },
    });

    renderAt(
      "/settings",
      <ProtectedRoute adminOnly>admin panel</ProtectedRoute>,
    );

    expect(screen.getByText("admin panel")).toBeInTheDocument();
  });

  it("treats a user with no role as non-admin", () => {
    useAuthMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      user: {},
    });

    renderAt(
      "/settings",
      <ProtectedRoute adminOnly>admin panel</ProtectedRoute>,
    );

    expect(screen.queryByText("admin panel")).not.toBeInTheDocument();
  });
});

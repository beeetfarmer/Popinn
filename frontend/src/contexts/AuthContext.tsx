import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { api, ApiError } from "@/lib/api";

interface User {
  id: string;
  username: string;
  email: string;
  image_url?: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
}

interface TokenPair {
  access_token: string;
  refresh_token: string;
}

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchMe = useCallback(async () => {
    try {
      const u = await api.get<User>("/auth/me");
      setUser(u);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    fetchMe().finally(() => setIsLoading(false));
  }, [fetchMe]);

  const login = useCallback(
    async (email: string, password: string) => {
      await api.post<TokenPair>("/auth/login", {
        email,
        password,
      });
      await fetchMe();
    },
    [fetchMe],
  );

  const register = useCallback(
    async (username: string, email: string, password: string) => {
      await api.post("/auth/register", { username, email, password });
      await login(email, password);
    },
    [login],
  );

  const logout = useCallback(() => {
    api.post("/auth/logout").finally(() => setUser(null));
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}

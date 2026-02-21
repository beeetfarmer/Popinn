import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { QueueProvider } from "@/contexts/QueueContext";
import Layout from "@/components/Layout";
import ProtectedRoute from "@/components/ProtectedRoute";
import Index from "./pages/Index";
import MusicVideosPage from "./pages/MusicVideos";
import ArtistsPage from "./pages/ArtistsPage";
import ArtistDetail from "./pages/ArtistDetail";
import VideoPlayer from "./pages/VideoPlayer";
import SettingsPage from "./pages/SettingsPage";
import ProfilePage from "./pages/ProfilePage";
import ProfileStatsRankingsPage from "./pages/ProfileStatsRankingsPage";
import SearchPage from "./pages/SearchPage";
import WatchlistsPage from "./pages/WatchlistsPage";
import WatchlistDetail from "./pages/WatchlistDetail";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <QueueProvider>
          <BrowserRouter>
            <Routes>
              {/* Auth routes — no layout */}
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />

              {/* Main routes — with top bar + bottom dock, all require auth */}
              <Route
                element={
                  <ProtectedRoute>
                    <Layout />
                  </ProtectedRoute>
                }
              >
                <Route path="/" element={<Index />} />
                <Route path="/videos" element={<MusicVideosPage />} />
                <Route path="/artists" element={<ArtistsPage />} />
                <Route path="/artist/:id" element={<ArtistDetail />} />
                <Route path="/video/:id" element={<VideoPlayer />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/watchlists" element={<WatchlistsPage />} />
                <Route path="/watchlists/:id" element={<WatchlistDetail />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/profile/stats-rankings" element={<ProfileStatsRankingsPage />} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </QueueProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

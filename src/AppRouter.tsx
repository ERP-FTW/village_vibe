import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ScrollToTop } from "./components/ScrollToTop";
import { Layout } from "./components/Layout";

import Index from "./pages/Index";
import { RouteFallback } from "./components/RouteFallback";

// Route-level code splitting: each page loads on first visit instead of
// shipping the whole app in one bundle.
const TribesPage = lazy(() => import("./pages/TribesPage"));
const TribePage = lazy(() => import("./pages/TribePage"));
const EventPage = lazy(() => import("./pages/EventPage"));
const StoryPage = lazy(() => import("./pages/StoryPage"));
const VillagePage = lazy(() => import("./pages/VillagePage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const ProfileSettingsPage = lazy(() => import("./pages/ProfileSettingsPage"));
const ChatPage = lazy(() => import("./pages/ChatPage"));
const AboutPage = lazy(() => import("./pages/About"));
const NIP19Page = lazy(() => import("./pages/NIP19Page").then(m => ({ default: m.NIP19Page })));
const NIPPage = lazy(() => import("./pages/NIPPage").then(m => ({ default: m.NIPPage })));
const HashtagPage = lazy(() => import("./pages/HashtagPage"));
import NotFound from "./pages/NotFound";

export function AppRouter() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Layout>
        <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/tribes" element={<TribesPage />} />
          <Route path="/tribe/:tribeId" element={<TribePage />} />
          <Route path="/event/:eventId" element={<EventPage />} />
          <Route path="/story/:storyId" element={<StoryPage />} />
          <Route path="/village/:villageSlug" element={<VillagePage />} />
          <Route path="/village" element={<VillagePage />} />
          <Route path="/profile/:pubkey" element={<ProfilePage />} />
          <Route path="/settings/profile" element={<ProfileSettingsPage />} />
          <Route path="/messages" element={<ChatPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/nip" element={<NIPPage />} />
          <Route path="/t/:tag" element={<HashtagPage />} />
          {/* NIP-19 route for npub1, note1, naddr1, nevent1, nprofile1 */}
          <Route path="/:nip19" element={<NIP19Page />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
      </Layout>
    </BrowserRouter>
  );
}
export default AppRouter;
import { AuthProvider } from "./lib/auth";
import { RouterProvider, useRouter } from "./lib/router";
import AdminPage from "./pages/admin_page";
import AppPage from "./pages/app/app_page";
import Landing from "./pages/landing";
import TryPage from "./pages/try_page";

function Routes() {
  const { path } = useRouter();
  if (path === "/try") return <TryPage />;
  if (path === "/app" || path.startsWith("/app/")) return <AppPage />;
  if (path === "/admin") return <AdminPage />;
  return <Landing />;
}

function App() {
  return (
    <RouterProvider>
      <AuthProvider>
        <Routes />
      </AuthProvider>
    </RouterProvider>
  );
}

export default App;

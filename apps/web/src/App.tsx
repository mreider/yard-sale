import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout.js';
import { AuthProvider } from './lib/auth.js';
import { AdminPage } from './pages/Admin.js';
import { ConfirmPage } from './pages/Confirm.js';
import { ConnectPage } from './pages/Connect.js';
import { DemoPage } from './pages/Demo.js';
import { ForgotPage } from './pages/Forgot.js';
import { HomePage } from './pages/Home.js';
import { PrivacyPage, TermsPage } from './pages/Legal.js';
import { LoginPage } from './pages/Login.js';
import { ProfilePage } from './pages/Profile.js';
import { ResetPage } from './pages/Reset.js';
import { SaleEditPage } from './pages/SaleEdit.js';
import { SalePreviewPage } from './pages/SalePreview.js';
import { SalesPage } from './pages/Sales.js';
import { SignupPage } from './pages/Signup.js';
import { TokensPage } from './pages/Tokens.js';
import { ViewerPage } from './pages/Viewer.js';

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* /demo renders the standalone SaleViewer (no nav chrome). */}
          <Route path="demo" element={<DemoPage />} />
          {/* Draft preview, also full-bleed (no nav chrome). Auth happens
              inside the page component since it needs the user session. */}
          <Route path="sales/:id/preview" element={<SalePreviewPage />} />
          {/* Published sale viewer at /{user}/{slug}. Outside Layout so it
              takes the whole page like the self-hosted template. Goes below
              the Layout-wrapped literal routes so /sales/:id (literal) wins
              over /{user}/{slug} (dynamic) in React Router's matching. */}
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="signup" element={<SignupPage />} />
            <Route path="login" element={<LoginPage />} />
            <Route path="confirm" element={<ConfirmPage />} />
            <Route path="forgot" element={<ForgotPage />} />
            <Route path="reset" element={<ResetPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="tokens" element={<TokensPage />} />
            <Route path="sales" element={<SalesPage />} />
            <Route path="sales/:id" element={<SaleEditPage />} />
            <Route path="connect" element={<ConnectPage />} />
            <Route path="admin" element={<AdminPage />} />
            <Route path="privacy" element={<PrivacyPage />} />
            <Route path="terms" element={<TermsPage />} />
          </Route>
          <Route path=":user/:slug" element={<ViewerPage />} />
          {/* Fallback inside Layout so unknown single-segment routes still get nav. */}
          <Route element={<Layout />}>
            <Route path="*" element={<HomePage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

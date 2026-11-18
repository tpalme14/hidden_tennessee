import { Route, Routes } from "react-router";
import { ResetTokenGuard } from "./auth/ResetTokenGuard";
import { AppLayout } from "./layout/AppLayout";
import { DiscoveryPage } from "./routes/DiscoveryPage";
import { LandmarkProfilePage } from "./routes/LandmarkProfilePage";
import { RegisterPage } from "./routes/RegisterPage";
import { SignInPage } from "./routes/SignInPage";
import { ForgotPasswordPage } from "./routes/ForgotPasswordPage";
import { ResetPasswordPage } from "./routes/ResetPasswordPage";

export default function App() {
  return (
    <>
      <ResetTokenGuard />
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<DiscoveryPage />} />
          <Route path="landmarks/:id" element={<LandmarkProfilePage />} />
          <Route path="register" element={<RegisterPage />} />
          <Route path="sign-in" element={<SignInPage />} />
          <Route path="forgot-password" element={<ForgotPasswordPage />} />
          <Route path="reset-password" element={<ResetPasswordPage />} />
        </Route>
      </Routes>
    </>
  );
}

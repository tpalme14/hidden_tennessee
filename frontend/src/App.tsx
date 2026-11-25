import { Route, Routes } from "react-router";
import { ResetTokenGuard } from "./auth/ResetTokenGuard";
import { AppLayout } from "./layout/AppLayout";
import { DiscoveryPage } from "./routes/DiscoveryPage";
import { FavoritesPage } from "./routes/FavoritesPage";
import { LandmarkProfilePage } from "./routes/LandmarkProfilePage";
import { MyTripsPage } from "./routes/MyTripsPage";
import { RegisterPage } from "./routes/RegisterPage";
import { SharedTripPage } from "./routes/SharedTripPage";
import { SignInPage } from "./routes/SignInPage";
import { TripDetailPage } from "./routes/TripDetailPage";
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
          <Route path="favorites" element={<FavoritesPage />} />
          <Route path="trips" element={<MyTripsPage />} />
          <Route path="trips/:tripId" element={<TripDetailPage />} />
          {/* Public and read-only: no authentication gate (M05-T06 Increment 5a). */}
          <Route path="shared/trips/:shareToken" element={<SharedTripPage />} />
          <Route path="register" element={<RegisterPage />} />
          <Route path="sign-in" element={<SignInPage />} />
          <Route path="forgot-password" element={<ForgotPasswordPage />} />
          <Route path="reset-password" element={<ResetPasswordPage />} />
        </Route>
      </Routes>
    </>
  );
}

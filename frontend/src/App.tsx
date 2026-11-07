import { Route, Routes } from "react-router";
import { AppLayout } from "./layout/AppLayout";
import { DiscoveryPage } from "./routes/DiscoveryPage";
import { LandmarkProfilePage } from "./routes/LandmarkProfilePage";

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DiscoveryPage />} />
        <Route path="landmarks/:id" element={<LandmarkProfilePage />} />
      </Route>
    </Routes>
  );
}
